import { emptyDesign, SECTION_IDS, updateDesign, type DesignSections } from './design.ts';
import { DomainError, requireText } from './errors.ts';
import type { Problem } from './problem.ts';
import { Submission } from './submission.ts';

export type AttemptStatus = 'draft' | 'submitted';

export interface AttemptSnapshot {
  id: string;
  learnerId: string;
  problem: Problem;
  sections: unknown;
  previousAttemptId: string | null;
  submission: Submission | null;
}

export class Attempt {
  readonly id: string;
  readonly learnerId: string;
  readonly problem: Problem;
  readonly previousAttemptId: string | null;
  #draft: DesignSections;
  #submission: Submission | null = null;

  private constructor(
    id: string,
    learnerId: string,
    problem: Problem,
    sections: DesignSections,
    previousAttemptId: string | null,
  ) {
    this.id = requireText(id, 'Attempt ID');
    this.learnerId = requireText(learnerId, 'Learner ID');
    this.problem = problem;
    this.#draft = updateDesign(emptyDesign(), sections);
    this.previousAttemptId = previousAttemptId;
    // Private lifecycle fields remain mutable through the methods below.
    Object.freeze(this);
  }

  static start(id: string, learnerId: string, problem: Problem): Attempt {
    return new Attempt(id, learnerId, problem, emptyDesign(), null);
  }

  /** Restore persisted state without exposing setters that bypass lifecycle rules. */
  static restore(snapshot: AttemptSnapshot): Attempt {
    const previousId = snapshot.previousAttemptId === null
      ? null : requireText(snapshot.previousAttemptId, 'Previous attempt ID');
    const attempt = new Attempt(snapshot.id, snapshot.learnerId, snapshot.problem,
      updateDesign(emptyDesign(), snapshot.sections), previousId);
    if (previousId === attempt.id) {
      throw new DomainError('INVALID_INPUT', 'An attempt cannot revise itself.');
    }
    const submission = snapshot.submission;
    if (submission !== null) {
      if (submission.attemptId !== attempt.id || submission.learnerId !== attempt.learnerId
        || submission.problemId !== attempt.problem.id || submission.problemVersion !== attempt.problem.version
        || submission.rubricVersion !== attempt.problem.rubricVersion
        || SECTION_IDS.some((section) => submission.sections[section] !== attempt.draft[section])) {
        throw new DomainError('INVALID_INPUT', 'The saved submission does not match its attempt.');
      }
      attempt.#submission = submission;
    }
    return attempt;
  }

  get status(): AttemptStatus { return this.#submission === null ? 'draft' : 'submitted'; }
  get draft(): DesignSections { return this.#draft; }
  get submission(): Submission | null { return this.#submission; }

  updateDraft(patch: unknown): void {
    this.#requireDraft();
    this.#draft = updateDesign(this.#draft, patch);
  }

  submit(submissionId: string): Submission {
    this.#requireDraft();
    const submission = new Submission({
      id: submissionId,
      attemptId: this.id,
      learnerId: this.learnerId,
      problemId: this.problem.id,
      problemVersion: this.problem.version,
      rubricVersion: this.problem.rubricVersion,
      sections: this.#draft,
    });
    this.#submission = submission;
    return submission;
  }

  revise(newAttemptId: string): Attempt {
    if (this.#submission === null) {
      throw new DomainError('INVALID_TRANSITION', 'Only a submitted attempt can be revised.');
    }
    const id = requireText(newAttemptId, 'New attempt ID');
    if (id === this.id) {
      throw new DomainError('INVALID_INPUT', 'A revision needs a new attempt ID.');
    }
    return new Attempt(id, this.learnerId, this.problem, this.#submission.sections, this.id);
  }

  #requireDraft(): void {
    if (this.#submission !== null) {
      throw new DomainError('INVALID_TRANSITION', 'This attempt is submitted. Create a revision to edit it.');
    }
  }
}
