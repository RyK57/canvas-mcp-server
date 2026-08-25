/**
 * Smoke test: drives the built server over stdio with a real JSON-RPC handshake,
 * pointed at a local mock of the Canvas API so no token or network is needed.
 */

import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

/** Resolve the repo root from this file so the test runs from any working directory. */
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

const PORT = 8788;
const TOKEN = "1234~abcdefghijklmnopqrstuvwxyz";

// --- Mock Canvas API ---------------------------------------------------------
const courses = [
  {
    id: "1234",
    name: "Structure and Interpretation of Computer Programs",
    course_code: "COMPSCI 61A",
    workflow_state: "available",
    start_at: "2026-08-19T00:00:00Z",
    end_at: "2026-12-18T00:00:00Z",
    term: { id: "77", name: "Fall 2026" },
    syllabus_body: "<p>Grades: <strong>40%</strong> exams &amp; 60% homework.</p>",
    enrollments: [
      {
        type: "student",
        role: "StudentEnrollment",
        enrollment_state: "active",
        computed_current_score: 91.5,
        computed_current_grade: "A-",
        computed_final_score: 88,
      },
    ],
  },
  {
    id: "5678",
    name: "Linear Algebra",
    course_code: "MATH 54",
    workflow_state: "available",
    term: { id: "77", name: "Fall 2026" },
    // A course that hides final grades returns enrollments with no score fields.
    enrollments: [{ type: "student", enrollment_state: "active" }],
  },
];

const assignments = [
  {
    id: "9001",
    name: "Project 1: The Game of Hog",
    course_id: "1234",
    due_at: "2026-09-15T06:59:00Z",
    points_possible: 30,
    submission_types: ["online_upload"],
    html_url: "https://canvas.test/courses/1234/assignments/9001",
    allowed_attempts: -1,
    description: "<p>Build a simulator for <em>Hog</em>.</p><ul><li>Part A</li><li>Part B</li></ul>",
    submission: {
      id: "s1",
      assignment_id: "9001",
      score: 28.5,
      grade: "28.5",
      submitted_at: "2026-09-14T22:10:00Z",
      graded_at: "2026-09-18T12:00:00Z",
      workflow_state: "graded",
      attempt: 2,
      late: false,
      missing: false,
    },
  },
  {
    id: "9002",
    name: "Homework 4",
    course_id: "1234",
    due_at: "2026-09-01T06:59:00Z",
    points_possible: 10,
    submission_types: ["online_text_entry"],
    submission: {
      id: "s2",
      assignment_id: "9002",
      score: null,
      grade: null,
      submitted_at: null,
      workflow_state: "unsubmitted",
      attempt: null,
      late: false,
      missing: true,
    },
  },
];

const plannerItems = [
  {
    plannable_id: "9001",
    plannable_type: "assignment",
    plannable_date: "2026-09-15T06:59:00Z",
    context_type: "Course",
    course_id: "1234",
    context_name: "COMPSCI 61A",
    html_url: "/courses/1234/assignments/9001",
    plannable: { id: "9001", title: "Project 1: The Game of Hog", due_at: "2026-09-15T06:59:00Z", points_possible: 30 },
    submissions: { submitted: true, graded: true, late: false, missing: false, excused: false },
  },
  {
    plannable_id: "4001",
    plannable_type: "calendar_event",
    plannable_date: "2026-09-16T17:00:00Z",
    context_type: "Course",
    course_id: "5678",
    context_name: "MATH 54",
    plannable: { id: "4001", title: "Midterm Review Session" },
    // Canvas returns boolean false here, not an object, when nothing is submittable.
    submissions: false,
  },
];

const discussionTopic = {
  id: "7001",
  title: "Project 1 partner thread",
  message: "<p>Find a partner here. See the <a href='https://x.test'>guidelines</a>.</p>",
  posted_at: "2026-09-02T18:00:00Z",
  html_url: "https://canvas.test/courses/1234/discussion_topics/7001",
  discussion_subentry_count: 2,
  read_state: "unread",
  pinned: true,
  locked: false,
  author: { id: "42", display_name: "Prof. Hilfinger" },
};

const requestLog = [];

const mock = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requestLog.push({
      method: req.method,
      path: url.pathname,
      query: url.search,
      auth: req.headers.authorization,
      accept: req.headers.accept,
      params: url.searchParams,
    });

    const send = (code, payload, headers = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };

    /** Advertises another page only on page 1, so has_more can be tested both ways. */
    const paged = (payload) => {
      const page = Number(url.searchParams.get("page") ?? 1);
      const headers =
        page < 2
          ? { link: `<${url.href}&page=2>; rel="next", <${url.href}&page=1>; rel="current"` }
          : {};
      return send(200, payload, headers);
    };

    const p = url.pathname;

    if (p === "/api/v1/courses" && req.method === "GET") return paged(courses);
    if (p === "/api/v1/courses/9999") return send(404, { errors: [{ message: "The specified resource does not exist." }] });
    if (p === "/api/v1/courses/1234") return send(200, courses[0]);
    if (p === "/api/v1/users/self/profile")
      return send(200, { id: "42", name: "Test Student", short_name: "Test", primary_email: "t@test.edu", login_id: "t@test.edu", time_zone: "America/Los_Angeles" });
    if (p === "/api/v1/users/self/enrollments")
      return paged([{ id: "e1", course_id: "1234", type: "StudentEnrollment", role: "StudentEnrollment", enrollment_state: "active", grades: { current_score: 91.5, current_grade: "A-" } }]);
    if (p === "/api/v1/courses/1234/assignments" && req.method === "GET") {
      const bucket = url.searchParams.get("bucket");
      if (bucket === "overdue") return paged([assignments[1]]);
      return paged(assignments);
    }
    if (p === "/api/v1/courses/1234/assignments/9001") return send(200, assignments[0]);
    if (p === "/api/v1/courses/1234/assignments/9001/submissions/self")
      return send(200, { ...assignments[0].submission, submission_comments: [{ author_name: "Prof. Hilfinger", comment: "<p>Nice work on <b>Part B</b>.</p>" }] });
    if (p === "/api/v1/courses/1234/quizzes") return paged([{ id: "q1", title: "Midterm 1", due_at: "2026-10-01T02:00:00Z", points_possible: 100, question_count: 20, time_limit: 110, allowed_attempts: 1, quiz_type: "assignment" }]);
    if (p === "/api/v1/planner/items") return paged(plannerItems);
    if (p === "/api/v1/users/self/upcoming_events")
      return send(200, [{ id: "assignment_9001", title: "Project 1 due", start_at: "2026-09-15T06:59:00Z", context_code: "course_1234", context_name: "COMPSCI 61A" }]);
    if (p === "/api/v1/calendar_events") return paged([{ id: "c1", title: "Lecture", start_at: "2026-09-16T17:00:00Z", location_name: "Wheeler 150", context_code: "course_1234", context_name: "COMPSCI 61A" }]);
    if (p === "/api/v1/announcements") {
      if (!url.searchParams.getAll("context_codes[]").length)
        return send(400, { errors: [{ message: "context_codes is required" }] });
      return paged([{ ...discussionTopic, id: "8001", title: "Midterm moved to Friday", context_code: "course_1234" }]);
    }
    if (p === "/api/v1/courses/1234/discussion_topics" && req.method === "GET") return paged([discussionTopic]);
    if (p === "/api/v1/courses/1234/discussion_topics/7001") return send(200, discussionTopic);
    if (p === "/api/v1/courses/1234/discussion_topics/7001/entries")
      return paged([{ id: "en1", user_name: "Alice", message: "<p>Looking for a partner!</p>", created_at: "2026-09-03T01:00:00Z", recent_replies: [{ id: "en2", user_name: "Bob", message: "I'm in", created_at: "2026-09-03T02:00:00Z" }] }]);
    if (p === "/api/v1/courses/1234/discussion_topics/7002")
      return send(200, { ...discussionTopic, id: "7002", title: "Post first thread" });
    if (p === "/api/v1/courses/1234/discussion_topics/7002/entries")
      return send(403, { errors: [{ message: "require_initial_post" }] });
    if (p === "/api/v1/courses/1234/modules")
      return paged([
        { id: "m1", name: "Week 1: Functions", position: 1, state: "completed", items_count: 2, completed_at: "2026-08-25T00:00:00Z", items: [{ id: "mi1", title: "Lecture 1 slides", type: "File", content_id: "f1", indent: 0, completion_requirement: { type: "must_view", completed: true } }, { id: "mi2", title: "Reading", type: "Page", page_url: "week-1-reading", indent: 1 }] },
        { id: "m2", name: "Week 2: Recursion", position: 2, state: "unlocked", items_count: 40 },
      ]);
    if (p === "/api/v1/courses/1234/modules/m2/items")
      return paged([{ id: "mi3", title: "Recursion notes", type: "Page", page_url: "recursion", indent: 0 }]);
    if (p === "/api/v1/courses/1234/pages" && req.method === "GET")
      return paged([{ page_id: "p1", url: "week-1-reading", title: "Week 1 Reading", updated_at: "2026-08-20T00:00:00Z", published: true, front_page: false }]);
    if (p === "/api/v1/courses/1234/pages/week-1-reading")
      return send(200, { page_id: "p1", url: "week-1-reading", title: "Week 1 Reading", body: "<h2>Chapter 1</h2><p>Read sections 1.1&ndash;1.3.</p>", published: true, updated_at: "2026-08-20T00:00:00Z" });
    if (p === "/api/v1/courses/1234/pages/Week%201%20Reading" || p === "/api/v1/courses/1234/pages/Week 1 Reading")
      return send(404, { errors: [{ message: "The specified resource does not exist." }] });
    if (p === "/api/v1/courses/1234/files")
      return paged([{ id: "f1", display_name: "lecture01.pdf", filename: "lecture01.pdf", "content-type": "application/pdf", size: 2_400_000, url: "https://files.test/lecture01.pdf", updated_at: "2026-08-20T00:00:00Z" }]);
    if (p === "/api/v1/courses/4321/files") return send(403, { errors: [{ message: "user not authorized to perform that action" }] });

    return send(404, { errors: [{ message: `No mock for ${req.method} ${p}` }] });
  });
});

await new Promise((r) => mock.listen(PORT, "127.0.0.1", r));

// --- Drive the server over stdio --------------------------------------------
const child = spawn("node", ["dist/index.js"], {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    CANVAS_ACCESS_TOKEN: TOKEN,
    CANVAS_BASE_URL: `http://localhost:${PORT}`,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const pending = new Map();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

let nextId = 1;
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000);
  });

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "1.0.0" },
});
check("initialize handshake", init.result?.serverInfo?.name === "canvas-mcp-server", init.result?.serverInfo?.name);
check("server sends instructions", typeof init.result?.instructions === "string" && init.result.instructions.length > 50);
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const list = await rpc("tools/list", {});
const tools = list.result?.tools ?? [];
check("tools/list returns tools", tools.length === 20, `${tools.length} tools`);
check("all tools prefixed canvas_", tools.every((t) => t.name.startsWith("canvas_")));
check("all tools have descriptions", tools.every((t) => (t.description ?? "").length > 100));
check("all tools have annotations", tools.every((t) => t.annotations && "readOnlyHint" in t.annotations));
check("all tools have input schemas", tools.every((t) => t.inputSchema?.type === "object"));
check("all tools have output schemas", tools.every((t) => t.outputSchema?.type === "object"));
// This server only reads; a write tool appearing here is a regression worth catching.
check("every tool is read-only", tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false));

const call = async (name, args) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return res.result ?? res.error;
};

// --- Auth and transport ------------------------------------------------------
const coursesRes = await call("canvas_list_courses", {});
check("list courses renders", coursesRes.content?.[0]?.text?.includes("COMPSCI 61A"));
check("bearer token sent", requestLog.every((r) => r.auth === `Bearer ${TOKEN}`), `${requestLog.length} requests`);
check("string-ids accept header sent", requestLog.every((r) => (r.accept ?? "").includes("canvas-string-ids")));

// --- Link-header pagination --------------------------------------------------
check("has_more read from Link header", coursesRes.structuredContent?.has_more === true && coursesRes.structuredContent?.next_page === 2);
const page2 = await call("canvas_list_courses", { page: 2 });
check("no Link next means has_more false", page2.structuredContent?.has_more === false && page2.structuredContent?.next_page === undefined);

// --- include[] serialisation -------------------------------------------------
const coursesReq = requestLog.filter((r) => r.path === "/api/v1/courses").at(0);
check("include[] sent as repeated params", coursesReq.params.getAll("include[]").includes("total_scores") && coursesReq.params.getAll("include[]").includes("term"), coursesReq.params.getAll("include[]").join("+"));

// --- Grades ------------------------------------------------------------------
const grades = await call("canvas_get_grades", {});
check("grades read computed_current_score", grades.content[0].text.includes("91.5%") && grades.content[0].text.includes("A-"));
check("hidden grades render as no grade posted", grades.content[0].text.includes("no grade posted"));
check("grade average is labelled not a GPA", grades.content[0].text.includes("not a GPA"));

// --- HTML flattening ---------------------------------------------------------
const course = await call("canvas_get_course", { course_id: "1234", include_syllabus: true });
check("syllabus HTML flattened", course.content[0].text.includes("40% exams & 60% homework") && !course.content[0].text.includes("<strong>"), "tags stripped, entity decoded");

// --- Assignments and submissions ---------------------------------------------
const assignmentsRes = await call("canvas_list_assignments", { course_id: "1234" });
check("assignments render with submission state", assignmentsRes.content[0].text.includes("Project 1") && assignmentsRes.content[0].text.includes("scored 28.5"));
check("missing submissions flagged", assignmentsRes.content[0].text.includes("missing"));
const overdue = await call("canvas_list_assignments", { course_id: "1234", bucket: "overdue" });
check("bucket filter passed through", overdue.structuredContent?.count === 1);
const badBucket = await call("canvas_list_assignments", { course_id: "1234", bucket: "nonsense" });
check("invalid bucket rejected client-side", JSON.stringify(badBucket).includes("overdue"), "enum enforced before HTTP");

const submission = await call("canvas_get_submission", { course_id: "1234", assignment_id: "9001" });
check("submission comments flattened", submission.content[0].text.includes("Nice work on Part B") && !submission.content[0].text.includes("<b>"));

// --- Planner -----------------------------------------------------------------
const planner = await call("canvas_list_planner_items", {});
check("planner items render", planner.content[0].text.includes("Project 1") && planner.content[0].text.includes("COMPSCI 61A"));
check("planner submissions:false survives", planner.content[0].text.includes("Midterm Review Session"), "boolean false not treated as object");
check("planner submitted state rendered", planner.content[0].text.includes("submitted"));

// Canvas returns the entire planner history when start_date is omitted, which
// makes a bare "what's due" call surface years-old items first.
const plannerReq = requestLog.filter((r) => r.path === "/api/v1/planner/items").at(-1);
const today = new Date().toISOString().slice(0, 10);
check("planner defaults start_date to today", plannerReq.params.get("start_date") === today, plannerReq.params.get("start_date"));
await call("canvas_list_planner_items", { start_date: "2026-01-01" });
const plannerReq2 = requestLog.filter((r) => r.path === "/api/v1/planner/items").at(-1);
check("explicit planner start_date wins", plannerReq2.params.get("start_date") === "2026-01-01");

// --- Context code normalisation ----------------------------------------------
await call("canvas_list_announcements", { course_ids: ["1234"] });
const annReq = requestLog.filter((r) => r.path === "/api/v1/announcements").at(-1);
check("bare id normalised to context code", annReq.params.getAll("context_codes[]")[0] === "course_1234", annReq.params.getAll("context_codes[]")[0]);
await call("canvas_list_announcements", { course_ids: ["course_5678"] });
const annReq2 = requestLog.filter((r) => r.path === "/api/v1/announcements").at(-1);
check("full context code passed through", annReq2.params.getAll("context_codes[]")[0] === "course_5678");
const noCourses = await call("canvas_list_announcements", { course_ids: [] });
check("announcements require a course", JSON.stringify(noCourses).includes("at least one course"), "rejected before HTTP");

// --- Discussions -------------------------------------------------------------
const discussion = await call("canvas_get_discussion", { course_id: "1234", topic_id: "7001" });
check("discussion replies nested", discussion.content[0].text.includes("Alice") && discussion.content[0].text.includes("Bob"));
const gated = await call("canvas_get_discussion", { course_id: "1234", topic_id: "7002" });
check("require_initial_post degrades not fails", gated.isError !== true && gated.content[0].text.includes("requires you to post"), "topic still returned");

// --- Modules -----------------------------------------------------------------
const modules = await call("canvas_list_modules", { course_id: "1234" });
check("module items render with completion", modules.content[0].text.includes("✓ must_view"));
check("page items show slug not content_id", modules.content[0].text.includes("page: week-1-reading"));
check("omitted module items explained", modules.content[0].text.includes("canvas_list_module_items"), "large module falls back");

// --- Pages -------------------------------------------------------------------
const page = await call("canvas_get_page", { course_id: "1234", page_url: "week-1-reading" });
check("page body flattened", page.content[0].text.includes("Read sections 1.1–1.3"), "ndash entity decoded");

// --- Files -------------------------------------------------------------------
const files = await call("canvas_list_files", { course_id: "1234" });
check("hyphenated content-type read", files.content[0].text.includes("application/pdf"));
check("file size humanised", files.content[0].text.includes("2.3 MB"));

// --- Error mapping -----------------------------------------------------------
const notFound = await call("canvas_get_course", { course_id: "9999" });
check("404 maps to guidance", notFound.content[0].text.includes("canvas_list_courses"));
const forbidden = await call("canvas_list_files", { course_id: "4321" });
check("403 explains permissions", forbidden.content[0].text.includes("403") && forbidden.content[0].text.toLowerCase().includes("permission"));

// --- Formats -----------------------------------------------------------------
const asJson = await call("canvas_list_courses", { response_format: "json" });
check("json response_format works", asJson.content[0].text.trim().startsWith("{"));

child.kill();
mock.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
