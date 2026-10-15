export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE rubrics (
  version TEXT PRIMARY KEY NOT NULL,
  criteria_json TEXT NOT NULL CHECK(json_valid(criteria_json) AND json_type(criteria_json) = 'array'),
  labels_json TEXT NOT NULL CHECK(json_valid(labels_json) AND json_type(labels_json) = 'object'),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE problems (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  requirements_json TEXT NOT NULL CHECK(json_valid(requirements_json) AND json_type(requirements_json) = 'array'),
  rubric_version TEXT NOT NULL REFERENCES rubrics(version),
  created_at TEXT NOT NULL,
  PRIMARY KEY(id, version),
  UNIQUE(id, version, rubric_version)
) STRICT;

CREATE TABLE attempts (
  id TEXT PRIMARY KEY NOT NULL,
  learner_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  problem_version TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json) AND json_type(draft_json) = 'object'),
  status TEXT NOT NULL CHECK(status IN ('draft', 'submitted')),
  previous_attempt_id TEXT CHECK(previous_attempt_id IS NULL OR previous_attempt_id <> id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, learner_id, problem_id, problem_version, rubric_version),
  FOREIGN KEY(problem_id, problem_version, rubric_version) REFERENCES problems(id, version, rubric_version),
  FOREIGN KEY(previous_attempt_id, learner_id, problem_id, problem_version, rubric_version)
    REFERENCES attempts(id, learner_id, problem_id, problem_version, rubric_version)
) STRICT;

CREATE TABLE submissions (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  learner_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  problem_version TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format = 'structured-text'),
  format_version INTEGER NOT NULL CHECK(format_version = 1),
  sections_json TEXT NOT NULL CHECK(json_valid(sections_json) AND json_type(sections_json) = 'object'),
  submitted_at TEXT NOT NULL,
  UNIQUE(id, rubric_version),
  FOREIGN KEY(attempt_id, learner_id, problem_id, problem_version, rubric_version)
    REFERENCES attempts(id, learner_id, problem_id, problem_version, rubric_version)
) STRICT;

CREATE TABLE evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  evaluator_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'evaluating', 'completed', 'failed')),
  feedback_json TEXT CHECK(feedback_json IS NULL OR (json_valid(feedback_json) AND json_type(feedback_json) = 'object')),
  failure_code TEXT,
  failure_message TEXT,
  previous_evaluation_id TEXT UNIQUE CHECK(previous_evaluation_id IS NULL OR previous_evaluation_id <> id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(id, submission_id, rubric_version, evaluator_id),
  FOREIGN KEY(submission_id, rubric_version) REFERENCES submissions(id, rubric_version),
  FOREIGN KEY(previous_evaluation_id, submission_id, rubric_version, evaluator_id)
    REFERENCES evaluations(id, submission_id, rubric_version, evaluator_id),
  CHECK(
    (status = 'queued' AND started_at IS NULL AND finished_at IS NULL AND feedback_json IS NULL AND failure_code IS NULL AND failure_message IS NULL)
    OR (status = 'evaluating' AND started_at IS NOT NULL AND finished_at IS NULL AND feedback_json IS NULL AND failure_code IS NULL AND failure_message IS NULL)
    OR (status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND feedback_json IS NOT NULL AND failure_code IS NULL AND failure_message IS NULL)
    OR (status = 'failed' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND feedback_json IS NULL AND failure_code IS NOT NULL AND length(trim(failure_code)) > 0 AND failure_message IS NOT NULL AND length(trim(failure_message)) > 0)
  )
) STRICT;

CREATE INDEX attempts_history ON attempts(learner_id, problem_id, created_at DESC, id);
CREATE INDEX evaluations_history ON evaluations(submission_id, created_at, id);
CREATE INDEX evaluations_queue ON evaluations(created_at, id) WHERE status = 'queued';
CREATE UNIQUE INDEX evaluations_one_initial ON evaluations(submission_id) WHERE previous_evaluation_id IS NULL;
CREATE UNIQUE INDEX evaluations_one_active ON evaluations(submission_id) WHERE status IN ('queued', 'evaluating');

CREATE TRIGGER rubrics_immutable BEFORE UPDATE ON rubrics BEGIN
  SELECT RAISE(ABORT, 'Create a new rubric version instead of changing history.');
END;
CREATE TRIGGER problems_immutable BEFORE UPDATE ON problems BEGIN
  SELECT RAISE(ABORT, 'Create a new problem version instead of changing history.');
END;
CREATE TRIGGER submissions_immutable BEFORE UPDATE ON submissions BEGIN
  SELECT RAISE(ABORT, 'Submissions are immutable.');
END;
CREATE TRIGGER submissions_preserve_history BEFORE DELETE ON submissions BEGIN
  SELECT RAISE(ABORT, 'Submissions are retained as history.');
END;
CREATE TRIGGER attempts_revision_parent BEFORE INSERT ON attempts
WHEN NEW.previous_attempt_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM attempts WHERE id = NEW.previous_attempt_id AND status = 'submitted'
  ) THEN RAISE(ABORT, 'A revision requires a submitted parent attempt.') END;
END;
CREATE TRIGGER attempts_update_guard BEFORE UPDATE ON attempts BEGIN
  SELECT CASE WHEN OLD.status <> 'draft'
    OR NEW.id <> OLD.id OR NEW.learner_id <> OLD.learner_id
    OR NEW.problem_id <> OLD.problem_id OR NEW.problem_version <> OLD.problem_version
    OR NEW.rubric_version <> OLD.rubric_version OR NEW.created_at <> OLD.created_at
    OR NEW.previous_attempt_id IS NOT OLD.previous_attempt_id
    OR NEW.revision <> OLD.revision + 1
    THEN RAISE(ABORT, 'Invalid attempt update.') END;
END;
CREATE TRIGGER evaluations_retry_parent BEFORE INSERT ON evaluations
WHEN NEW.previous_evaluation_id IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM evaluations WHERE id = NEW.previous_evaluation_id AND status = 'failed'
  ) THEN RAISE(ABORT, 'A retry requires a failed parent evaluation.') END;
END;
CREATE TRIGGER evaluations_update_guard BEFORE UPDATE ON evaluations BEGIN
  SELECT CASE WHEN NOT (
      (OLD.status = 'queued' AND NEW.status = 'evaluating')
      OR (OLD.status = 'evaluating' AND NEW.status IN ('completed', 'failed'))
    ) OR NEW.id <> OLD.id OR NEW.submission_id <> OLD.submission_id
    OR NEW.rubric_version <> OLD.rubric_version OR NEW.evaluator_id <> OLD.evaluator_id
    OR NEW.previous_evaluation_id IS NOT OLD.previous_evaluation_id OR NEW.created_at <> OLD.created_at
    OR NEW.revision <> OLD.revision + 1
    OR (OLD.started_at IS NOT NULL AND NEW.started_at IS NOT OLD.started_at)
    THEN RAISE(ABORT, 'Invalid evaluation transition.') END;
END;
`;
