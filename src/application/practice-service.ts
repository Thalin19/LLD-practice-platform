import { Attempt } from '../domain/attempt.ts';
import { DomainError, requireText } from '../domain/errors.ts';
import { Evaluation } from '../domain/evaluation.ts';
import type { Problem } from '../domain/problem.ts';
import type { Rubric } from '../domain/rubric.ts';
import {
  StorageError, type PracticeRepository, type Stored, type StoredEvaluation, type SubmittedAttempt,
} from './ports/practice-repository.ts';

export type PracticeIdKind = 'attempt' | 'submission' | 'evaluation';

export interface PracticeServiceOptions {
  readonly learnerId: string;
  readonly evaluatorId: string;
  readonly createId: (kind: PracticeIdKind) => string;
}

export interface AttemptDetails {
  readonly attempt: Stored<Attempt>;
  readonly evaluations: readonly StoredEvaluation[];
}

export interface DraftCommand {
  readonly attemptId: string;
  readonly expectedRevision: number;
  readonly patch: unknown;
}

export interface SubmitCommand {
  readonly attemptId: string;
  readonly expectedRevision: number;
}

/** Coordinates learner actions; persistence and provider execution stay behind ports. */
export class PracticeService {
  readonly #repository: PracticeRepository;
  readonly #learnerId: string;
  readonly #evaluatorId: string;
  readonly #createId: PracticeServiceOptions['createId'];

  constructor(repository: PracticeRepository, options: PracticeServiceOptions) {
    this.#repository = repository;
    this.#learnerId = requireText(options.learnerId, 'Learner ID');
    this.#evaluatorId = requireText(options.evaluatorId, 'Evaluator ID');
    this.#createId = options.createId;
  }

  listProblems(): readonly Problem[] {
    return Object.freeze([...this.#repository.listProblems()]);
  }

  getProblem(problemId: string, problemVersion: string): Problem {
    const problem = this.#repository.getProblem(
      requireText(problemId, 'Problem ID'), requireText(problemVersion, 'Problem version'),
    );
    if (problem === null) throw new StorageError('NOT_FOUND', 'The requested problem version does not exist.');
    return problem;
  }

  getRubric(version: string): Rubric {
    const rubric = this.#repository.getRubric(requireText(version, 'Rubric version'));
    if (rubric === null) throw new StorageError('NOT_FOUND', 'The requested rubric version does not exist.');
    return rubric;
  }

  startAttempt(problemId: string, problemVersion: string): Stored<Attempt> {
    const problem = this.getProblem(problemId, problemVersion);
    return this.#repository.insertAttempt(Attempt.start(this.#createId('attempt'), this.#learnerId, problem));
  }

  getAttempt(attemptId: string): AttemptDetails {
    return this.#details(this.#ownedAttempt(attemptId));
  }

  saveDraft(command: DraftCommand): Stored<Attempt> {
    const saved = this.#ownedAttempt(command.attemptId);
    this.#checkRevision(saved.revision, command.expectedRevision);
    saved.value.updateDraft(command.patch);
    return this.#repository.saveDraft(saved.value, command.expectedRevision);
  }

  submitAttempt(command: SubmitCommand): SubmittedAttempt {
    const saved = this.#ownedAttempt(command.attemptId);
    this.#checkRevision(saved.revision, command.expectedRevision);
    const rubric = this.#repository.getRubric(saved.value.problem.rubricVersion);
    if (rubric === null) throw new StorageError('INTEGRITY', 'The saved problem rubric is missing.');
    const submission = saved.value.submit(this.#createId('submission'));
    const evaluation = Evaluation.queue(this.#createId('evaluation'), submission, rubric, this.#evaluatorId);
    // The repository commits both the submission and pending work, or neither.
    return this.#repository.submit(saved.value, evaluation, command.expectedRevision);
  }

  getEvaluation(evaluationId: string): StoredEvaluation {
    const saved = this.#repository.getEvaluation(requireText(evaluationId, 'Evaluation ID'));
    if (saved === null) throw new StorageError('NOT_FOUND', 'The requested evaluation does not exist.');
    const submission = this.#repository.getSubmission(saved.value.submissionId);
    if (submission === null) throw new StorageError('INTEGRITY', 'The saved evaluation submission is missing.');
    if (submission.learnerId !== this.#learnerId) {
      throw new StorageError('NOT_FOUND', 'The requested evaluation does not exist.');
    }
    return saved;
  }

  retryEvaluation(evaluationId: string): StoredEvaluation {
    const saved = this.getEvaluation(evaluationId);
    const retry = saved.value.retry(this.#createId('evaluation'));
    return this.#repository.insertRetry(retry);
  }

  reviseAttempt(attemptId: string): Stored<Attempt> {
    const saved = this.#ownedAttempt(attemptId);
    return this.#repository.insertAttempt(saved.value.revise(this.#createId('attempt')));
  }

  listHistory(problemId?: string): readonly AttemptDetails[] {
    const filter = problemId === undefined ? undefined : requireText(problemId, 'Problem ID');
    return Object.freeze(this.#repository.listAttempts(this.#learnerId, filter)
      .map((attempt) => this.#details(attempt)));
  }

  #ownedAttempt(attemptId: string): Stored<Attempt> {
    const saved = this.#repository.getAttempt(requireText(attemptId, 'Attempt ID'));
    if (saved === null || saved.value.learnerId !== this.#learnerId) {
      throw new StorageError('NOT_FOUND', 'The requested attempt does not exist.');
    }
    return saved;
  }

  #details(attempt: Stored<Attempt>): AttemptDetails {
    const submission = attempt.value.submission;
    const evaluations = submission === null ? [] : this.#repository.listEvaluations(submission.id);
    return Object.freeze({ attempt, evaluations: Object.freeze([...evaluations]) });
  }

  #checkRevision(actual: number, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 0) {
      throw new DomainError('INVALID_INPUT', 'Expected revision must be a non-negative safe integer.');
    }
    if (actual !== expected) {
      throw new StorageError('CONFLICT', 'This attempt changed. Reload it before trying again.');
    }
  }
}
