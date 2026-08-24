/**
 * Course content tools — modules, pages and files.
 *
 * This is the material side of a course, as opposed to the graded work covered
 * by the assignment tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatFile, formatModule, formatModuleItem, formatPage } from "../formatters/entities.js";
import {
  buildPageMeta,
  emptyResult,
  paginationFooter,
  toolResult,
  withErrorHandling,
} from "../formatters/response.js";
import {
  getPageSchema,
  listFilesSchema,
  listModuleItemsSchema,
  listModulesSchema,
  listPagesSchema,
} from "../schemas/inputs.js";
import { listOutput, singleOutput } from "../schemas/outputs.js";
import type { CanvasClientConfig } from "../services/canvas-client.js";
import { request, requestPage } from "../services/canvas-client.js";
import type { CanvasFile, CourseModule, ModuleItem, Page } from "../types.js";

export const registerContentTools = (server: McpServer, config: CanvasClientConfig): void => {
  server.registerTool(
    "canvas_list_modules",
    {
      title: "List Canvas Modules",
      description: `List a course's modules — the week-by-week structure of its material.

Modules are how most courses organise readings, lectures and assignments, so this is the best single view of "what is this course actually covering". For a student the 'state' field also shows progress: locked, unlocked, started or completed.

Args:
  - course_id (string): from canvas_list_courses
  - include_items (boolean): include each module's items inline (default: true)
  - search_term (string): partial module name match
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "modules": [ { "id": string, "name": string, "position": number, "state": string,
                   "items_count": number, "completed_at": string,
                   "items": [ { "id": string, "title": string, "type": string,
                                "content_id": string, "page_url": string,
                                "completion_requirement": { "type": string, "completed": boolean } } ] } ]
  }

Examples:
  - "What are we covering in week 3?" -> search_term='week 3'
  - "How far through the modules am I?" -> read 'state' and completion_requirement.completed
  - Don't use when: you want graded work with due dates (use canvas_list_assignments)

Error Handling:
  - Canvas omits 'items' for modules it considers too large even when requested — the output says so, and canvas_list_module_items fetches them
  - 'state' and 'completed_at' are present only for student enrollments`,
      inputSchema: listModulesSchema,
      outputSchema: listOutput("modules"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listModulesSchema>) => {
      const { items, has_more } = await requestPage<CourseModule>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/modules`,
        {
          query: {
            include: params.include_items ? ["items", "content_details"] : undefined,
            search_term: params.search_term,
            page: params.page,
            per_page: params.per_page,
          },
        },
      );

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, modules: items };

      if (items.length === 0) {
        return emptyResult(
          "No modules in this course. Not every course uses them — try canvas_list_pages or " +
            "canvas_list_assignments instead.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Modules (${items.length})`,
          "",
          items.map(formatModule).join("\n\n"),
          paginationFooter(meta, "canvas_list_modules"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_list_module_items",
    {
      title: "List Canvas Module Items",
      description: `List the items inside one module.

Needed when canvas_list_modules reports a module whose items Canvas declined to inline.

Args:
  - course_id (string): from canvas_list_courses
  - module_id (string): from canvas_list_modules
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "items": [ { "id": string, "title": string, "type": string, "content_id": string,
                 "page_url": string, "html_url": string, "indent": number,
                 "completion_requirement": { "type": string, "completed": boolean },
                 "content_details": { "due_at": string, "points_possible": number } } ]
  }

Examples:
  - "What's in the week 5 module?" -> module_id from canvas_list_modules
  - Don't use when: canvas_list_modules already inlined the items

Error Handling:
  - 'type' is one of File, Page, Discussion, Assignment, Quiz, SubHeader, ExternalUrl, ExternalTool
  - Page items are addressed by 'page_url', not content_id — pass that slug to canvas_get_page`,
      inputSchema: listModuleItemsSchema,
      outputSchema: listOutput("items"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listModuleItemsSchema>) => {
      const { items, has_more } = await requestPage<ModuleItem>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/modules/${encodeURIComponent(params.module_id)}/items`,
        {
          query: {
            include: ["content_details"],
            page: params.page,
            per_page: params.per_page,
          },
        },
      );

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, items };

      if (items.length === 0) {
        return emptyResult("That module has no items.", structured);
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Module items (${items.length})`,
          "",
          items.map(formatModuleItem).join("\n"),
          paginationFooter(meta, "canvas_list_module_items"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_list_pages",
    {
      title: "List Canvas Pages",
      description: `List a course's wiki pages.

Pages hold course notes, policies and reference material — anything an instructor wrote directly into Canvas rather than uploading.

Args:
  - course_id (string): from canvas_list_courses
  - search_term (string): partial title match
  - sort ('title' | 'created_at' | 'updated_at'): sort field (default: 'updated_at')
  - order ('asc' | 'desc'): sort direction (default: 'desc')
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "pages": [ { "page_id": string, "url": string, "title": string, "updated_at": string,
                 "published": boolean, "front_page": boolean } ]
  }

Examples:
  - "What pages does this course have?" -> call with the course id
  - "Find the late policy" -> search_term='late'
  - Don't use when: you want the page's text (use canvas_get_page with its url slug)

Error Handling:
  - Bodies are NOT included here — fetch one with canvas_get_page
  - Note the identifier field is 'url' (a slug like 'week-1-reading'), and the numeric id is 'page_id'`,
      inputSchema: listPagesSchema,
      outputSchema: listOutput("pages"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listPagesSchema>) => {
      const { items, has_more } = await requestPage<Page>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/pages`,
        {
          query: {
            search_term: params.search_term,
            sort: params.sort,
            order: params.order,
            page: params.page,
            per_page: params.per_page,
          },
        },
      );

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, pages: items };

      if (items.length === 0) {
        return emptyResult("No pages in this course.", structured);
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Pages (${items.length})`,
          "",
          items.map((page) => formatPage(page)).join("\n\n"),
          paginationFooter(meta, "canvas_list_pages"),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "canvas_get_page",
    {
      title: "Get Canvas Page",
      description: `Fetch one wiki page's full text.

Args:
  - course_id (string): from canvas_list_courses
  - page_url (string): the page's url SLUG, e.g. 'week-1-reading', from canvas_list_pages.
    This is not the page title — Canvas resolves the slug, and a title with spaces will 404
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  { "page": { "page_id": string, "url": string, "title": string, "body": string,
              "updated_at": string, "published": boolean } }

Examples:
  - "What does the syllabus page say?" -> page_url from canvas_list_pages
  - Don't use when: you want the course's syllabus field (use canvas_get_course with include_syllabus)

Error Handling:
  - 404 almost always means a title was passed where the slug was expected — list pages and use their 'url'
  - Body HTML is flattened to plain text and truncated if very long`,
      inputSchema: getPageSchema,
      outputSchema: singleOutput("page"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof getPageSchema>) => {
      const page = await request<Page>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/pages/${encodeURIComponent(params.page_url)}`,
      );

      return toolResult(params.response_format, { page }, () => formatPage(page, true));
    }),
  );

  server.registerTool(
    "canvas_list_files",
    {
      title: "List Canvas Files",
      description: `List files uploaded to a course — slides, readings, problem sets.

Returns metadata and a download URL. It does not read file contents; the url is for the user to open.

Args:
  - course_id (string): from canvas_list_courses
  - search_term (string): partial file name match
  - content_types (array): MIME types or prefixes, e.g. ['application/pdf'] or ['image']
  - sort ('name' | 'size' | 'created_at' | 'updated_at' | 'content_type' | 'user'): sort field (default: 'updated_at')
  - order ('asc' | 'desc'): sort direction (default: 'desc')
  - page (number), per_page (number): pagination
  - response_format ('markdown' | 'json'): output format (default: 'markdown')

Returns:
  {
    "page": number, "count": number, "has_more": boolean,
    "files": [ { "id": string, "display_name": string, "filename": string,
                 "content-type": string, "size": number, "url": string, "updated_at": string } ]
  }

Examples:
  - "What slides are posted?" -> content_types=['application/pdf']
  - "Find the problem set" -> search_term='problem set'
  - Don't use when: the material is a Canvas page rather than an upload (use canvas_list_pages)

Error Handling:
  - The MIME field is spelled 'content-type' with a hyphen, unlike every other Canvas field
  - Download URLs are time-limited; re-list to get a fresh one rather than reusing an old link
  - A 403 usually means the course hides its Files tab from students`,
      inputSchema: listFilesSchema,
      outputSchema: listOutput("files"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withErrorHandling(async (params: z.infer<typeof listFilesSchema>) => {
      const { items, has_more } = await requestPage<CanvasFile>(
        config,
        `/courses/${encodeURIComponent(params.course_id)}/files`,
        {
          query: {
            search_term: params.search_term,
            content_types: params.content_types,
            sort: params.sort,
            order: params.order,
            page: params.page,
            per_page: params.per_page,
          },
        },
      );

      const meta = buildPageMeta(params.page, params.per_page, items.length, has_more);
      const structured = { ...meta, files: items };

      if (items.length === 0) {
        return emptyResult(
          "No files matched. Many courses hide the Files tab from students and post material " +
            "inside modules instead — try canvas_list_modules.",
          structured,
        );
      }

      return toolResult(params.response_format, structured, () =>
        [
          `# Files (${items.length})`,
          "",
          items.map(formatFile).join("\n"),
          paginationFooter(meta, "canvas_list_files"),
        ].join("\n"),
      );
    }),
  );
};
