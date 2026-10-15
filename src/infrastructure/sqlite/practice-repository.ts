import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Attempt, type AttemptStatus } from '../../domain/attempt.ts';
import { Evaluation, type EvaluationFailure, type EvaluationStatus } from '../../domain/evaluation.ts';
import { Problem } from '../../domain/problem.ts';
import { ASSESSMENT_LABELS, Rubric, type Criterion } from '../../domain/rubric.ts';
import { Submission } from '../../domain/submission.ts';
import {
  StorageError, type PracticeRepository, type Stored, type StoredEvaluation, type SubmittedAttempt,
} from '../../application/ports/practice-repository.ts';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.ts';

interface RubricRow { version: string; criteria_json: string; labels_json: string }
interface ProblemRow {
  id: string; version: string; title: string; description: string;
  requirements_json: string; rubric_version: string;
}
interface VersionedRow { revision: number; created_at: string; updated_at: string }
interface AttemptRow extends VersionedRow {
  id: string; learner_id: string; problem_id: string; problem_version: string;
  rubric_version: string; draft_json: string; status: AttemptStatus; previous_attempt_id: string | null;
}
interface SubmissionRow {
  id: string; attempt_id: string; learner_id: string; problem_id: string; problem_version: string;
  rubric_version: string; format: string; format_version: number; sections_json: string;
}
interface EvaluationRow extends VersionedRow {
  id: string; submission_id: string; rubric_version: string; evaluator_id: string;
  status: EvaluationStatus; feedback_json: string | null; failure_code: string | null;
  failure_message: string | null; previous_evaluation_id: string | null;
  started_at: string | null; finished_at: string | null;
}

function parseJson<T>(text: string): T {
  try { return JSON.parse(text) as T; }
  catch { throw new StorageError('INTEGRITY', 'Stored JSON is invalid.'); }
}

function requireSaved<T>(value: T | null): T {
  if (value === null) throw new StorageError('NOT_FOUND', 'The requested record does not exist.');
  return value;
}

function stored<T>(value: T, row: VersionedRow): Stored<T> {
  return Object.freeze({ value, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
}

function checkRevision(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0 || actual !== expected) {
    throw new StorageError('CONFLICT', 'This record changed. Reload it before trying again.');
  }
}

function translateError(error: unknown): unknown {
  if (error instanceof Error && 'errcode' in error && typeof error.errcode === 'number') {
    if (error.errcode === 1555 || error.errcode === 2067) {
      return new StorageError('CONFLICT', 'A record or operation with this identity already exists.');
    }
    if ((error.errcode & 255) === 19) {
      return new StorageError('INTEGRITY', 'A database constraint rejected this write.');
    }
  }
  return error;
}

export class SqlitePracticeRepository implements PracticeRepository {
  readonly #db: DatabaseSync;
  readonly #clock: () => string;
  #closed = false;

  constructor(filename: string, clock: () => string = () => new Date().toISOString()) {
    if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.#db = new DatabaseSync(filename);
    this.#clock = clock;
    try {
      this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      this.#transaction(() => {
        const version = this.#one<{ user_version: number }>('PRAGMA user_version')!.user_version;
        if (version === 0) {
          this.#db.exec(SCHEMA_SQL);
          this.#db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        } else if (version !== SCHEMA_VERSION) {
          throw new StorageError('SCHEMA_VERSION', 'This database schema is not supported by this application version.');
        }
      });
      this.#db.exec('PRAGMA journal_mode = WAL;');
    } catch (error) {
      this.#db.close();
      this.#closed = true;
      throw error;
    }
  }

  putRubric(rubric: Rubric): void {
    this.#transaction(() => {
      const existing = this.getRubric(rubric.version);
      if (existing !== null) {
        if (JSON.stringify(existing.criteria) !== JSON.stringify(rubric.criteria)) {
          throw new StorageError('CONFLICT', 'Use a new rubric version for changed criteria.');
        }
        return;
      }
      this.#db.prepare('INSERT INTO rubrics (version, criteria_json, labels_json, created_at) VALUES (?, ?, ?, ?)')
        .run(rubric.version, JSON.stringify(rubric.criteria), JSON.stringify(ASSESSMENT_LABELS), this.#clock());
    });
  }

  getRubric(version: string): Rubric | null {
    const row = this.#one<RubricRow>('SELECT * FROM rubrics WHERE version = ?', version);
    if (!row) return null;
    if (JSON.stringify(parseJson(row.labels_json)) !== JSON.stringify(ASSESSMENT_LABELS)) {
      throw new StorageError('INTEGRITY', 'This rubric uses unsupported assessment labels.');
    }
    return new Rubric(row.version, parseJson<Criterion[]>(row.criteria_json));
  }

  putProblem(problem: Problem): void {
    this.#transaction(() => {
      const existing = this.getProblem(problem.id, problem.version);
      if (existing !== null) {
        if (JSON.stringify(existing) !== JSON.stringify(problem)) {
          throw new StorageError('CONFLICT', 'Use a new problem version for changed requirements.');
        }
        return;
      }
      this.#db.prepare(`INSERT INTO problems
        (id, version, title, description, requirements_json, rubric_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(problem.id, problem.version, problem.title,
          problem.description, JSON.stringify(problem.requirements), problem.rubricVersion, this.#clock());
    });
  }

  getProblem(id: string, version: string): Problem | null {
    const row = this.#one<ProblemRow>('SELECT * FROM problems WHERE id = ? AND version = ?', id, version);
    return row ? new Problem({ id: row.id, version: row.version, title: row.title,
      description: row.description, requirements: parseJson<string[]>(row.requirements_json),
      rubricVersion: row.rubric_version }) : null;
  }

  listProblems(): readonly Problem[] {
    return this.#all<{ id: string; version: string }>('SELECT id, version FROM problems ORDER BY id, created_at, version')
      .map((row) => requireSaved(this.getProblem(row.id, row.version)));
  }

  insertAttempt(attempt: Attempt): Stored<Attempt> {
    return this.#transaction(() => {
      if (attempt.status !== 'draft') throw new StorageError('INTEGRITY', 'Insert a draft before submitting it.');
      const problem = requireSaved(this.getProblem(attempt.problem.id, attempt.problem.version));
      if (JSON.stringify(problem) !== JSON.stringify(attempt.problem)) {
        throw new StorageError('INTEGRITY', 'The attempt must use the saved problem definition.');
      }
      const now = this.#clock();
      this.#db.prepare(`INSERT INTO attempts
        (id, learner_id, problem_id, problem_version, rubric_version, draft_json, status,
          previous_attempt_id, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, 0, ?, ?)`).run(attempt.id, attempt.learnerId,
          problem.id, problem.version, problem.rubricVersion, JSON.stringify(attempt.draft),
          attempt.previousAttemptId, now, now);
      return requireSaved(this.getAttempt(attempt.id));
    });
  }

  getAttempt(id: string): Stored<Attempt> | null {
    const row = this.#one<AttemptRow>('SELECT * FROM attempts WHERE id = ?', id);
    if (!row) return null;
    const submissionRow = this.#one<{ id: string }>('SELECT id FROM submissions WHERE attempt_id = ?', id);
    const attempt = Attempt.restore({ id: row.id, learnerId: row.learner_id,
      problem: requireSaved(this.getProblem(row.problem_id, row.problem_version)),
      sections: parseJson(row.draft_json), previousAttemptId: row.previous_attempt_id,
      submission: submissionRow ? requireSaved(this.getSubmission(submissionRow.id)) : null });
    if (attempt.status !== row.status || attempt.problem.rubricVersion !== row.rubric_version) {
      throw new StorageError('INTEGRITY', 'The saved attempt and submission disagree.');
    }
    return stored(attempt, row);
  }

  saveDraft(attempt: Attempt, expectedRevision: number): Stored<Attempt> {
    return this.#transaction(() => {
      this.#checkAttemptWrite(attempt, expectedRevision);
      if (attempt.status !== 'draft') throw new StorageError('INTEGRITY', 'Use submit to save a submitted attempt.');
      this.#db.prepare(`UPDATE attempts SET draft_json = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND status = 'draft'`)
        .run(JSON.stringify(attempt.draft), this.#clock(), attempt.id, expectedRevision);
      return requireSaved(this.getAttempt(attempt.id));
    });
  }

  submit(attempt: Attempt, evaluation: Evaluation, expectedRevision: number): SubmittedAttempt {
    return this.#transaction(() => {
      this.#checkAttemptWrite(attempt, expectedRevision);
      const submission = attempt.submission;
      if (!submission || evaluation.submissionId !== submission.id
        || evaluation.rubricVersion !== submission.rubricVersion || evaluation.previousEvaluationId !== null) {
        throw new StorageError('INTEGRITY', 'Submission and initial evaluation must belong to the same attempt.');
      }
      const now = this.#clock();
      this.#db.prepare(`UPDATE attempts SET draft_json = ?, status = 'submitted',
        updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND status = 'draft'`)
        .run(JSON.stringify(attempt.draft), now, attempt.id, expectedRevision);
      this.#db.prepare(`INSERT INTO submissions
        (id, attempt_id, learner_id, problem_id, problem_version, rubric_version,
          format, format_version, sections_json, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(submission.id, submission.attemptId,
          submission.learnerId, submission.problemId, submission.problemVersion, submission.rubricVersion,
          submission.format, submission.formatVersion, JSON.stringify(submission.sections), now);
      this.#insertEvaluation(evaluation, now);
      return Object.freeze({ attempt: requireSaved(this.getAttempt(attempt.id)),
        evaluation: requireSaved(this.getEvaluation(evaluation.id)) });
    });
  }

  getSubmission(id: string): Submission | null {
    const row = this.#one<SubmissionRow>('SELECT * FROM submissions WHERE id = ?', id);
    if (!row) return null;
    if (row.format !== 'structured-text' || row.format_version !== 1) {
      throw new StorageError('INTEGRITY', 'Unsupported saved submission format.');
    }
    return new Submission({ id: row.id, attemptId: row.attempt_id, learnerId: row.learner_id,
      problemId: row.problem_id, problemVersion: row.problem_version, rubricVersion: row.rubric_version,
      sections: parseJson(row.sections_json) });
  }

  listAttempts(learnerId: string, problemId?: string): readonly Stored<Attempt>[] {
    const rows = problemId === undefined
      ? this.#all<{ id: string }>('SELECT id FROM attempts WHERE learner_id = ? ORDER BY created_at DESC, id', learnerId)
      : this.#all<{ id: string }>(`SELECT id FROM attempts WHERE learner_id = ? AND problem_id = ?
        ORDER BY created_at DESC, id`, learnerId, problemId);
    return rows.map((row) => requireSaved(this.getAttempt(row.id)));
  }

  getEvaluation(id: string): StoredEvaluation | null {
    const row = this.#one<EvaluationRow>('SELECT * FROM evaluations WHERE id = ?', id);
    if (!row) return null;
    const value = Evaluation.restore({ id: row.id,
      submission: requireSaved(this.getSubmission(row.submission_id)),
      rubric: requireSaved(this.getRubric(row.rubric_version)), evaluatorId: row.evaluator_id,
      previousEvaluationId: row.previous_evaluation_id, status: row.status,
      feedback: row.feedback_json === null ? null : parseJson(row.feedback_json),
      failure: row.failure_code === null ? null : { code: row.failure_code, message: row.failure_message! } });
    return Object.freeze({ ...stored(value, row), startedAt: row.started_at, finishedAt: row.finished_at });
  }

  listEvaluations(submissionId: string): readonly StoredEvaluation[] {
    return this.#all<{ id: string }>(`SELECT id FROM evaluations WHERE submission_id = ? ORDER BY created_at, id`, submissionId)
      .map((row) => requireSaved(this.getEvaluation(row.id)));
  }

  claimNextEvaluation(): StoredEvaluation | null {
    return this.#transaction(() => {
      const row = this.#one<{ id: string }>(`SELECT id FROM evaluations WHERE status = 'queued' ORDER BY created_at, id LIMIT 1`);
      if (!row) return null;
      const next = requireSaved(this.getEvaluation(row.id));
      next.value.start();
      return this.#saveEvaluation(next.value, next.revision);
    });
  }

  saveEvaluation(evaluation: Evaluation, expectedRevision: number): StoredEvaluation {
    return this.#transaction(() => this.#saveEvaluation(evaluation, expectedRevision));
  }

  /** Startup recovery for the single application process, before its worker begins claiming jobs. */
  failInterruptedEvaluations(failure: EvaluationFailure): number {
    return this.#transaction(() => {
      const rows = this.#all<{ id: string }>("SELECT id FROM evaluations WHERE status = 'evaluating' ORDER BY id");
      for (const row of rows) {
        const saved = requireSaved(this.getEvaluation(row.id));
        saved.value.fail(failure);
        this.#saveEvaluation(saved.value, saved.revision);
      }
      return rows.length;
    });
  }

  insertRetry(evaluation: Evaluation): StoredEvaluation {
    return this.#transaction(() => {
      if (evaluation.previousEvaluationId === null) {
        throw new StorageError('INTEGRITY', 'A retry must identify its previous evaluation.');
      }
      const parent = requireSaved(this.getEvaluation(evaluation.previousEvaluationId));
      const expected = parent.value.retry(evaluation.id);
      this.#checkEvaluationIdentity(expected, evaluation);
      this.#insertEvaluation(evaluation, this.#clock());
      return requireSaved(this.getEvaluation(evaluation.id));
    });
  }

  close(): void {
    if (!this.#closed) { this.#db.close(); this.#closed = true; }
  }

  #checkAttemptWrite(attempt: Attempt, expectedRevision: number): void {
    const current = requireSaved(this.getAttempt(attempt.id));
    checkRevision(current.revision, expectedRevision);
    if (current.value.status !== 'draft') throw new StorageError('CONFLICT', 'The attempt has already been submitted.');
    if (current.value.learnerId !== attempt.learnerId
      || current.value.previousAttemptId !== attempt.previousAttemptId
      || JSON.stringify(current.value.problem) !== JSON.stringify(attempt.problem)) {
      throw new StorageError('INTEGRITY', 'Attempt ownership, problem, and revision origin cannot change.');
    }
  }

  #checkEvaluationIdentity(current: Evaluation, incoming: Evaluation): void {
    if (current.submissionId !== incoming.submissionId || current.rubricVersion !== incoming.rubricVersion
      || current.evaluatorId !== incoming.evaluatorId || current.previousEvaluationId !== incoming.previousEvaluationId) {
      throw new StorageError('INTEGRITY', 'Evaluation identity and revision origin cannot change.');
    }
  }

  #saveEvaluation(incoming: Evaluation, expectedRevision: number): StoredEvaluation {
    const current = requireSaved(this.getEvaluation(incoming.id));
    checkRevision(current.revision, expectedRevision);
    this.#checkEvaluationIdentity(current.value, incoming);
    const next = current.value;
    // Reapply the transition to the saved object, validating feedback against saved text.
    switch (incoming.status) {
      case 'evaluating': next.start(); break;
      case 'completed': next.complete(incoming.feedback); break;
      case 'failed': next.fail(incoming.failure!); break;
      default: throw new StorageError('INTEGRITY', 'An existing evaluation cannot return to queued.');
    }
    const now = this.#clock();
    const finishedAt = next.status === 'completed' || next.status === 'failed' ? now : null;
    this.#db.prepare(`UPDATE evaluations SET status = ?, feedback_json = ?, failure_code = ?, failure_message = ?,
      updated_at = ?, started_at = ?, finished_at = ?, revision = revision + 1
      WHERE id = ? AND revision = ?`).run(next.status,
        next.feedback === null ? null : JSON.stringify(next.feedback), next.failure?.code ?? null,
        next.failure?.message ?? null, now, current.startedAt ?? now, finishedAt, next.id, expectedRevision);
    return requireSaved(this.getEvaluation(next.id));
  }

  #insertEvaluation(evaluation: Evaluation, now: string): void {
    if (evaluation.status !== 'queued') throw new StorageError('INTEGRITY', 'New evaluations must be queued.');
    this.#db.prepare(`INSERT INTO evaluations
      (id, submission_id, rubric_version, evaluator_id, status, previous_evaluation_id, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?)`).run(evaluation.id, evaluation.submissionId,
        evaluation.rubricVersion, evaluation.evaluatorId, evaluation.previousEvaluationId, now, now);
  }

  #one<T>(sql: string, ...values: SQLInputValue[]): T | undefined {
    return this.#db.prepare(sql).get(...values) as unknown as T | undefined;
  }

  #all<T>(sql: string, ...values: SQLInputValue[]): T[] {
    return this.#db.prepare(sql).all(...values) as unknown as T[];
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.#db.exec('ROLLBACK'); } catch { /* Keep the original failure. */ }
      throw translateError(error);
    }
  }
}
