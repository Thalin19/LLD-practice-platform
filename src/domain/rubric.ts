import { SECTION_NAMES, type DesignSections, type SectionId } from './design.ts';
import { DomainError, isRecord, requireText } from './errors.ts';

export const ASSESSMENT_LABELS = Object.freeze({
  strong: 'Strong',
  needs_improvement: 'Needs improvement',
  insufficient_evidence: 'Insufficient evidence',
});
export type AssessmentLabel = keyof typeof ASSESSMENT_LABELS;

export interface Criterion {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export interface Evidence {
  readonly sectionId: SectionId;
  readonly quote: string;
}

export interface Assessment {
  readonly criterionId: string;
  readonly label: AssessmentLabel;
  readonly evidence: readonly Evidence[];
  readonly explanation: string;
  readonly suggestion: string;
}

export interface EvaluationFeedback {
  readonly assessments: readonly Assessment[];
  readonly priorityImprovements: readonly string[];
}

function invalidFeedback(message: string): never {
  throw new DomainError('INVALID_FEEDBACK', message);
}

function feedbackText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidFeedback(`Feedback ${field} must be non-empty text.`);
  }
  return value.trim();
}

export class Rubric {
  readonly version: string;
  readonly criteria: readonly Criterion[];

  constructor(version: string, criteria: readonly Criterion[]) {
    this.version = requireText(version, 'Rubric version');
    if (!Array.isArray(criteria) || criteria.length === 0) {
      throw new DomainError('INVALID_INPUT', 'A rubric needs assessment criteria.');
    }
    const ids = new Set<string>();
    this.criteria = Object.freeze(criteria.map((criterion) => {
      const id = requireText(criterion.id, 'Criterion ID');
      if (ids.has(id)) {
        throw new DomainError('INVALID_INPUT', 'Rubric criterion IDs must be unique.');
      }
      ids.add(id);
      return Object.freeze({
        id,
        title: requireText(criterion.title, 'Criterion title'),
        description: requireText(criterion.description, 'Criterion description'),
      });
    }));
    Object.freeze(this);
  }

  /** Check provider data before accepting it as a successful evaluation. */
  validateFeedback(raw: unknown, sections: DesignSections): EvaluationFeedback {
    if (!isRecord(raw) || !Array.isArray(raw.assessments)) {
      return invalidFeedback('Feedback must contain a list of assessments.');
    }
    if (raw.assessments.length !== this.criteria.length) {
      return invalidFeedback('Feedback must assess every rubric criterion exactly once.');
    }
    const allowedIds = new Set(this.criteria.map((criterion) => criterion.id));
    const seen = new Set<string>();
    const assessments = raw.assessments.map((item: unknown): Assessment => {
      if (!isRecord(item)) return invalidFeedback('Each assessment must be an object.');
      const criterionId = feedbackText(item.criterionId, 'criterion ID');
      if (!allowedIds.has(criterionId) || seen.has(criterionId)) {
        return invalidFeedback('Feedback contains an unknown or repeated criterion.');
      }
      seen.add(criterionId);
      if (typeof item.label !== 'string' || !Object.hasOwn(ASSESSMENT_LABELS, item.label)) {
        return invalidFeedback('Feedback contains an invalid assessment label.');
      }
      const label = item.label as AssessmentLabel;
      if (!Array.isArray(item.evidence)) {
        return invalidFeedback('Assessment evidence must be a list.');
      }
      const evidence = item.evidence.map((entry: unknown): Evidence => {
        if (!isRecord(entry) || typeof entry.sectionId !== 'string'
          || !Object.hasOwn(SECTION_NAMES, entry.sectionId)) {
          return invalidFeedback('Evidence must refer to a known submission section.');
        }
        const sectionId = entry.sectionId as SectionId;
        const quote = feedbackText(entry.quote, 'evidence quote');
        if (!sections[sectionId].includes(quote)) {
          return invalidFeedback('An evidence quote does not appear in its submission section.');
        }
        return Object.freeze({ sectionId, quote });
      });
      if (label !== 'insufficient_evidence' && evidence.length === 0) {
        return invalidFeedback('A design judgement needs supporting evidence.');
      }
      return Object.freeze({
        criterionId,
        label,
        evidence: Object.freeze(evidence),
        explanation: feedbackText(item.explanation, 'explanation'),
        suggestion: feedbackText(item.suggestion, 'suggestion'),
      });
    });
    if (!Array.isArray(raw.priorityImprovements) || raw.priorityImprovements.length > 3) {
      return invalidFeedback('Feedback must contain a list of at most three priority improvements.');
    }
    const priorityImprovements = raw.priorityImprovements.map(
      (item: unknown) => feedbackText(item, 'priority improvement'),
    );
    return Object.freeze({
      assessments: Object.freeze(assessments),
      priorityImprovements: Object.freeze(priorityImprovements),
    });
  }
}

export const DEFAULT_RUBRIC = new Rubric('1', [
  {
    id: 'requirements_coverage', title: 'Requirements coverage',
    description: 'Does the design address the stated requirements?',
  },
  {
    id: 'class_responsibilities', title: 'Class responsibilities',
    description: 'Does each class have a clear, cohesive purpose?',
  },
  {
    id: 'relationships_interfaces', title: 'Relationships and interfaces',
    description: 'Are interactions and dependencies well defined?',
  },
  {
    id: 'extensibility_tradeoffs', title: 'Extensibility and trade-offs',
    description: 'Are choices justified, and how would the design accommodate change?',
  },
  {
    id: 'edge_cases_testability', title: 'Edge cases and testability',
    description: 'Does the design handle failures and support meaningful tests?',
  },
]);
