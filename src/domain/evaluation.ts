import { DomainError, requireText } from './errors.ts';
import type { EvaluationFeedback, Rubric } from './rubric.ts';
import type { Submission } from './submission.ts';

export type EvaluationStatus = 'queued' | 'evaluating' | 'completed' | 'failed';
export interface EvaluationFailure {
  readonly code: string;
  readonly message: string;
}

export interface EvaluationSnapshot {
  id: string;
  submission: Submission;
  rubric: Rubric;
  evaluatorId: string;
  previousEvaluationId: string | null;
  status: EvaluationStatus;
  feedback: unknown;
  failure: EvaluationFailure | null;
}

export class Evaluation {
  readonly id: string;
  readonly submissionId: string;
  readonly rubricVersion: string;
  readonly evaluatorId: string;
  readonly previousEvaluationId: string | null;
  #submission: Submission;
  #rubric: Rubric;
  #status: EvaluationStatus = 'queued';
  #feedback: EvaluationFeedback | null = null;
  #failure: EvaluationFailure | null = null;

  private constructor(
    id: string, submission: Submission, rubric: Rubric,
    evaluatorId: string, previousEvaluationId: string | null,
  ) {
    this.id = requireText(id, 'Evaluation ID');
    this.evaluatorId = requireText(evaluatorId, 'Evaluator ID');
    if (submission.rubricVersion !== rubric.version) {
      throw new DomainError('VERSION_MISMATCH', 'The evaluation must use the submission rubric version.');
    }
    this.submissionId = submission.id;
    this.rubricVersion = rubric.version;
    this.previousEvaluationId = previousEvaluationId;
    this.#submission = submission;
    this.#rubric = rubric;
    Object.freeze(this);
  }

  static queue(id: string, submission: Submission, rubric: Rubric, evaluatorId: string): Evaluation {
    return new Evaluation(id, submission, rubric, evaluatorId, null);
  }

  static restore(snapshot: EvaluationSnapshot): Evaluation {
    const previousId = snapshot.previousEvaluationId === null
      ? null : requireText(snapshot.previousEvaluationId, 'Previous evaluation ID');
    const run = new Evaluation(snapshot.id, snapshot.submission, snapshot.rubric,
      snapshot.evaluatorId, previousId);
    if (previousId === run.id) {
      throw new DomainError('INVALID_INPUT', 'An evaluation cannot retry itself.');
    }
    if ((snapshot.status === 'completed') !== (snapshot.feedback !== null)
      || (snapshot.status === 'failed') !== (snapshot.failure !== null)) {
      throw new DomainError('INVALID_INPUT', 'The saved evaluation status and result disagree.');
    }
    switch (snapshot.status) {
      case 'queued': break;
      case 'evaluating': run.start(); break;
      case 'completed': run.start(); run.complete(snapshot.feedback); break;
      case 'failed': run.start(); run.fail(snapshot.failure!); break;
      default: throw new DomainError('INVALID_INPUT', 'Unknown saved evaluation status.');
    }
    return run;
  }

  get status(): EvaluationStatus { return this.#status; }
  get feedback(): EvaluationFeedback | null { return this.#feedback; }
  get failure(): EvaluationFailure | null { return this.#failure; }

  start(): void {
    this.#requireStatus('queued');
    this.#status = 'evaluating';
  }

  complete(rawFeedback: unknown): void {
    this.#requireStatus('evaluating');
    const feedback = this.#rubric.validateFeedback(rawFeedback, this.#submission.sections);
    this.#feedback = feedback;
    this.#status = 'completed';
  }

  fail(failure: EvaluationFailure): void {
    this.#requireStatus('evaluating');
    this.#failure = Object.freeze({
      code: requireText(failure.code, 'Failure code'),
      message: requireText(failure.message, 'Failure message'),
    });
    this.#status = 'failed';
  }

  retry(newEvaluationId: string): Evaluation {
    this.#requireStatus('failed');
    const id = requireText(newEvaluationId, 'New evaluation ID');
    if (id === this.id) {
      throw new DomainError('INVALID_INPUT', 'A retry needs a new evaluation ID.');
    }
    return new Evaluation(id, this.#submission, this.#rubric, this.evaluatorId, this.id);
  }

  #requireStatus(expected: EvaluationStatus): void {
    if (this.#status !== expected) {
      throw new DomainError('INVALID_TRANSITION', `Expected ${expected}, but evaluation is ${this.#status}.`);
    }
  }
}
