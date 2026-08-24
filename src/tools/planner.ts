/**
 * Planner tools — the cross-course "what is due" view.
 *
 * These are the only Canvas endpoints that span every course in one request,
 * which makes them the right default for deadline questions. Per-course
 * assignment listing needs one call per class.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_CALENDAR_CONTEXT_CODES } from "../constants.js";
import { formatCalendarEvent, formatPlannerItem } from "../formatters/entities.js";
import {
  buildPageMeta,
  emptyResult,
  paginationFooter,
  toolResult,
  withErrorHandling,
} from "../formatters/response.js";
import {
  listCalendarEventsSchema,
  listPlannerItemsSchema,
  listUpcomingSchema,
} from "../schemas/inputs.js";
import { listOutput } from "../schemas/outputs.js";
import type { CanvasClientConfig } from "../services/canvas-client.js";
import { requestPage } from "../services/canvas-client.js";
import type { CalendarEvent, PlannerItem } from "../types.js";

export const registerPlannerTools = (server: McpServer, config: CanvasClientConfig): void => {
  server.registerTool(
    "canvas_list_planner_items",
    {
      title: "List Canvas Planner Items",
      description: `List everything due across ALL your courses, newest first.

This is the right tool for "what do I have due", "what's this week" and "am I behind". It spans every enrolled course in one request and already carries submission state, so it answers deadline questions without a call per course.

Args:
  - start_date (string): date or ISO 8601 timestamp; only items on or after it (default: today)
  - end_date (string): only items on or before it
  - course_ids (array): limit to specific courses; accepts plain ids or 'course_123' codes
  - page (number), per_page (number): pagination, per_page max 100 (default: 20)
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "items": [ { "plannable_type": string,   // assignment | quiz | discussion_topic | calendar_event | ...
                 "plannable_date": string,
                 "course_id": string, "context_name": string, "html_url": string,
                 "plannable": { "title": string, "due_at": string, "points_possible": number },
                 "submissions": false | { "submitted": boolean, "missing": boolean,
                                          "graded": boolean, "late": boolean } } ]
  }

Examples:
  - "What's due this week?" -> start_date=today, end_date=today+7d
  - "What am I behind on?" -> scan for submissions.missing === true
  - "What's due in CS 61A?" -> course_ids=['course_1234']
  - Don't use when: you need an assignment's full instructions (use canvas_get_assignment)

Error Handling:
  - 'submissions' is the boolean false, not an object, for items with no associated assignment — check the type before reading it
  - Fields inside 'plannable' are omitted rather than nulled when they do not apply to that item type`,
      inputSchema: listPlannerItemsSchema,
      outputSchema: listOutput("items"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listPlannerItemsSchema>) => {
      const { items, has_more } = await requestPage<PlannerItem>(config, "/planner/items", {
        query: {
          start_date: params.start_date,
          end_date: params.end_date,
          context_codes: params.course_ids,
          page: params.page,
          per_page: params.per_page,
        },
      });

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, items };

      if (items.length === 0) {
        return emptyResult(
          "Nothing in the planner for that window. Widen the dates, or drop start_date to " +
            "include items already past.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Planner (${items.length} items)`,
          "",
          items.map(formatPlannerItem).join("\n"),
          paginationFooter(meta, "canvas_list_planner_items"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_list_upcoming",
    {
      title: "List Canvas Upcoming Events",
      description: `List the next few assignments and calendar events across all courses.

Canvas's own "Coming Up" sidebar. It is a short, fixed lookahead with no date controls — for a window you choose, use canvas_list_planner_items instead.

Args: none beyond response_format

Returns:
  {
    "count": number,
    "events": [ { "id": string, "title": string, "start_at": string,
                  "context_code": string, "html_url": string } ]
  }

Examples:
  - "What's coming up?" -> call with no arguments
  - Don't use when: you need a specific date range, or everything overdue (use canvas_list_planner_items)

Error Handling:
  - Assignment-backed entries have a string id like 'assignment_9729' rather than a number
  - An empty list is normal when nothing falls inside Canvas's lookahead window`,
      inputSchema: listUpcomingSchema,
      outputSchema: listOutput("events"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listUpcomingSchema>) => {
      const { items } = await requestPage<CalendarEvent>(config, "/users/self/upcoming_events");

      const meta = buildPageMeta(1, items.length, items.length, false);
      const structured = { ...meta, events: items };

      if (items.length === 0) {
        return emptyResult(
          "Nothing upcoming in Canvas's lookahead window. Try canvas_list_planner_items with " +
            "an explicit end_date for a longer horizon.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [`# Coming up (${items.length})`, "", items.map(formatCalendarEvent).join("\n")].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_list_calendar_events",
    {
      title: "List Canvas Calendar Events",
      description: `List calendar events — lectures, sections, office hours — in a date window.

Distinct from assignment due dates: those are the 'assignment' event type, and canvas_list_planner_items reports them more usefully. Use this for scheduled meetings that are not coursework.

Args:
  - start_date (string): window start, date or ISO 8601 (default: today)
  - end_date (string): window end (Canvas defaults it to start_date, i.e. a single day)
  - course_ids (array): limit to specific courses; Canvas otherwise returns only your own calendar
  - include_assignments (boolean): return assignment due dates instead of events (default: false)
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "events": [ { "id": string, "title": string, "start_at": string, "end_at": string,
                  "location_name": string, "context_code": string, "html_url": string } ]
  }

Examples:
  - "When is my next lecture?" -> course_ids for the class, start_date=today
  - "What's on my calendar tomorrow?" -> start_date and end_date both tomorrow
  - Don't use when: you want homework deadlines (use canvas_list_planner_items)

Error Handling:
  - Canvas caps this endpoint at ${MAX_CALENDAR_CONTEXT_CODES} courses and silently ignores the rest — this tool reports when it trims
  - Omitting end_date returns a single day, not an open-ended range
  - An empty result usually means no course_ids were given, since your personal calendar is the default`,
      inputSchema: listCalendarEventsSchema,
      outputSchema: listOutput("events"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listCalendarEventsSchema>) => {
      const requested = params.course_ids ?? [];
      const contextCodes = requested.slice(0, MAX_CALENDAR_CONTEXT_CODES);
      const trimmed = requested.length - contextCodes.length;

      const { items, has_more } = await requestPage<CalendarEvent>(config, "/calendar_events", {
        query: {
          type: params.include_assignments ? "assignment" : "event",
          start_date: params.start_date,
          end_date: params.end_date,
          context_codes: contextCodes.length > 0 ? contextCodes : undefined,
          page: params.page,
          per_page: params.per_page,
        },
      });

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, events: items, courses_omitted: trimmed };

      if (items.length === 0) {
        return emptyResult(
          "No calendar events in that window. Canvas defaults to your personal calendar only, " +
            "so pass course_ids to see class events. Note end_date defaults to start_date, " +
            "giving a single day.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Calendar (${items.length})`,
          trimmed > 0
            ? `\n_Canvas accepts at most ${MAX_CALENDAR_CONTEXT_CODES} courses here; ${trimmed} were dropped from this query._`
            : "",
          "",
          items.map(formatCalendarEvent).join("\n"),
          paginationFooter(meta, "canvas_list_calendar_events"),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );
};
