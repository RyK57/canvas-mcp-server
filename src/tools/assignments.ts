/**
 * Assignment tools — coursework, your submissions against it, and quizzes.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatAssignment, formatQuiz, formatSubmission } from "../formatters/entities.js";
import {
  buildPageMeta,
  emptyResult,
  paginationFooter,
  stripHtml,
  toolResult,
  withErrorHandling,
} from "../formatters/response.js";
import {
  getAssignmentSchema,
  getSubmissionSchema,
  listAssignmentsSchema,
  listQuizzesSchema,
} from "../schemas/inputs.js";
import { listOutput, singleOutput } from "../schemas/outputs.js";
import type { CanvasClientConfig } from "../services/canvas-client.js";
import { request, requestPage } from "../services/canvas-client.js";
import type { Assignment, Quiz, Submission } from "../types.js";

interface SubmissionComment {
  author_name?: string;
  comment?: string;
  created_at?: string;
}

export const registerAssignmentTools = (server: McpServer, config: CanvasClientConfig): void => {
  server.registerTool(
    "canvas_list_assignments",
    {
      title: "List Canvas Assignments",
      description: `List a course's assignments, with your own submission state on each.

Scoped to ONE course. For "what is due across all my classes", use canvas_list_planner_items instead — it spans every course in a single call.

Args:
  - course_id (string): from canvas_list_courses
  - bucket ('past' | 'overdue' | 'undated' | 'ungraded' | 'unsubmitted' | 'upcoming' | 'future'):
    filter by state relative to you. 'upcoming' and 'overdue' are the useful ones for a student
  - search_term (string): partial assignment name match
  - order_by ('position' | 'name' | 'due_at'): sort order (default: 'due_at')
  - include_submission (boolean): attach your score and submission state (default: true)
  - page (number), per_page (number): pagination, per_page max 100 (default: 20)
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "assignments": [ { "id": string, "name": string, "due_at": string,
                       "points_possible": number, "submission_types": [string],
                       "html_url": string,
                       "submission": { "score": number, "submitted_at": string,
                                       "late": boolean, "missing": boolean } } ]
  }

Examples:
  - "What's left in CS 61A?" -> bucket='unsubmitted'
  - "What have I missed?" -> bucket='overdue'
  - "How did I do on the essays?" -> search_term='essay', include_submission=true
  - Don't use when: you want everything due across all courses (use canvas_list_planner_items)

Error Handling:
  - due_at is null for undated assignments — those are excluded by 'upcoming' and 'overdue'
  - Dates already reflect any override applying to you, so they match what you see in Canvas`,
      inputSchema: listAssignmentsSchema,
      outputSchema: listOutput("assignments"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listAssignmentsSchema>) => {
      const { items, has_more } = await requestPage<Assignment>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/assignments`,
        {
          query: {
            bucket: params.bucket,
            search_term: params.search_term,
            order_by: params.order_by,
            include: params.include_submission ? ["submission"] : undefined,
            page: params.page,
            per_page: params.per_page,
          },
        },
      );

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, assignments: items };

      if (items.length === 0) {
        return emptyResult(
          params.bucket
            ? `No assignments in bucket '${params.bucket}' for this course. Drop the bucket filter to see all of them.`
            : "No assignments in this course. Confirm the course_id with canvas_list_courses.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Assignments (${items.length})`,
          "",
          items.map((assignment) => formatAssignment(assignment)).join("\n\n"),
          paginationFooter(meta, "canvas_list_assignments"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_get_assignment",
    {
      title: "Get Canvas Assignment",
      description: `Fetch one assignment in full, including its instructions and your submission.

This is where the assignment description lives — the prompt, requirements and rubric text an instructor wrote. Canvas stores it as HTML; it is returned here flattened to plain text.

Args:
  - course_id (string): from canvas_list_courses
  - assignment_id (string): from canvas_list_assignments
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  { "assignment": { "id": string, "name": string, "description": string, "due_at": string,
                    "unlock_at": string, "lock_at": string, "points_possible": number,
                    "submission_types": [string], "allowed_attempts": number,
                    "html_url": string, "submission": {...} } }

Examples:
  - "What do I actually have to do for the midterm project?" -> read the description
  - "How many attempts do I get?" -> allowed_attempts, where -1 means unlimited
  - Don't use when: you only need scores across many assignments (use canvas_list_assignments)

Error Handling:
  - 404 means the assignment is not in that course — check you paired the right ids
  - Long descriptions are truncated; the html_url gives the full version in a browser`,
      inputSchema: getAssignmentSchema,
      outputSchema: singleOutput("assignment"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof getAssignmentSchema>) => {
      const assignment = await request<Assignment>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/assignments/${encodeURIComponent(params.assignment_id)}`,
        { query: { include: ["submission", "score_statistics"] } },
      );

      return toolResult(params.response_format, { assignment }, () =>
        formatAssignment(assignment, true),
      );
    }),
  );

  server.registerTool(
    "canvas_get_submission",
    {
      title: "Get Canvas Submission",
      description: `Fetch your own submission for an assignment, including instructor feedback.

Reads the calling user's submission only. A student token cannot read anyone else's.

Args:
  - course_id (string): from canvas_list_courses
  - assignment_id (string): from canvas_list_assignments
  - include_comments (boolean): include instructor feedback comments (default: true)
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  { "submission": { "id": string, "assignment_id": string, "score": number, "grade": string,
                    "submitted_at": string, "graded_at": string, "workflow_state": string,
                    "attempt": number, "late": boolean, "missing": boolean, "excused": boolean,
                    "submission_comments": [ { "author_name": string, "comment": string } ] } }

Examples:
  - "What did my professor say about essay 2?" -> include_comments=true
  - "Did my submission actually go through?" -> check submitted_at and workflow_state
  - Don't use when: you want scores for many assignments at once (use canvas_list_assignments)

Error Handling:
  - An unsubmitted assignment still returns a record, with workflow_state='unsubmitted' and null score
  - 403 means the token lacks permission — student tokens cannot read other students' work`,
      inputSchema: getSubmissionSchema,
      outputSchema: singleOutput("submission"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof getSubmissionSchema>) => {
      const include = ["assignment"];
      if (params.include_comments) include.push("submission_comments");

      const submission = await request<Submission & { submission_comments?: SubmissionComment[] }>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/assignments/${encodeURIComponent(params.assignment_id)}/submissions/self`,
        { query: { include } },
      );

      return toolResult(params.response_format, { submission }, () => {
        const comments = submission?.submission_comments ?? [];
        const rendered = comments
          .map(
            (comment) =>
              `- **${comment.author_name ?? "Unknown"}**: ${stripHtml(comment.comment, 800)}`,
          )
          .join("\n");

        return [
          formatSubmission(submission ?? {}, true),
          comments.length > 0 ? `\n**Feedback (${comments.length})**\n\n${rendered}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      });
    }),
  );

  server.registerTool(
    "canvas_list_quizzes",
    {
      title: "List Canvas Quizzes",
      description: `List a course's quizzes, with due dates, point values and time limits.

Quizzes also surface as assignments, so canvas_list_assignments will show them too. Use this when the quiz-specific details matter — the time limit, the number of questions, or how many attempts are allowed.

Args:
  - course_id (string): from canvas_list_courses
  - search_term (string): partial quiz title match
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "quizzes": [ { "id": string, "title": string, "due_at": string, "points_possible": number,
                   "question_count": number, "time_limit": number, "allowed_attempts": number,
                   "quiz_type": string, "html_url": string } ]
  }

Examples:
  - "How long do I have for the quiz?" -> read time_limit, in minutes
  - "How many questions is the final?" -> question_count
  - Don't use when: the course uses New Quizzes, which are exposed as assignments rather than here

Error Handling:
  - time_limit is null when the quiz is untimed; allowed_attempts of -1 means unlimited
  - An empty list can simply mean the course uses New Quizzes — check canvas_list_assignments`,
      inputSchema: listQuizzesSchema,
      outputSchema: listOutput("quizzes"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listQuizzesSchema>) => {
      const { items, has_more } = await requestPage<Quiz>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/quizzes`,
        {
          query: {
            search_term: params.search_term,
            page: params.page,
            per_page: params.per_page,
          },
        },
      );

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, quizzes: items };

      if (items.length === 0) {
        return emptyResult(
          "No classic quizzes in this course. Courses using New Quizzes expose them as " +
            "assignments instead — try canvas_list_assignments.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Quizzes (${items.length})`,
          "",
          items.map((quiz) => formatQuiz(quiz)).join("\n\n"),
          paginationFooter(meta, "canvas_list_quizzes"),
        ].join("\n"),
      );
    }),
  );
};
