/**
 * Per-entity markdown rendering.
 *
 * Every renderer tolerates missing fields: Canvas omits large parts of its
 * payloads depending on enrollment role, `include[]` options and institution
 * settings, so a formatter that assumed a field was present would fail on a
 * perfectly valid response.
 */

import { formatDueDate, formatTimestamp, stripHtml } from "./response.js";
import type {
  Assignment,
  CalendarEvent,
  CanvasFile,
  Course,
  CourseModule,
  DiscussionEntry,
  DiscussionTopic,
  Enrollment,
  ModuleItem,
  Page,
  PlannerItem,
  Quiz,
  Submission,
} from "../types.js";

/** Human label for a course, preferring the name a student would recognise. */
export const courseLabel = (course: Course): string =>
  course.name ?? course.course_code ?? `course ${course.id ?? "?"}`;

const bytes = (size: number | undefined): string => {
  if (size === undefined) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
};

/**
 * Pulls a score out of a course's embedded enrollments.
 *
 * The Courses API nests grades under `enrollments[].computed_current_score`,
 * where the Enrollments API calls the same number `grades.current_score`. Only
 * student enrollments carry them, and a course configured to hide final grades
 * omits them entirely.
 */
export const courseScore = (
  course: Course,
): { score: number | null; grade: string | null } | null => {
  const student = (course.enrollments ?? []).find(
    (enrollment) => enrollment.type === "student" || enrollment.type === "StudentEnrollment",
  );
  if (!student) return null;

  const score = student.computed_current_score ?? student.grades?.current_score ?? null;
  const grade = student.computed_current_grade ?? student.grades?.current_grade ?? null;
  if (score === null && grade === null) return null;
  return { score, grade };
};

export const formatCourse = (course: Course, detailed = false): string => {
  const lines: string[] = [`## ${courseLabel(course)}`];

  const facts: string[] = [`id: ${course.id ?? "?"}`];
  if (course.course_code && course.course_code !== course.name) facts.push(course.course_code);
  if (course.term?.name) facts.push(`term: ${course.term.name}`);
  if (course.workflow_state && course.workflow_state !== "available") {
    facts.push(`state: ${course.workflow_state}`);
  }
  lines.push(`_${facts.join(" · ")}_`);

  const scored = courseScore(course);
  if (scored) {
    const parts = [
      scored.score !== null ? `${scored.score}%` : null,
      scored.grade !== null ? scored.grade : null,
    ].filter(Boolean);
    lines.push(`**Current grade:** ${parts.join(" · ")}`);
  }

  if (detailed) {
    if (course.start_at || course.end_at) {
      lines.push(
        `**Dates:** ${formatTimestamp(course.start_at)} → ${formatTimestamp(course.end_at)}`,
      );
    }
    if (course.public_description) {
      lines.push("", stripHtml(course.public_description, 400));
    }
    if (course.syllabus_body) {
      lines.push("", "**Syllabus**", "", stripHtml(course.syllabus_body));
    }
  }

  return lines.join("\n");
};

export const formatEnrollment = (enrollment: Enrollment): string => {
  const grades = enrollment.grades ?? {};
  const parts = [
    grades.current_score !== null && grades.current_score !== undefined
      ? `${grades.current_score}%`
      : null,
    grades.current_grade ?? null,
  ].filter(Boolean);

  return (
    `- **${enrollment.type ?? "enrollment"}** in course ${enrollment.course_id ?? "?"}` +
    ` — ${enrollment.enrollment_state ?? "unknown state"}` +
    (parts.length > 0 ? ` · ${parts.join(" · ")}` : " · no grade posted")
  );
};

/** One-line summary of a submission's state, from a student's point of view. */
export const submissionSummary = (submission: Submission | undefined): string => {
  if (!submission) return "no submission record";

  const flags: string[] = [];
  if (submission.excused) flags.push("excused");
  if (submission.missing) flags.push("**missing**");
  if (submission.late) flags.push("late");

  const scorePart =
    submission.score !== null && submission.score !== undefined
      ? `scored ${submission.score}${submission.grade ? ` (${submission.grade})` : ""}`
      : submission.workflow_state === "graded"
        ? "graded"
        : null;

  const submittedPart = submission.submitted_at
    ? `submitted ${formatTimestamp(submission.submitted_at)}`
    : "not submitted";

  return [submittedPart, scorePart, ...flags].filter(Boolean).join(" · ");
};

export const formatAssignment = (assignment: Assignment, detailed = false): string => {
  const lines: string[] = [`### ${assignment.name ?? "Untitled assignment"}`];

  const facts: string[] = [`id: ${assignment.id ?? "?"}`];
  if (assignment.points_possible !== null && assignment.points_possible !== undefined) {
    facts.push(`${assignment.points_possible} pts`);
  }
  if (assignment.submission_types?.length) facts.push(assignment.submission_types.join(", "));
  lines.push(`_${facts.join(" · ")}_`);
  lines.push(`**Due:** ${formatDueDate(assignment.due_at)}`);

  if (assignment.submission) {
    lines.push(`**Submission:** ${submissionSummary(assignment.submission)}`);
  }
  if (assignment.locked_for_user) {
    lines.push(`**Locked:** ${stripHtml(assignment.lock_explanation, 200) || "yes"}`);
  }

  if (detailed) {
    if (assignment.unlock_at || assignment.lock_at) {
      lines.push(
        `**Available:** ${formatTimestamp(assignment.unlock_at)} → ${formatTimestamp(assignment.lock_at)}`,
      );
    }
    if (assignment.allowed_attempts && assignment.allowed_attempts > 0) {
      lines.push(`**Attempts allowed:** ${assignment.allowed_attempts}`);
    }
    if (assignment.html_url) lines.push(`**Link:** ${assignment.html_url}`);
    if (assignment.description) {
      lines.push("", stripHtml(assignment.description));
    }
  }

  return lines.join("\n");
};

export const formatSubmission = (submission: Submission, detailed = false): string => {
  const lines: string[] = [
    `### Submission for assignment ${submission.assignment_id ?? "?"}`,
    `_${submissionSummary(submission)}_`,
  ];

  if (submission.attempt) lines.push(`**Attempt:** ${submission.attempt}`);
  if (submission.graded_at) lines.push(`**Graded:** ${formatTimestamp(submission.graded_at)}`);
  if (submission.submission_type) lines.push(`**Type:** ${submission.submission_type}`);
  if (detailed && submission.body) lines.push("", stripHtml(submission.body));
  if (detailed && submission.html_url) lines.push(`**Link:** ${submission.html_url}`);

  return lines.join("\n");
};

export const formatQuiz = (quiz: Quiz, detailed = false): string => {
  const facts: string[] = [`id: ${quiz.id ?? "?"}`];
  if (quiz.points_possible !== null && quiz.points_possible !== undefined) {
    facts.push(`${quiz.points_possible} pts`);
  }
  if (quiz.question_count !== undefined) facts.push(`${quiz.question_count} questions`);
  if (quiz.time_limit) facts.push(`${quiz.time_limit} min limit`);

  const lines = [
    `### ${quiz.title ?? "Untitled quiz"}`,
    `_${facts.join(" · ")}_`,
    `**Due:** ${formatDueDate(quiz.due_at)}`,
  ];

  if (detailed) {
    if (quiz.html_url) lines.push(`**Link:** ${quiz.html_url}`);
    if (quiz.description) lines.push("", stripHtml(quiz.description));
  }

  return lines.join("\n");
};

export const formatDiscussion = (topic: DiscussionTopic, detailed = false): string => {
  const lines: string[] = [`### ${topic.title ?? "Untitled"}`];

  const facts: string[] = [`id: ${topic.id ?? "?"}`];
  const author = topic.author?.display_name ?? topic.user_name;
  if (author) facts.push(`by ${author}`);
  if (topic.posted_at) facts.push(formatTimestamp(topic.posted_at));
  if (topic.discussion_subentry_count) facts.push(`${topic.discussion_subentry_count} replies`);
  if (topic.pinned) facts.push("pinned");
  if (topic.locked) facts.push("locked");
  if (topic.read_state === "unread") facts.push("**unread**");
  lines.push(`_${facts.join(" · ")}_`);

  const body = stripHtml(topic.message, detailed ? 4000 : 300);
  if (body) lines.push("", body);
  if (detailed && topic.html_url) lines.push("", `**Link:** ${topic.html_url}`);

  return lines.join("\n");
};

export const formatDiscussionEntry = (entry: DiscussionEntry, depth = 0): string => {
  const indent = "  ".repeat(depth);
  const head = `${indent}- **${entry.user_name ?? "Unknown"}** · ${formatTimestamp(entry.created_at)}`;
  const body = stripHtml(entry.message, 600)
    .split("\n")
    .map((line) => `${indent}  ${line}`)
    .join("\n");

  const replies = (entry.recent_replies ?? [])
    .map((reply) => formatDiscussionEntry(reply, depth + 1))
    .join("\n");

  return [head, body, replies].filter(Boolean).join("\n");
};

export const formatModuleItem = (item: ModuleItem): string => {
  const indent = "  ".repeat(item.indent ?? 0);
  if (item.type === "SubHeader") return `${indent}- **${item.title ?? ""}**`;

  const facts: string[] = [item.type ?? "item"];
  // Pages are addressed by slug; everything else by content_id.
  if (item.type === "Page" && item.page_url) facts.push(`page: ${item.page_url}`);
  else if (item.content_id) facts.push(`content_id: ${item.content_id}`);

  const requirement = item.completion_requirement;
  if (requirement?.type) {
    facts.push(requirement.completed ? `✓ ${requirement.type}` : requirement.type);
  }
  const due = item.content_details?.due_at;
  if (due) facts.push(`due ${formatDueDate(due)}`);

  return `${indent}- ${item.title ?? "Untitled"} _(${facts.join(" · ")})_`;
};

export const formatModule = (module: CourseModule): string => {
  const facts: string[] = [`id: ${module.id ?? "?"}`];
  if (module.state) facts.push(module.state);
  if (module.items_count !== undefined) facts.push(`${module.items_count} items`);
  if (module.completed_at) facts.push(`completed ${formatTimestamp(module.completed_at)}`);

  const lines = [`### ${module.name ?? "Untitled module"}`, `_${facts.join(" · ")}_`];

  if (module.items?.length) {
    lines.push("", module.items.map(formatModuleItem).join("\n"));
  } else if (module.items_count) {
    // Canvas drops items from the list response for modules it considers large.
    lines.push("", `_Items not included — call canvas_list_module_items with module_id=${module.id}._`);
  }

  return lines.join("\n");
};

export const formatPage = (page: Page, detailed = false): string => {
  const facts: string[] = [`url: ${page.url ?? "?"}`];
  if (page.updated_at) facts.push(`updated ${formatTimestamp(page.updated_at)}`);
  if (page.front_page) facts.push("front page");
  if (page.published === false) facts.push("unpublished");

  const lines = [`### ${page.title ?? "Untitled page"}`, `_${facts.join(" · ")}_`];
  if (detailed && page.body) lines.push("", stripHtml(page.body, 6000));

  return lines.join("\n");
};

export const formatFile = (file: CanvasFile): string => {
  const facts: string[] = [`id: ${file.id ?? "?"}`, bytes(file.size)];
  const contentType = file["content-type"];
  if (contentType) facts.push(contentType);
  if (file.updated_at) facts.push(formatTimestamp(file.updated_at));

  return `- **${file.display_name ?? file.filename ?? "Untitled"}** _(${facts.join(" · ")})_`;
};

/**
 * Renders a planner item. The interesting fields live one level down in
 * `plannable`, whose shape varies by `plannable_type` — assignments carry
 * `title` and `due_at`, calendar events carry `title` and `start_at`, and
 * planner notes carry `todo_date`.
 */
export const formatPlannerItem = (item: PlannerItem): string => {
  const plannable = item.plannable ?? {};
  const title = plannable.title ?? plannable.name ?? "Untitled";
  const when = item.plannable_date ?? plannable.due_at ?? plannable.todo_date;

  const facts: string[] = [item.plannable_type ?? "item"];
  if (item.context_name) facts.push(item.context_name);
  if (plannable.points_possible !== null && plannable.points_possible !== undefined) {
    facts.push(`${plannable.points_possible} pts`);
  }

  const state = item.submissions;
  if (state && typeof state === "object") {
    if (state.submitted) facts.push("✓ submitted");
    else if (state.missing) facts.push("**missing**");
    if (state.graded) facts.push("graded");
    if (state.late) facts.push("late");
  }

  return `- **${title}** — ${formatDueDate(when)}\n  _${facts.join(" · ")}_`;
};

export const formatCalendarEvent = (event: CalendarEvent): string => {
  const facts: string[] = [];
  if (event.context_name) facts.push(event.context_name);
  if (event.location_name) facts.push(event.location_name);
  if (event.all_day) facts.push("all day");

  return (
    `- **${event.title ?? "Untitled"}** — ${formatDueDate(event.start_at)}` +
    (facts.length > 0 ? `\n  _${facts.join(" · ")}_` : "")
  );
};
