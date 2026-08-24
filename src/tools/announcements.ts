/**
 * Announcement and discussion tools.
 *
 * Canvas models announcements as discussion topics with a flag, so the two
 * share a response shape; they differ mainly in how they are addressed.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatDiscussion, formatDiscussionEntry } from "../formatters/entities.js";
import {
  buildPageMeta,
  emptyResult,
  paginationFooter,
  toolResult,
  withErrorHandling,
} from "../formatters/response.js";
import {
  getDiscussionSchema,
  listAnnouncementsSchema,
  listDiscussionsSchema,
} from "../schemas/inputs.js";
import { listOutput, singleOutput } from "../schemas/outputs.js";
import type { CanvasClientConfig } from "../services/canvas-client.js";
import { request, requestPage } from "../services/canvas-client.js";
import type { DiscussionEntry, DiscussionTopic } from "../types.js";

export const registerAnnouncementTools = (server: McpServer, config: CanvasClientConfig): void => {
  server.registerTool(
    "canvas_list_announcements",
    {
      title: "List Canvas Announcements",
      description: `Read instructor announcements across one or more courses.

Announcements are how instructors broadcast changes — a moved deadline, a cancelled lecture, an exam clarification — so this is the tool for "what did my professors say" and "did I miss anything".

Canvas REQUIRES at least one course here; there is no global announcements feed. Get ids from canvas_list_courses first and pass them all in one call.

Args:
  - course_ids (array, REQUIRED): courses to read, as ids or 'course_123' codes
  - start_date (string): oldest announcement to return (Canvas defaults to 14 days ago)
  - end_date (string): newest announcement to return
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "announcements": [ { "id": string, "title": string, "message": string,
                         "posted_at": string, "context_code": string, "html_url": string,
                         "author": { "display_name": string } } ]
  }

Examples:
  - "Any announcements this week?" -> pass every course id from canvas_list_courses
  - "What did my professor say about the exam?" -> one course id, then read the messages
  - Don't use when: you want student discussion threads (use canvas_list_discussions)

Error Handling:
  - Calling with no course_ids is rejected before the request — Canvas has no global feed
  - The default window is only the last 14 days; pass start_date to reach further back
  - A 403 means one of the listed courses denies announcement access, which fails the whole call`,
      inputSchema: listAnnouncementsSchema,
      outputSchema: listOutput("announcements"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listAnnouncementsSchema>) => {
      const { items, has_more } = await requestPage<DiscussionTopic>(config, "/announcements", {
        query: {
          context_codes: params.course_ids,
          start_date: params.start_date,
          end_date: params.end_date,
          page: params.page,
          per_page: params.per_page,
        },
      });

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, announcements: items };

      if (items.length === 0) {
        return emptyResult(
          "No announcements in that window. Canvas looks back only 14 days by default — " +
            "pass start_date to search further back.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Announcements (${items.length})`,
          "",
          items.map((topic) => formatDiscussion(topic)).join("\n\n"),
          paginationFooter(meta, "canvas_list_announcements"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_list_discussions",
    {
      title: "List Canvas Discussions",
      description: `List discussion topics in a course.

Args:
  - course_id (string): from canvas_list_courses
  - order_by ('position' | 'recent_activity' | 'title'): sort order (default: 'recent_activity')
  - scope ('locked' | 'unlocked' | 'pinned' | 'unpinned'): filter by topic state
  - search_term (string): partial title match
  - only_announcements (boolean): return only announcements (default: false)
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "discussions": [ { "id": string, "title": string, "message": string,
                       "posted_at": string, "discussion_subentry_count": number,
                       "read_state": string, "pinned": boolean, "locked": boolean,
                       "html_url": string } ]
  }

Examples:
  - "What's being discussed in CS 61A?" -> order_by='recent_activity'
  - "Any unread discussions?" -> scan read_state for 'unread'
  - Don't use when: you want the full thread of one topic (use canvas_get_discussion)

Error Handling:
  - Canvas applies 'scope' AFTER paginating, so a filtered page can come back shorter than per_page — that is not the end of the results
  - Message bodies are excerpts here; canvas_get_discussion returns the full text`,
      inputSchema: listDiscussionsSchema,
      outputSchema: listOutput("discussions"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listDiscussionsSchema>) => {
      const { items, has_more } = await requestPage<DiscussionTopic>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/discussion_topics`,
        {
          query: {
            order_by: params.order_by,
            scope: params.scope,
            search_term: params.search_term,
            only_announcements: params.only_announcements,
            page: params.page,
            per_page: params.per_page,
          },
        },
      );

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, discussions: items };

      if (items.length === 0) {
        return emptyResult(
          params.scope
            ? `No discussions matched scope='${params.scope}'. Canvas filters after paginating, so try a later page or drop the scope.`
            : "No discussion topics in this course.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Discussions (${items.length})`,
          "",
          items.map((topic) => formatDiscussion(topic)).join("\n\n"),
          paginationFooter(meta, "canvas_list_discussions"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_get_discussion",
    {
      title: "Get Canvas Discussion",
      description: `Fetch one discussion topic in full, with its replies.

Args:
  - course_id (string): from canvas_list_courses
  - topic_id (string): from canvas_list_discussions
  - include_replies (boolean): also fetch the thread's replies (default: true)
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "topic": { "id": string, "title": string, "message": string, "posted_at": string,
               "author": { "display_name": string }, "html_url": string },
    "entries": [ { "id": string, "user_name": string, "message": string, "created_at": string,
                   "recent_replies": [...] } ]
  }

Examples:
  - "What did people say in the project thread?" -> include_replies=true
  - "Summarise the discussion about the midterm" -> read topic then entries
  - Don't use when: you only need topic titles (use canvas_list_discussions)

Error Handling:
  - A 403 mentioning require_initial_post means Canvas hides replies until you have posted; the topic body still returns
  - Only top-level entries are returned, each carrying up to its 10 most recent replies`,
      inputSchema: getDiscussionSchema,
      outputSchema: singleOutput("topic"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof getDiscussionSchema>) => {
      const base = `/courses/${encodeURIComponent(params.course_id)}/discussion_topics/${encodeURIComponent(params.topic_id)}`;
      const topic = await request<DiscussionTopic>(config, base);

      let entries: DiscussionEntry[] = [];
      let repliesNote = "";

      if (params.include_replies) {
        try {
          entries = (await requestPage<DiscussionEntry>(config, `${base}/entries`)).items;
        } catch {
          // A topic requiring an initial post returns 403 on entries while the
          // topic body itself reads fine. Degrading beats failing the call.
          repliesNote =
            "_Replies are not readable — this topic likely requires you to post before seeing others' responses._";
        }
      }

      const structured = { topic, entries };

      return toolResult(params.response_format, structured, () =>
        [
          formatDiscussion(topic, true),
          "",
          repliesNote ||
            (entries.length > 0
              ? `**Replies (${entries.length})**\n\n${entries.map((entry) => formatDiscussionEntry(entry)).join("\n\n")}`
              : "_No replies yet._"),
        ].join("\n"),
      );
    }),
  );
};
