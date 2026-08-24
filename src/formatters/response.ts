/**
 * Shared response construction: pagination metadata, character-limit
 * truncation, HTML flattening, and the markdown primitives every formatter
 * reuses.
 */

import { CHARACTER_LIMIT, HTML_SNIPPET_LIMIT } from "../constants.js";
import { describeError } from "../services/canvas-client.js";

export const RESPONSE_FORMATS = ["markdown", "json"] as const;
export type ResponseFormat = (typeof RESPONSE_FORMATS)[number];

/**
 * Shape returned by every tool handler.
 * The index signature is required to satisfy the SDK's `CallToolResult`.
 */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface PageMeta {
  page: number;
  per_page: number;
  count: number;
  has_more: boolean;
  next_page?: number;
}

/**
 * Builds pagination metadata. Canvas reports "is there a next page" in the
 * Link header and never a total count, so `has_more` is authoritative while a
 * total is simply unavailable.
 */
export const buildPageMeta = (
  page: number,
  perPage: number,
  count: number,
  hasMore: boolean,
): PageMeta => ({
  page,
  per_page: perPage,
  count,
  has_more: hasMore,
  ...(hasMore ? { next_page: page + 1 } : {}),
});

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/**
 * Flattens Canvas rich text into readable plain text.
 *
 * Assignment descriptions, announcements and discussion posts are stored as
 * HTML. Passing that through verbatim burns an enormous amount of context on
 * markup an agent does not need, so tags become whitespace or line breaks and
 * entities are decoded. Links keep their text and drop their href.
 */
export const stripHtml = (html: string | null | undefined, limit = HTML_SNIPPET_LIMIT): string => {
  if (!html) return "";

  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
};

/** Formats an ISO timestamp as a compact, readable UTC string. */
export const formatTimestamp = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/:\d{2}\.\d+Z$/, " UTC").replace(/Z$/, " UTC");
};

/**
 * Renders a due date with its distance from now, since "due in 2 days" is the
 * part a student actually acts on. `reference` is injectable so tests do not
 * depend on the wall clock.
 */
export const formatDueDate = (iso: string | null | undefined, reference = new Date()): string => {
  if (!iso) return "no due date";
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return iso;

  const diffMs = due.getTime() - reference.getTime();
  const absHours = Math.abs(diffMs) / 3_600_000;
  const stamp = formatTimestamp(iso);

  if (absHours < 1) return `${stamp} (due now)`;
  if (absHours < 48) {
    const hours = Math.round(absHours);
    return `${stamp} (${diffMs > 0 ? `in ${hours}h` : `${hours}h overdue`})`;
  }
  const days = Math.round(absHours / 24);
  return `${stamp} (${diffMs > 0 ? `in ${days} days` : `${days} days overdue`})`;
};

/** Appends a "showing page X" footer with the follow-up call to make. */
export const paginationFooter = (meta: PageMeta, toolName: string): string =>
  meta.has_more
    ? `\n_Page ${meta.page} — more results exist. Call ${toolName} with page=${meta.next_page} to continue._`
    : `\n_Page ${meta.page} — end of results._`;

/**
 * Truncates oversized markdown so a single tool call cannot blow out the
 * agent's context, and says explicitly how to get the rest.
 */
const truncateText = (text: string, remedy: string): string => {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    `${text.slice(0, CHARACTER_LIMIT)}\n\n` +
    `_[Truncated at ${CHARACTER_LIMIT} characters. ${remedy}]_`
  );
};

/**
 * Assembles the final tool result in the requested format.
 * `structured` is always attached so clients that consume structuredContent
 * get the full, untruncated data regardless of the text rendering.
 */
export const toolResult = (
  format: ResponseFormat,
  structured: Record<string, unknown>,
  markdown: () => string,
  remedy = "Reduce per_page or narrow your filters to see the rest.",
): ToolResult => {
  const text =
    format === "json"
      ? truncateText(JSON.stringify(structured, null, 2), remedy)
      : truncateText(markdown(), remedy);

  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
};

/** Wraps a tool handler so every thrown error becomes actionable agent-facing text. */
export const withErrorHandling = <TArgs>(
  handler: (args: TArgs) => Promise<ToolResult>,
): ((args: TArgs) => Promise<ToolResult>) => {
  return async (args: TArgs): Promise<ToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      return {
        content: [{ type: "text", text: describeError(error) }],
        isError: true,
      };
    }
  };
};

/** Standard empty-result response with guidance on what to try instead. */
export const emptyResult = (message: string, structured: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: message }],
  structuredContent: structured,
});
