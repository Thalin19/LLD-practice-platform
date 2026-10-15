import { DomainError, requireText } from './errors.ts';

export interface ProblemDefinition {
  id: string;
  version: string;
  title: string;
  description: string;
  requirements: readonly string[];
  rubricVersion: string;
}

export class Problem {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: readonly string[];
  readonly rubricVersion: string;

  constructor(definition: ProblemDefinition) {
    this.id = requireText(definition.id, 'Problem ID');
    this.version = requireText(definition.version, 'Problem version');
    this.title = requireText(definition.title, 'Problem title');
    this.description = requireText(definition.description, 'Problem description');
    this.rubricVersion = requireText(definition.rubricVersion, 'Rubric version');
    if (!Array.isArray(definition.requirements) || definition.requirements.length === 0) {
      throw new DomainError('INVALID_INPUT', 'A problem needs at least one requirement.');
    }
    this.requirements = Object.freeze(
      definition.requirements.map((requirement) => requireText(requirement, 'Requirement')),
    );
    Object.freeze(this);
  }
}
