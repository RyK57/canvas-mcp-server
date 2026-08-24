/**
 * Interfaces for the Canvas entities this server renders.
 *
 * Every field is optional. Canvas varies its payloads by enrollment role, by
 * `include[]` options, and by institution configuration, so treating anything
 * as guaranteed would turn a field the caller simply did not request into a
 * crash inside a formatter.
 *
 * Ids are typed as strings because the client requests
 * `application/json+canvas-string-ids` — Canvas ids are 64-bit integers and
 * would otherwise lose precision in JavaScript.
 */

export interface Grades {
  current_score?: number | null;
  current_grade?: string | null;
  final_score?: number | null;
  final_grade?: string | null;
  unposted_current_score?: number | null;
  unposted_current_grade?: string | null;
  html_url?: string;
}

export interface Enrollment {
  id?: string;
  user_id?: string;
  course_id?: string;
  type?: string;
  role?: string;
  enrollment_state?: string;
  grades?: Grades;
  computed_current_score?: number | null;
  computed_current_grade?: string | null;
  computed_final_score?: number | null;
  computed_final_grade?: string | null;
}

export interface Term {
  id?: string;
  name?: string;
  start_at?: string | null;
  end_at?: string | null;
}

export interface Course {
  id?: string;
  name?: string;
  course_code?: string;
  workflow_state?: string;
  account_id?: string;
  start_at?: string | null;
  end_at?: string | null;
  enrollments?: Enrollment[];
  term?: Term;
  syllabus_body?: string | null;
  public_description?: string | null;
  total_students?: number;
  default_view?: string;
  time_zone?: string;
  is_favorite?: boolean;
  concluded?: boolean;
}

export interface Submission {
  id?: string;
  assignment_id?: string;
  user_id?: string;
  score?: number | null;
  grade?: string | null;
  entered_score?: number | null;
  entered_grade?: string | null;
  submitted_at?: string | null;
  graded_at?: string | null;
  workflow_state?: string;
  attempt?: number | null;
  late?: boolean;
  missing?: boolean;
  excused?: boolean | null;
  late_policy_status?: string | null;
  seconds_late?: number;
  submission_type?: string | null;
  preview_url?: string;
  html_url?: string;
  body?: string | null;
}

export interface Assignment {
  id?: string;
  name?: string;
  description?: string | null;
  course_id?: string;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible?: number | null;
  grading_type?: string;
  submission_types?: string[];
  html_url?: string;
  published?: boolean;
  locked_for_user?: boolean;
  lock_explanation?: string;
  allowed_attempts?: number;
  has_submitted_submissions?: boolean;
  omit_from_final_grade?: boolean;
  assignment_group_id?: string;
  submission?: Submission;
  is_quiz_assignment?: boolean;
}

export interface Quiz {
  id?: string;
  title?: string;
  html_url?: string;
  description?: string | null;
  quiz_type?: string;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  points_possible?: number | null;
  question_count?: number;
  time_limit?: number | null;
  allowed_attempts?: number;
  published?: boolean;
  locked_for_user?: boolean;
}

/** Canvas returns `author` on discussion topics but does not document it. */
export interface DiscussionAuthor {
  id?: string;
  display_name?: string;
  html_url?: string;
  pronouns?: string | null;
}

export interface DiscussionTopic {
  id?: string;
  title?: string;
  message?: string | null;
  html_url?: string;
  posted_at?: string | null;
  last_reply_at?: string | null;
  delayed_post_at?: string | null;
  discussion_subentry_count?: number;
  read_state?: string;
  unread_count?: number;
  published?: boolean;
  locked?: boolean;
  pinned?: boolean;
  locked_for_user?: boolean;
  discussion_type?: string;
  assignment_id?: string | null;
  user_name?: string;
  author?: DiscussionAuthor | null;
  /** Present on announcements only, in the form "course_123". */
  context_code?: string;
  require_initial_post?: boolean;
}

export interface DiscussionEntry {
  id?: string;
  user_id?: string;
  user_name?: string;
  message?: string | null;
  read_state?: string;
  created_at?: string;
  updated_at?: string;
  has_more_replies?: boolean;
  recent_replies?: DiscussionEntry[];
}

export interface CompletionRequirement {
  type?: string;
  min_score?: number;
  min_percentage?: number;
  completed?: boolean;
}

export interface ContentDetails {
  points_possible?: number | null;
  due_at?: string | null;
  unlock_at?: string | null;
  lock_at?: string | null;
  locked_for_user?: boolean;
  lock_explanation?: string;
}

export interface ModuleItem {
  id?: string;
  module_id?: string;
  position?: number;
  title?: string;
  indent?: number;
  /** File | Page | Discussion | Assignment | Quiz | SubHeader | ExternalUrl | ExternalTool */
  type?: string;
  content_id?: string;
  html_url?: string;
  /** Page items are addressed by slug rather than content_id. */
  page_url?: string;
  external_url?: string;
  published?: boolean;
  completion_requirement?: CompletionRequirement;
  content_details?: ContentDetails;
}

export interface CourseModule {
  id?: string;
  name?: string;
  position?: number;
  workflow_state?: string;
  /** locked | unlocked | started | completed — students only. */
  state?: string;
  completed_at?: string | null;
  items_count?: number;
  items_url?: string;
  /** Canvas omits items for modules it considers too large, even when requested. */
  items?: ModuleItem[] | null;
  published?: boolean;
  unlock_at?: string | null;
  prerequisite_module_ids?: string[];
}

export interface Page {
  /** Canvas names the identifier `page_id` here, not `id`. */
  page_id?: string;
  /** The slug used to address the page, e.g. "week-1-reading". */
  url?: string;
  title?: string;
  body?: string | null;
  created_at?: string;
  updated_at?: string;
  published?: boolean;
  front_page?: boolean;
  locked_for_user?: boolean;
  editing_roles?: string;
}

export interface CanvasFile {
  id?: string;
  folder_id?: string;
  display_name?: string;
  filename?: string;
  /** Canvas spells this key with a hyphen, unlike every other field. */
  "content-type"?: string;
  url?: string;
  size?: number;
  created_at?: string;
  updated_at?: string;
  locked?: boolean;
  hidden?: boolean;
  locked_for_user?: boolean;
  mime_class?: string;
}

export interface PlannerItem {
  plannable_id?: string;
  plannable_type?: string;
  plannable_date?: string | null;
  context_type?: string;
  course_id?: string;
  context_name?: string;
  html_url?: string;
  submissions?: PlannerSubmissionState | false;
  plannable?: {
    id?: string;
    title?: string;
    name?: string;
    due_at?: string | null;
    todo_date?: string | null;
    points_possible?: number | null;
    details?: string | null;
  };
}

export interface PlannerSubmissionState {
  submitted?: boolean;
  excused?: boolean;
  graded?: boolean;
  late?: boolean;
  missing?: boolean;
  needs_grading?: boolean;
  has_feedback?: boolean;
  redo_request?: boolean;
}

export interface CalendarEvent {
  id?: string;
  title?: string;
  start_at?: string | null;
  end_at?: string | null;
  description?: string | null;
  location_name?: string | null;
  /** e.g. "course_123". */
  context_code?: string;
  context_name?: string;
  html_url?: string;
  all_day?: boolean;
  type?: string;
  workflow_state?: string;
}

export interface UserProfile {
  id?: string;
  name?: string;
  short_name?: string;
  sortable_name?: string;
  primary_email?: string | null;
  login_id?: string;
  avatar_url?: string;
  time_zone?: string;
  bio?: string | null;
  effective_locale?: string;
}
