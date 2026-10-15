import type { Attempt } from '../../domain/attempt.ts';
import type { Evaluation, EvaluationFailure } from '../../domain/evaluation.ts';
import type { Problem } from '../../domain/problem.ts';
import type { Rubric } from '../../domain/rubric.ts';
import type { Submission } from '../../domain/submission.ts';

/** Revision numbers prevent a stale caller from overwriting more recent work. */
export interface Stored<T> {
  readonly value: T;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredEvaluation extends Stored<Evaluation> {
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface SubmittedAttempt {
  readonly attempt: Stored<Attempt>;
  readonly evaluation: StoredEvaluation;
}

export type StorageErrorCode = 'CONFLICT' | 'NOT_FOUND' | 'INTEGRITY' | 'SCHEMA_VERSION';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Cohesive persistence boundary; submit commits the aggregate and queued work atomically. */
export interface PracticeRepository {
  putRubric(rubric: Rubric): void;
  getRubric(version: string): Rubric | null;
  putProblem(problem: Problem): void;
  getProblem(id: string, version: string): Problem | null;
  listProblems(): readonly Problem[];
  insertAttempt(attempt: Attempt): Stored<Attempt>;
  getAttempt(id: string): Stored<Attempt> | null;
  saveDraft(attempt: Attempt, expectedRevision: number): Stored<Attempt>;
  submit(attempt: Attempt, evaluation: Evaluation, expectedRevision: number): SubmittedAttempt;
  getSubmission(id: string): Submission | null;
  listAttempts(learnerId: string, problemId?: string): readonly Stored<Attempt>[];
  getEvaluation(id: string): StoredEvaluation | null;
  listEvaluations(submissionId: string): readonly StoredEvaluation[];
  claimNextEvaluation(): StoredEvaluation | null;
  failInterruptedEvaluations(failure: EvaluationFailure): number;
  saveEvaluation(evaluation: Evaluation, expectedRevision: number): StoredEvaluation;
  insertRetry(evaluation: Evaluation): StoredEvaluation;
  close(): void;
}
