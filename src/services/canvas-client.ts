/**
 * Thin functional wrapper over the Canvas LMS REST API.
 *
 * Uses the global fetch available in Node 18+ so the server ships with no HTTP
 * dependency. Every request carries the bearer token Canvas requires and an
 * AbortController-based timeout.
 *
 * Two Canvas behaviours shape this module:
 *
 *   - Pagination lives in the RFC 5988 `Link` response header, not the body.
 *     Canvas documents those URLs as opaque, so `hasMore` is read from the
 *     header while `page`/`per_page` stay the caller-facing controls.
 *   - Canvas ids are 64-bit integers, which JavaScript cannot represent
 *     exactly. Requesting `application/json+canvas-string-ids` makes Canvas
 *     return them as strings, so ids survive a JSON round trip intact.
 */

import { CANVAS_STRING_IDS_ACCEPT, DEFAULT_TIMEOUT_MS } from "../constants.js";

export interface CanvasClientConfig {
  accessToken: string;
  baseUrl: string;
  timeoutMs: number;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** Query values Canvas accepts. Arrays become repeated `key[]=` parameters. */
export type QueryValue = string | number | boolean | string[] | number[] | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

/** A single page of a Canvas list endpoint, plus whether another page exists. */
export interface Page<T> {
  items: T[];
  has_more: boolean;
}

/**
 * Error carrying the HTTP status so callers can produce status-specific,
 * actionable guidance instead of a generic failure string.
 *
 * Built with a factory rather than a subclass: it is a real Error (so stack
 * traces and `instanceof Error` still work) with the extra fields attached.
 */
export interface CanvasApiError extends Error {
  readonly isCanvasApiError: true;
  readonly status: number;
  readonly endpoint: string;
  readonly detail: string | undefined;
}

export const canvasApiError = (
  status: number,
  endpoint: string,
  detail?: string,
): CanvasApiError =>
  Object.assign(new Error(`Canvas API ${status} on ${endpoint}${detail ? `: ${detail}` : ""}`), {
    name: "CanvasApiError",
    isCanvasApiError: true as const,
    status,
    endpoint,
    detail,
  });

export const isCanvasApiError = (error: unknown): error is CanvasApiError =>
  typeof error === "object" &&
  error !== null &&
  (error as Partial<CanvasApiError>).isCanvasApiError === true;

/**
 * Reads configuration from the environment and fails fast with setup
 * instructions when either required value is missing.
 *
 * Unlike a single-tenant API, Canvas has no shared host: the base URL is the
 * institution's own domain, so it is required rather than defaulted.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): CanvasClientConfig => {
  const accessToken = env.CANVAS_ACCESS_TOKEN?.trim();
  const rawBaseUrl = env.CANVAS_BASE_URL?.trim();

  if (!accessToken) {
    throw new Error(
      "CANVAS_ACCESS_TOKEN is not set. Generate one in Canvas under " +
        "Account > Settings > Approved Integrations > New Access Token, and expose it to " +
        'this server, e.g. via the "env" block of your MCP client config.',
    );
  }

  if (!rawBaseUrl) {
    throw new Error(
      "CANVAS_BASE_URL is not set. Canvas has no shared API host — use the domain you log " +
        "in to, e.g. https://bcourses.berkeley.edu or https://canvas.instructure.com. " +
        "Include the scheme and no trailing path.",
    );
  }

  let baseUrl: string;
  try {
    const parsed = new URL(rawBaseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      // Canvas redirects HTTP to HTTPS, but only after the token has already
      // crossed the network in the clear.
      throw new Error("must use https");
    }
    baseUrl = `${parsed.origin}`;
  } catch {
    throw new Error(
      `CANVAS_BASE_URL is not a usable https URL: "${rawBaseUrl}". ` +
        "Expected something like https://bcourses.berkeley.edu — scheme included, no trailing path.",
    );
  }

  const timeoutRaw = Number(env.CANVAS_REQUEST_TIMEOUT_MS);

  return {
    accessToken,
    baseUrl,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS,
  };
};

/**
 * Builds a request URL. Array values are appended as repeated `key[]=value`
 * pairs, which is the form Canvas expects for `include[]`, `state[]` and
 * friends — a comma-joined single value is silently ignored.
 */
const buildUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, QueryValue>,
): string => {
  const url = new URL(`${baseUrl}/api/v1${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(`${key}[]`, String(entry));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

/**
 * Reports whether a `Link` header advertises a further page.
 *
 * Canvas omits `rel="last"` when the total is expensive to compute, so the
 * presence of `rel="next"` is the only dependable signal that more exists.
 */
export const hasNextPage = (linkHeader: string | null): boolean =>
  (linkHeader ?? "").split(",").some((part) => /;\s*rel="next"/.test(part));

/** Pulls the most useful message out of Canvas's several error body shapes. */
const extractErrorDetail = (raw: string): string | undefined => {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;

      // Canvas most often returns { errors: [{ message }] }, but also
      // { errors: { field: [{ message }] } } and a bare { message }.
      const errors = record.errors;
      if (Array.isArray(errors)) {
        const messages = errors
          .map((entry) =>
            typeof entry === "string"
              ? entry
              : ((entry as Record<string, unknown> | null)?.message as string | undefined),
          )
          .filter((message): message is string => Boolean(message));
        if (messages.length > 0) return messages.join("; ");
      }
      if (errors && typeof errors === "object") {
        const flattened = Object.entries(errors as Record<string, unknown>)
          .map(([field, value]) => {
            const first = Array.isArray(value) ? value[0] : value;
            const message = (first as Record<string, unknown> | null)?.message ?? first;
            return typeof message === "string" ? `${field}: ${message}` : undefined;
          })
          .filter((entry): entry is string => Boolean(entry));
        if (flattened.length > 0) return flattened.join("; ");
      }

      for (const key of ["message", "error", "error_description"]) {
        const value = record[key];
        if (typeof value === "string") return value;
      }
    }
  } catch {
    // Body was not JSON — fall through to the raw text.
  }
  return raw.slice(0, 300);
};

/** Shared fetch path returning the raw response alongside its parsed body. */
const send = async <T>(
  config: CanvasClientConfig,
  path: string,
  options: RequestOptions,
): Promise<{ data: T; response: Response }> => {
  const { method = "GET", query, body } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(buildUrl(config.baseUrl, path, query), {
      method,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        accept: CANVAS_STRING_IDS_ACCEPT,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await response.text();

    if (!response.ok) {
      throw canvasApiError(response.status, `${method} ${path}`, extractErrorDetail(text));
    }

    if (!text.trim()) return { data: undefined as T, response };

    try {
      return { data: JSON.parse(text) as T, response };
    } catch {
      throw canvasApiError(
        response.status,
        `${method} ${path}`,
        "Response was not valid JSON. If CANVAS_BASE_URL points at a login or SSO page " +
          "rather than the Canvas host, the token is not being accepted.",
      );
    }
  } catch (error) {
    if (isCanvasApiError(error)) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw canvasApiError(
        408,
        `${method} ${path}`,
        `Request timed out after ${config.timeoutMs}ms`,
      );
    }
    throw canvasApiError(
      0,
      `${method} ${path}`,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
};

/** Performs an authenticated request and returns the parsed JSON body. */
export const request = async <T>(
  config: CanvasClientConfig,
  path: string,
  options: RequestOptions = {},
): Promise<T> => (await send<T>(config, path, options)).data;

/**
 * Performs a request against a list endpoint, returning the page plus whether
 * Canvas advertised another one. Non-array bodies collapse to an empty page so
 * a shape change upstream cannot throw inside a formatter.
 */
export const requestPage = async <T>(
  config: CanvasClientConfig,
  path: string,
  options: RequestOptions = {},
): Promise<Page<T>> => {
  const { data, response } = await send<T[]>(config, path, options);
  return {
    items: Array.isArray(data) ? data : [],
    has_more: hasNextPage(response.headers.get("link")),
  };
};

/**
 * Maps an endpoint to the tool that can resolve a valid id for it, so a 404
 * tells the agent exactly which lookup to run rather than "check the id".
 */
const lookupHint = (endpoint: string): string => {
  if (endpoint.includes("/assignments")) {
    return "No assignment with that id in that course. List valid ids with canvas_list_assignments.";
  }
  if (endpoint.includes("/discussion_topics")) {
    return "No discussion topic with that id. List valid ids with canvas_list_discussions.";
  }
  if (endpoint.includes("/modules")) {
    return "No module with that id. List valid ids with canvas_list_modules.";
  }
  if (endpoint.includes("/pages")) {
    return "No page with that url. Pages are addressed by their url slug, not their title — list them with canvas_list_pages.";
  }
  if (endpoint.includes("/quizzes")) {
    return "No quiz with that id. List valid ids with canvas_list_quizzes.";
  }
  if (endpoint.includes("/files")) {
    return "No file with that id. List valid ids with canvas_list_files.";
  }
  if (endpoint.includes("/courses")) {
    return (
      "No course with that id, or you are not enrolled in it. List the courses this token " +
      "can see with canvas_list_courses — a course you can open in the browser may still be " +
      "invisible to the API if the term has concluded."
    );
  }
  return "Verify the id exists and that this account has access to it.";
};

/**
 * Converts any thrown error into a message that tells the agent what to do
 * next, rather than just what went wrong.
 */
export const describeError = (error: unknown): string => {
  if (isCanvasApiError(error)) {
    switch (error.status) {
      case 400:
        return (
          `Error: Canvas rejected the request (400) on ${error.endpoint}. ` +
          `${error.detail ?? "Invalid parameters."} ` +
          "Common causes: a malformed date (Canvas wants ISO 8601, e.g. 2026-08-24T00:00:00Z), " +
          "or a context code that is not in the form 'course_123'."
        );
      case 401:
        return (
          `Error: Canvas rejected the access token (401) on ${error.endpoint}. ` +
          `${error.detail ?? ""} ` +
          "The token is missing, expired, or was revoked. Generate a new one under " +
          "Account > Settings > New Access Token, and confirm CANVAS_BASE_URL points at the " +
          "same Canvas instance the token was issued by — a token from one school's Canvas " +
          "is not valid at another."
        ).trim();
      case 403:
        // Canvas overloads 403: it is both "not allowed" and, per its own
        // throttling docs, what an exhausted rate-limit quota can surface as.
        return (error.detail ?? "").toLowerCase().includes("rate limit")
          ? `Error: Canvas rate limit exceeded on ${error.endpoint}. Wait a few seconds and retry, and avoid issuing requests in parallel — Canvas charges a pre-flight penalty for concurrency.`
          : `Error: Canvas denied access (403) on ${error.endpoint}. ${error.detail ?? ""} ` +
              "The token is valid but lacks permission for this resource. Student tokens cannot " +
              "read other students' submissions, unpublished content, or instructor-only endpoints.";
      case 404:
        return `Error: Not found (404) on ${error.endpoint}. ${lookupHint(error.endpoint)}`;
      case 408:
        return `Error: ${error.detail ?? "Request timed out."} Retry, or lower per_page to reduce the response size.`;
      case 429:
        return `Error: Rate limited (429) on ${error.endpoint}. Wait a few seconds before retrying, and avoid tight pagination loops — Canvas bills concurrent requests at a premium.`;
      case 0:
        return (
          `Error: Could not reach Canvas at ${error.endpoint}. ${error.detail ?? ""} ` +
          "Check that CANVAS_BASE_URL is the correct host for your institution and is reachable."
        ).trim();
      default:
        return `Error: Canvas returned ${error.status} on ${error.endpoint}. ${error.detail ?? ""}`.trim();
    }
  }

  return `Error: ${error instanceof Error ? error.message : String(error)}`;
};
