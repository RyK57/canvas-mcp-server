/**
 * Zod input schemas for every tool.
 *
 * These enforce Canvas's documented constraints client-side (enum values, ISO
 * date formats, per-page bounds) so the agent gets a precise validation
 * message instead of an opaque HTTP 400.
 *
 * Canvas's `include[]` options are deliberately NOT exposed as raw enums. They
 * number two dozen, differ between the list and single-course endpoints, and
 * mostly control fields an agent has no use for. Each tool requests what it
 * needs and surfaces only the toggles that change what a user would see.
 */

import { z } from "zod";
import {
  ASSIGNMENT_BUCKETS,
  ASSIGNMENT_ORDER_BY,
  COURSE_ENROLLMENT_STATES,
  COURSE_STATES,
  DEFAULT_PER_PAGE,
  DISCUSSION_ORDER_BY,
  DISCUSSION_SCOPES,
  ENROLLMENT_STATES,
  FILE_SORT_FIELDS,
  MAX_PER_PAGE,
  PAGE_SORT_FIELDS,
  SORT_ORDERS,
} from "../constants.js";
import { RESPONSE_FORMATS } from "../formatters/response.js";

export const responseFormatField = z
  .enum(RESPONSE_FORMATS)
  .default("markdown")
  .describe("Output format: 'markdown' for human-readable, 'json' for machine-readable");

/**
 * Canvas paginates via opaque Link-header URLs, but `page` works on the
 * endpoints this server exposes and is far easier for an agent to reason about
 * than threading a cursor through. `has_more` in the response comes from the
 * Link header, which is the authoritative signal.
 */
export const paginationFields = {
  page: z
    .number()
    .int()
    .min(1, "page is 1-indexed and must be 1 or greater")
    .default(1)
    .describe("Page number, 1-indexed"),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(MAX_PER_PAGE, `Capped at ${MAX_PER_PAGE} to keep a single call readable`)
    .default(DEFAULT_PER_PAGE)
    .describe(`Items per page (max ${MAX_PER_PAGE})`),
};

/**
 * Canvas ids are 64-bit integers returned as strings. Accepting a number too
 * and coercing avoids a spurious validation failure when an agent passes an id
 * it read out of prose rather than a previous tool result.
 */
const canvasId = (what: string) =>
  z
    .union([z.string().min(1), z.number().int()])
    .transform((value) => String(value))
    .describe(what);

export const courseIdField = canvasId("Canvas course id, from canvas_list_courses");

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/,
    "Must be a date (2026-08-24) or ISO 8601 timestamp (2026-08-24T18:00:00Z)",
  );

/**
 * Canvas addresses courses in some APIs as "context codes" rather than bare
 * ids. Accepting either and normalising spares the agent a formatting rule it
 * would otherwise have to remember.
 */
export const contextCodeField = z
  .union([z.string().min(1), z.number().int()])
  .transform((value) => {
    const raw = String(value);
    return /^(course|user|group)_/.test(raw) ? raw : `course_${raw}`;
  })
  .describe("A course id, or a full context code like 'course_12345'");

/* -------------------------------------------------------------------------- */
/* Courses                                                                     */
/* -------------------------------------------------------------------------- */

export const listCoursesSchema = z
  .object({
    enrollment_state: z
      .enum(COURSE_ENROLLMENT_STATES)
      .default("active")
      .describe(
        "Filter by YOUR enrollment: 'active' for courses you are currently taking, " +
          "'completed' for finished ones",
      ),
    state: z
      .array(z.enum(COURSE_STATES))
      .optional()
      .describe("Filter by the course's own publication state, e.g. ['available']"),
    include_grades: z
      .boolean()
      .default(true)
      .describe("Include your current score and letter grade for each course"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const getCourseSchema = z
  .object({
    course_id: courseIdField,
    include_syllabus: z
      .boolean()
      .default(false)
      .describe("Include the syllabus body. It is often long — leave false unless asked for it"),
    response_format: responseFormatField,
  })
  .strict();

export const listEnrollmentsSchema = z
  .object({
    course_id: courseIdField
      .optional()
      .describe("Limit to one course; omit to list your enrollments across all courses"),
    state: z
      .array(z.enum(ENROLLMENT_STATES))
      .optional()
      .describe("Enrollment states to include; defaults to active and invited"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const getGradesSchema = z
  .object({
    include_completed: z
      .boolean()
      .default(false)
      .describe("Also report courses whose term has finished"),
    response_format: responseFormatField,
  })
  .strict();

export const getProfileSchema = z.object({}).strict();

/* -------------------------------------------------------------------------- */
/* Assignments and submissions                                                 */
/* -------------------------------------------------------------------------- */

export const listAssignmentsSchema = z
  .object({
    course_id: courseIdField,
    bucket: z
      .enum(ASSIGNMENT_BUCKETS)
      .optional()
      .describe(
        "Filter by state relative to you: 'upcoming' and 'overdue' are the useful ones for " +
          "a student; omit for everything",
      ),
    search_term: z.string().min(2).optional().describe("Partial assignment name match"),
    order_by: z
      .enum(ASSIGNMENT_ORDER_BY)
      .default("due_at")
      .describe("Sort order for the returned assignments"),
    include_submission: z
      .boolean()
      .default(true)
      .describe("Include your own submission state and score alongside each assignment"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const getAssignmentSchema = z
  .object({
    course_id: courseIdField,
    assignment_id: canvasId("Assignment id, from canvas_list_assignments"),
    response_format: responseFormatField,
  })
  .strict();

export const getSubmissionSchema = z
  .object({
    course_id: courseIdField,
    assignment_id: canvasId("Assignment id, from canvas_list_assignments"),
    include_comments: z
      .boolean()
      .default(true)
      .describe("Include instructor feedback comments on the submission"),
    response_format: responseFormatField,
  })
  .strict();

export const listQuizzesSchema = z
  .object({
    course_id: courseIdField,
    search_term: z.string().min(2).optional().describe("Partial quiz title match"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Planner and calendar                                                        */
/* -------------------------------------------------------------------------- */

export const listPlannerItemsSchema = z
  .object({
    start_date: isoDateTime
      .optional()
      .describe("Only items on or after this date; defaults to today"),
    end_date: isoDateTime.optional().describe("Only items on or before this date"),
    course_ids: z
      .array(contextCodeField)
      .optional()
      .describe("Limit to specific courses; omit to span every course"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const listUpcomingSchema = z
  .object({ response_format: responseFormatField })
  .strict();

export const listCalendarEventsSchema = z
  .object({
    start_date: isoDateTime.optional().describe("Window start; defaults to today"),
    end_date: isoDateTime.optional().describe("Window end"),
    course_ids: z
      .array(contextCodeField)
      .optional()
      .describe("Limit to specific courses; Canvas defaults to your own calendar only"),
    include_assignments: z
      .boolean()
      .default(false)
      .describe("Return assignment due dates instead of calendar events"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Announcements and discussions                                               */
/* -------------------------------------------------------------------------- */

export const listAnnouncementsSchema = z
  .object({
    // Canvas rejects this endpoint outright without at least one context code.
    course_ids: z
      .array(contextCodeField)
      .min(1, "Canvas requires at least one course — announcements cannot be listed globally")
      .describe("Courses to read announcements from, as ids or 'course_123' codes"),
    start_date: isoDateTime
      .optional()
      .describe("Oldest announcement to return; Canvas defaults to 14 days ago"),
    end_date: isoDateTime.optional().describe("Newest announcement to return"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const listDiscussionsSchema = z
  .object({
    course_id: courseIdField,
    order_by: z
      .enum(DISCUSSION_ORDER_BY)
      .default("recent_activity")
      .describe("Sort order for the returned topics"),
    scope: z
      .enum(DISCUSSION_SCOPES)
      .optional()
      .describe(
        "Filter by topic state. Canvas applies this AFTER paginating, so a page may come " +
          "back short of per_page",
      ),
    search_term: z.string().min(2).optional().describe("Partial topic title match"),
    only_announcements: z
      .boolean()
      .default(false)
      .describe("Return only announcements rather than discussion topics"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const getDiscussionSchema = z
  .object({
    course_id: courseIdField,
    topic_id: canvasId("Discussion topic id, from canvas_list_discussions"),
    include_replies: z
      .boolean()
      .default(true)
      .describe("Fetch the topic's replies as well as its body"),
    response_format: responseFormatField,
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Course content                                                              */
/* -------------------------------------------------------------------------- */

export const listModulesSchema = z
  .object({
    course_id: courseIdField,
    include_items: z
      .boolean()
      .default(true)
      .describe("Include each module's items. Canvas may still omit them for large modules"),
    search_term: z.string().min(2).optional().describe("Partial module name match"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const listModuleItemsSchema = z
  .object({
    course_id: courseIdField,
    module_id: canvasId("Module id, from canvas_list_modules"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const listPagesSchema = z
  .object({
    course_id: courseIdField,
    search_term: z.string().min(2).optional().describe("Partial page title match"),
    sort: z.enum(PAGE_SORT_FIELDS).default("updated_at").describe("Field to sort pages by"),
    order: z.enum(SORT_ORDERS).default("desc").describe("Sort direction"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();

export const getPageSchema = z
  .object({
    course_id: courseIdField,
    // Canvas resolves this as a slug first and an id second.
    page_url: z
      .string()
      .min(1)
      .describe(
        "The page's url slug, e.g. 'week-1-reading', from canvas_list_pages — NOT its title",
      ),
    response_format: responseFormatField,
  })
  .strict();

export const listFilesSchema = z
  .object({
    course_id: courseIdField,
    search_term: z.string().min(2).optional().describe("Partial file name match"),
    content_types: z
      .array(z.string().min(1))
      .optional()
      .describe("MIME types or prefixes, e.g. ['application/pdf'] or ['image']"),
    sort: z.enum(FILE_SORT_FIELDS).default("updated_at").describe("Field to sort files by"),
    order: z.enum(SORT_ORDERS).default("desc").describe("Sort direction"),
    ...paginationFields,
    response_format: responseFormatField,
  })
  .strict();
