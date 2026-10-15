import { validateSubmission, type DesignSections } from './design.ts';
import { requireText } from './errors.ts';

export interface SubmissionDefinition {
  id: string;
  attemptId: string;
  learnerId: string;
  problemId: string;
  problemVersion: string;
  rubricVersion: string;
  sections: unknown;
}

/** An accepted submission is a snapshot, never an editable draft. */
export class Submission {
  readonly id: string;
  readonly attemptId: string;
  readonly learnerId: string;
  readonly problemId: string;
  readonly problemVersion: string;
  readonly rubricVersion: string;
  readonly format = 'structured-text' as const;
  readonly formatVersion = 1;
  readonly sections: DesignSections;

  constructor(definition: SubmissionDefinition) {
    this.id = requireText(definition.id, 'Submission ID');
    this.attemptId = requireText(definition.attemptId, 'Attempt ID');
    this.learnerId = requireText(definition.learnerId, 'Learner ID');
    this.problemId = requireText(definition.problemId, 'Problem ID');
    this.problemVersion = requireText(definition.problemVersion, 'Problem version');
    this.rubricVersion = requireText(definition.rubricVersion, 'Rubric version');
    this.sections = validateSubmission(definition.sections);
    Object.freeze(this);
  }
}
