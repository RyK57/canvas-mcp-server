/**
 * Shared constants for the Canvas LMS MCP server.
 */

export const SERVER_NAME = "canvas-mcp-server";
export const SERVER_VERSION = "1.0.0";

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Canvas ids are 64-bit integers, which exceed what JavaScript can represent
 * exactly. This Accept type makes Canvas return every id as a string, so ids
 * survive parsing without silent precision loss.
 */
export const CANVAS_STRING_IDS_ACCEPT = "application/json+canvas-string-ids, application/json";

/** Maximum characters returned by any single tool call before truncation kicks in. */
export const CHARACTER_LIMIT = 25_000;

/**
 * Canvas documents no hard `per_page` maximum and silently caps oversized
 * values, so this bound is the server's own: it keeps a single tool call from
 * returning more than an agent can usefully read.
 */
export const MAX_PER_PAGE = 100;
export const DEFAULT_PER_PAGE = 20;

/** HTML entities and tags are stripped from Canvas rich text before rendering. */
export const HTML_SNIPPET_LIMIT = 1_500;

/**
 * Canvas silently ignores context codes past the tenth on the calendar
 * endpoint, which would otherwise look like missing data rather than a cap.
 */
export const MAX_CALENDAR_CONTEXT_CODES = 10;

/* -------------------------------------------------------------------------- */
/* Enum values, transcribed from the Canvas API reference                      */
/* -------------------------------------------------------------------------- */

/** Assignment state relative to the calling user. */
export const ASSIGNMENT_BUCKETS = [
  "past",
  "overdue",
  "undated",
  "ungraded",
  "unsubmitted",
  "upcoming",
  "future",
] as const;

export const ASSIGNMENT_ORDER_BY = ["position", "name", "due_at"] as const;

/**
 * Filters on the caller's own enrollment. Deliberately distinct from
 * ENROLLMENT_STATES below — the Courses API and the Enrollments API use
 * disjoint vocabularies for what looks like the same concept.
 */
export const COURSE_ENROLLMENT_STATES = ["active", "invited_or_pending", "completed"] as const;

/** Filters on the course's own workflow_state. */
export const COURSE_STATES = ["unpublished", "available", "completed", "deleted"] as const;

/** Accepted by the Enrollments API's state[] parameter. */
export const ENROLLMENT_STATES = [
  "active",
  "invited",
  "creation_pending",
  "rejected",
  "completed",
  "inactive",
  "current_and_invited",
  "current_and_future",
  "current_and_concluded",
] as const;

export const DISCUSSION_ORDER_BY = ["position", "recent_activity", "title"] as const;

export const DISCUSSION_SCOPES = ["locked", "unlocked", "pinned", "unpinned"] as const;

export const PAGE_SORT_FIELDS = ["title", "created_at", "updated_at"] as const;

export const FILE_SORT_FIELDS = [
  "name",
  "size",
  "created_at",
  "updated_at",
  "content_type",
  "user",
] as const;

export const SORT_ORDERS = ["asc", "desc"] as const;
