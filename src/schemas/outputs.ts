/**
 * Output schemas describing the `structuredContent` each tool returns.
 *
 * These are deliberately permissive (`passthrough`, optional fields). Canvas
 * varies its payloads by institution, enrollment role and `include[]` options,
 * so a strict output schema would turn a field that simply was not requested
 * into a hard tool failure.
 */

import { z } from "zod";

const pageShape = {
  page: z.number(),
  per_page: z.number(),
  count: z.number(),
  has_more: z.boolean(),
  next_page: z.number().optional(),
};

const loose = z.object({}).passthrough();

/** List response: page metadata plus an array under a named key. */
export const listOutput = (key: string) =>
  z.object({ ...pageShape, [key]: z.array(loose) }).passthrough();

export const singleOutput = (key: string) =>
  z.object({ [key]: loose.nullable() }).passthrough();

export const profileOutput = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    short_name: z.string().optional(),
    primary_email: z.string().optional(),
    login_id: z.string().optional(),
    time_zone: z.string().optional(),
  })
  .passthrough();

export const gradesOutput = z
  .object({
    count: z.number(),
    courses: z.array(loose),
  })
  .passthrough();

export const searchOutput = z
  .object({
    query: z.string().optional(),
    count: z.number(),
    pages_scanned: z.number(),
    scan_complete: z.boolean(),
    courses: z.array(loose),
  })
  .passthrough();
