/**
 * Course tools — the enrolment list, one course in detail, and grades.
 *
 * Nearly every other tool needs a course_id, so these are the entry point an
 * agent reaches for first.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { courseLabel, courseScore, formatCourse, formatEnrollment } from "../formatters/entities.js";
import {
  buildPageMeta,
  emptyResult,
  paginationFooter,
  toolResult,
  withErrorHandling,
} from "../formatters/response.js";
import {
  getCourseSchema,
  getGradesSchema,
  getProfileSchema,
  listCoursesSchema,
  listEnrollmentsSchema,
} from "../schemas/inputs.js";
import { gradesOutput, listOutput, profileOutput, singleOutput } from "../schemas/outputs.js";
import type { CanvasClientConfig } from "../services/canvas-client.js";
import { request, requestPage } from "../services/canvas-client.js";
import type { Course, Enrollment, UserProfile } from "../types.js";

export const registerCourseTools = (server: McpServer, config: CanvasClientConfig): void => {
  server.registerTool(
    "canvas_list_courses",
    {
      title: "List Canvas Courses",
      description: `List the courses you are enrolled in, with your current grade in each.

Start here. Almost every other Canvas tool needs a course_id, and this is what produces them. Prefer referring to courses by name when talking to the user, not by id.

Args:
  - enrollment_state ('active' | 'invited_or_pending' | 'completed'): which of YOUR enrollments to include (default: 'active')
  - state (array): filter by the course's own state, e.g. ['available'] for published courses
  - include_grades (boolean): include your score and letter grade (default: true)
  - page (number), per_page (number): pagination, per_page max 100 (default: 20)
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "per_page": number, "count": number, "has_more": boolean,
    "courses": [ { "id": string, "name": string, "course_code": string,
                   "term": { "name": string },
                   "enrollments": [ { "computed_current_score": number,
                                      "computed_current_grade": string } ] } ]
  }

Examples:
  - "What classes am I taking?" -> call with no arguments
  - "What did I take last semester?" -> enrollment_state='completed'
  - Don't use when: you want grades across every course as a summary (use canvas_get_grades)

Error Handling:
  - A course visible in the browser can still be absent here if its term has concluded — retry with enrollment_state='completed'
  - Grades are omitted entirely when a course is configured to hide final grades`,
      inputSchema: listCoursesSchema,
      outputSchema: listOutput("courses"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listCoursesSchema>) => {
      const include = ["term", "favorites"];
      if (params.include_grades) include.push("total_scores");

      const { items, has_more } = await requestPage<Course>(config, "/courses", {
        query: {
          enrollment_state: params.enrollment_state,
          state: params.state,
          include,
          page: params.page,
          per_page: params.per_page,
        },
      });

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, courses: items };

      if (items.length === 0) {
        return emptyResult(
          `No courses with enrollment_state='${params.enrollment_state}'. ` +
            "Try enrollment_state='completed' for past terms, or check that CANVAS_BASE_URL " +
            "points at the right institution.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Courses (${items.length})`,
          "",
          items.map((course) => formatCourse(course)).join("\n\n"),
          paginationFooter(meta, "canvas_list_courses"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_get_course",
    {
      title: "Get Canvas Course",
      description: `Fetch one course in detail, optionally including its syllabus.

Args:
  - course_id (string): from canvas_list_courses
  - include_syllabus (boolean): include the syllabus body (default: false). Syllabi are often
    thousands of words, so leave this off unless the user asked about the syllabus
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  { "course": { "id": string, "name": string, "course_code": string, "workflow_state": string,
                "start_at": string, "end_at": string, "syllabus_body": string,
                "term": {...}, "enrollments": [...] } }

Examples:
  - "What's the syllabus for CS 61A?" -> resolve the id, then include_syllabus=true
  - "When does this course end?" -> include_syllabus=false
  - Don't use when: you want the assignment list (use canvas_list_assignments)

Error Handling:
  - 404 means either no such course or you are not enrolled in it`,
      inputSchema: getCourseSchema,
      outputSchema: singleOutput("course"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof getCourseSchema>) => {
      const include = ["term", "total_scores", "public_description"];
      if (params.include_syllabus) include.push("syllabus_body");

      const course = await request<Course>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}`,
        { query: { include } },
      );

      return toolResult(params.response_format, { course }, () => formatCourse(course, true));
    }),
  );

  server.registerTool(
    "canvas_get_grades",
    {
      title: "Get Canvas Grades",
      description: `Summarise your current grade in every course, in one call.

This is the tool for "how am I doing". It reads the score Canvas computes from graded work only — ungraded assignments are excluded rather than counted as zero, so it matches what the Canvas grades page shows.

Args:
  - include_completed (boolean): also report courses whose term has ended (default: false)
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "count": number,
    "courses": [ { "course_id": string, "name": string,
                   "current_score": number | null, "current_grade": string | null } ]
  }

Examples:
  - "What are my grades?" -> call with no arguments
  - "What's my GPA looking like this semester?" -> call, then reason over the scores
  - Don't use when: you want per-assignment scores in one course (use canvas_list_assignments)

Error Handling:
  - A course appears with a null score when it hides final grades or has nothing graded yet
  - Scores reflect only what the instructor has posted; unposted grades are not visible to students`,
      inputSchema: getGradesSchema,
      outputSchema: gradesOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof getGradesSchema>) => {
      const { items } = await requestPage<Course>(config, "/courses", {
        query: {
          enrollment_state: params.include_completed ? undefined : "active",
          include: ["total_scores", "term"],
          per_page: 100,
        },
      });

      const courses = items.map((course) => {
        const scored = courseScore(course);
        return {
          course_id: course.id ?? null,
          name: courseLabel(course),
          term: course.term?.name ?? null,
          current_score: scored?.score ?? null,
          current_grade: scored?.grade ?? null,
        };
      });

      const structured = { count: courses.length, courses };

      if (courses.length === 0) {
        return emptyResult("No courses found for this account.", structured);
      }

      return toolResult(params.response_format, structured, () => {
        const graded = courses.filter((course) => course.current_score !== null);
        const rows = courses
          .map((course) => {
            const score =
              course.current_score !== null
                ? `${course.current_score}%${course.current_grade ? ` (${course.current_grade})` : ""}`
                : "_no grade posted_";
            return `| ${course.name} | ${score} |`;
          })
          .join("\n");

        const average =
          graded.length > 0
            ? Math.round(
                (graded.reduce((sum, course) => sum + (course.current_score ?? 0), 0) /
                  graded.length) *
                  10,
              ) / 10
            : null;

        return [
          "# Current grades",
          "",
          "| Course | Grade |",
          "| --- | --- |",
          rows,
          "",
          average !== null
            ? `_Unweighted mean across ${graded.length} graded course(s): ${average}%. This is a plain average of course percentages, not a GPA._`
            : "_No graded courses yet._",
        ].join("\n");
      });
    }),
  );

  server.registerTool(
    "canvas_list_enrollments",
    {
      title: "List Canvas Enrollments",
      description: `List enrollment records, which carry your role and grades per course.

Most questions are better served by canvas_list_courses or canvas_get_grades. Reach for this when the role matters — whether you are a student, TA, or observer in a course — or when you need enrollment states the course list does not expose.

Args:
  - course_id (string): limit to one course; omit for all your enrollments
  - state (array): enrollment states to include; Canvas defaults to active and invited
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "enrollments": [ { "id": string, "course_id": string, "type": string, "role": string,
                       "enrollment_state": string,
                       "grades": { "current_score": number, "current_grade": string } } ]
  }

Examples:
  - "Am I a TA in any course?" -> omit course_id, look for TaEnrollment
  - Don't use when: you just want grades (use canvas_get_grades — one call, friendlier output)

Error Handling:
  - Only your own enrollments are readable unless the token belongs to an account admin
  - Note the field naming differs from canvas_list_courses: grades.current_score here, computed_current_score there`,
      inputSchema: listEnrollmentsSchema,
      outputSchema: listOutput("enrollments"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listEnrollmentsSchema>) => {
      const path = params.course_id
        ? `/courses/${encodeURIComponent(params.course_id)}/enrollments`
        : "/users/self/enrollments";

      const { items, has_more } = await requestPage<Enrollment>(config, path, {
        query: { state: params.state, page: params.page, per_page: params.per_page },
      });

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, enrollments: items };

      if (items.length === 0) {
        return emptyResult(
          "No enrollments matched. Try widening state, e.g. state=['active','completed'].",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Enrollments (${items.length})`,
          "",
          items.map(formatEnrollment).join("\n"),
          paginationFooter(meta, "canvas_list_enrollments"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_get_profile",
    {
      title: "Get Canvas Profile",
      description: `Return the Canvas profile of the account this token belongs to.

Useful for confirming which account is connected, and for the time zone — Canvas returns timestamps in UTC, so the profile's time_zone is what turns a due date into the user's local time.

Args: none

Returns:
  { "id": string, "name": string, "short_name": string, "primary_email": string,
    "login_id": string, "time_zone": string }

Examples:
  - "Whose Canvas account is this?" -> call with no arguments
  - Call once before interpreting due dates, so times can be stated in the user's own zone`,
      inputSchema: getProfileSchema,
      outputSchema: profileOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async () => {
      const profile = await request<UserProfile>(config, "/users/self/profile");

      return toolResult("markdown", { ...profile }, () =>
        [
          `# ${profile?.name ?? "Unknown user"}`,
          "",
          `- **id:** ${profile?.id ?? "?"}`,
          `- **login:** ${profile?.login_id ?? "—"}`,
          `- **email:** ${profile?.primary_email ?? "—"}`,
          `- **time zone:** ${profile?.time_zone ?? "—"}`,
        ].join("\n"),
      );
    }),
  );
};
