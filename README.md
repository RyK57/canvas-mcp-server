# canvas-mcp-server

MCP server for the [Canvas LMS](https://www.instructure.com/canvas) REST API. Gives an LLM read access to your courses, assignments, grades, submissions, announcements, discussions, modules, pages and files.

20 tools, all read-only.

## Requirements

- Node.js 18+
- A Canvas account at any institution
- An access token from **Account → Settings → New Access Token** in your Canvas web UI

## Install

```bash
npm install
npm run build
```

## Configure

Canvas has **no shared API host** — every institution runs its own. Both variables below are required.

```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["/absolute/path/to/canvas-mcp-server/dist/index.js"],
      "env": {
        "CANVAS_BASE_URL": "https://bcourses.berkeley.edu",
        "CANVAS_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CANVAS_BASE_URL` | yes | — | Your institution's Canvas host, scheme included, no trailing path |
| `CANVAS_ACCESS_TOKEN` | yes | — | Account → Settings → New Access Token |
| `CANVAS_REQUEST_TIMEOUT_MS` | no | `30000` | Per-request timeout |
| `TRANSPORT` | no | `stdio` | `stdio` or `http` |
| `PORT` / `HOST` | no | `3000` / `127.0.0.1` | HTTP transport bind address |
| `MCP_PATH_SECRET` | when hosted | — | Serves the endpoint at `/mcp/<secret>`. **Required** when `HOST` is not loopback |
| `ALLOWED_ORIGINS` | no | localhost + claude.ai | Comma-separated origin allowlist |

Inspect the tools interactively:

```bash
CANVAS_BASE_URL=https://your.canvas CANVAS_ACCESS_TOKEN=your-token npm run inspect
```

## Deploying (for Claude mobile / claude.ai connectors)

Claude connects to custom connectors from Anthropic's cloud, not from your device, so mobile and claude.ai need this reachable over public HTTPS. Claude Code and Claude Desktop don't — use stdio there instead.

### 1. Generate a path secret

```bash
openssl rand -hex 32
```

The server refuses to start on a non-loopback interface without `MCP_PATH_SECRET` set, because a public endpoint holding your Canvas token is an open proxy to your account. With it set, the endpoint moves to `/mcp/<secret>` and every other path returns 404 — including a wrong secret, so probing the host doesn't reveal that an MCP server lives there.

### 2. Deploy

The included `Dockerfile` and `railway.json` work as-is on Railway, Render, or Fly. The image sets `TRANSPORT=http` and `HOST=0.0.0.0` and runs as a non-root user. Set three variables in the platform's dashboard:

| Variable | Value |
|---|---|
| `CANVAS_BASE_URL` | your institution's Canvas host |
| `CANVAS_ACCESS_TOKEN` | your token |
| `MCP_PATH_SECRET` | the value from step 1 |

`PORT` is injected by the platform. `/healthz` is an unauthenticated liveness probe.

### 3. Verify

```bash
curl -s https://your-app.up.railway.app/healthz
```

### 4. Add the connector

On claude.ai **in a browser** — connectors can't be added from the mobile app:

1. **Customize → Connectors → Add custom connector**
2. URL: `https://your-app.up.railway.app/mcp/<secret>`
3. On your phone, open a chat and enable it under **+ → Connectors**

Treat that URL like a password. If it leaks, rotate `MCP_PATH_SECRET` and re-add the connector.

## Tools

**Courses** — `canvas_list_courses`, `canvas_get_course`, `canvas_get_grades`, `canvas_list_enrollments`, `canvas_get_profile`

**Assignments** — `canvas_list_assignments`, `canvas_get_assignment`, `canvas_get_submission`, `canvas_list_quizzes`

**Planner** — `canvas_list_planner_items`, `canvas_list_upcoming`, `canvas_list_calendar_events`

**Announcements and discussions** — `canvas_list_announcements`, `canvas_list_discussions`, `canvas_get_discussion`

**Course content** — `canvas_list_modules`, `canvas_list_module_items`, `canvas_list_pages`, `canvas_get_page`, `canvas_list_files`

Every read tool takes `response_format: "markdown" | "json"`. Markdown is the default and is optimized for an LLM reading it; JSON is the full structured payload. `structuredContent` is always populated regardless of format.

## Examples

**"What's due this week?"**
→ `canvas_list_planner_items` with `end_date` a week out. Spans every course in one call and reports submission state. It starts from today by default, so for "what am I behind on" pass an explicit earlier `start_date`.

**"What are my grades?"**
→ `canvas_get_grades`. One call, every active course, current score and letter grade.

**"What did my professors announce this week?"**
→ `canvas_list_courses` for ids, then `canvas_list_announcements` with all of them at once.

**"What do I actually have to do for project 2?"**
→ `canvas_list_assignments` with `search_term="project 2"` to get the id, then `canvas_get_assignment` for the full instructions.

## Design notes

**Read-only by construction.** Every tool carries `readOnlyHint: true` and `destructiveHint: false`, and the client has no write path exposed. Canvas tokens carry the full authority of your account — they can submit assignments, post to discussions, and change profile settings — so the server deliberately declines to expose any of that. A test asserts this: if a write tool is ever added, the suite fails.

**The base URL is required, not defaulted.** Unlike single-tenant APIs, Canvas runs one instance per institution. There is no sensible default, and a token issued by one school's Canvas is meaningless at another, so the server fails at startup rather than misleading you with 401s later.

**Pagination lives in a header.** Canvas reports "is there a next page" in an RFC 5988 `Link` header and never returns a total count. Those URLs are documented as opaque, so `has_more` is read from the header while `page`/`per_page` stay the caller-facing controls — an agent gets a simple `next_page` to follow instead of a cursor to thread.

**Ids are requested as strings.** Canvas ids are 64-bit integers, which JavaScript cannot represent exactly. The client sends `Accept: application/json+canvas-string-ids`, which Canvas honours by returning every id as a string, so ids survive a JSON round trip intact.

**HTML is flattened before it reaches the model.** Assignment descriptions, announcements, discussion posts and pages are all stored as HTML. Passing that through verbatim burns enormous context on markup, so tags become line breaks, entities are decoded, and long bodies are excerpted with the `html_url` kept for the full version.

**`include[]` is not exposed.** Canvas has two dozen include options, they differ between the list and single-course endpoints, and most control fields an agent has no use for. Each tool requests what it needs and surfaces only the toggles that change what a user would see — `include_syllabus`, `include_grades`, `include_submission`.

**Course ids are normalised into context codes.** Some Canvas endpoints address courses as `course_1234` rather than `1234`. Both forms are accepted everywhere and converted, so the agent never has to remember which endpoint wants which.

**Errors resolve to next actions.** A 404 names the tool that produces valid ids for that resource. A 403 distinguishes a permissions problem from an exhausted rate limit, which Canvas confusingly returns under the same status. A 401 points out that a token from one school's Canvas will not work at another.

**Two Canvas quirks are handled rather than passed on.** The grade a course reports under `enrollments[].computed_current_score` is the same number the Enrollments API calls `grades.current_score`; both are read. And a planner item's `submissions` field is the boolean `false` — not an object — when nothing is submittable, which is checked before it is read.

## Caveats

- Announcements cannot be listed globally: Canvas requires at least one course id, so `canvas_list_courses` has to run first.
- `canvas_list_discussions` applies its `scope` filter *after* paginating, so a filtered page can come back shorter than `per_page` without being the end of the results.
- Canvas omits module items from the list response for modules it considers large; `canvas_list_module_items` fetches them.
- Pages are addressed by url slug (`week-1-reading`), not title. `canvas_list_pages` returns the slug in its `url` field.
- The calendar endpoint accepts at most 10 courses and silently ignores the rest; `canvas_list_calendar_events` reports when it trims.
- Grades reflect only what an instructor has posted, and are omitted entirely for courses configured to hide final grades.

## Project layout

```
src/
├── index.ts               # entry point, transport selection
├── constants.ts           # enum values, limits, character limit
├── types.ts               # interfaces for every Canvas entity
├── services/
│   └── canvas-client.ts   # fetch wrapper, auth, Link pagination, error → guidance mapping
├── schemas/
│   ├── inputs.ts          # Zod input schemas
│   └── outputs.ts         # structuredContent schemas
├── formatters/
│   ├── response.ts        # pagination, truncation, HTML flattening, format dispatch
│   └── entities.ts        # per-entity markdown rendering
└── tools/
    ├── courses.ts
    ├── assignments.ts
    ├── planner.ts
    ├── announcements.ts
    └── content.ts
```

## Tests

```bash
npm run build
npm test            # 43 checks: MCP handshake, tools, pagination, formatting, errors (mocked API)
npm run test:http   # 19 checks: config validation, path-secret gating, method handling, origins
```

Both suites run against a local mock, so no token or network access is needed.
