import { DomainError, isRecord } from './errors.ts';

export const SECTION_NAMES = Object.freeze({
  requirements: 'Requirements and assumptions',
  responsibilities: 'Classes and responsibilities',
  interactions: 'Relationships and interactions',
  edgeCases: 'Edge cases and testing',
  tradeOffs: 'Design trade-offs',
});

export type SectionId = keyof typeof SECTION_NAMES;
export type DesignSections = Readonly<Record<SectionId, string>>;
export const SECTION_IDS: readonly SectionId[] = Object.freeze(
  Object.keys(SECTION_NAMES) as SectionId[],
);
export const MAX_SUBMISSION_CHARACTERS = 6_000;

/** Count Unicode code points, including spaces and newlines, across the answer text. */
export function submissionCharacterCount(design: DesignSections): number {
  return SECTION_IDS.reduce((total, section) => total + Array.from(design[section]).length, 0);
}

export function emptyDesign(): DesignSections {
  return Object.freeze({
    requirements: '', responsibilities: '', interactions: '', edgeCases: '', tradeOffs: '',
  });
}

/** Drafts may be incomplete. An update changes only the supplied sections. */
export function updateDesign(current: DesignSections, patch: unknown): DesignSections {
  if (!isRecord(patch)) {
    throw new DomainError('INVALID_INPUT', 'The design must contain named text sections.');
  }
  const next = { ...current };
  const issues: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(SECTION_NAMES, key)) {
      issues[key] = 'Unknown design section.';
    } else if (typeof value !== 'string') {
      issues[key] = 'Enter text for this section.';
    } else {
      next[key as SectionId] = value;
    }
  }
  if (Object.keys(issues).length > 0) {
    throw new DomainError('INVALID_INPUT', 'Some design sections are invalid.', issues);
  }
  return Object.freeze(next);
}

export function validateSubmission(input: unknown): DesignSections {
  const design = updateDesign(emptyDesign(), input);
  const issues: Record<string, string> = {};
  for (const section of SECTION_IDS) {
    if (design[section].trim().length === 0) {
      issues[section] = `Complete ${SECTION_NAMES[section].toLowerCase()} before submitting.`;
    }
  }
  if (Object.keys(issues).length > 0) {
    throw new DomainError('INVALID_INPUT', 'Complete all five sections before submitting.', issues);
  }
  if (submissionCharacterCount(design) > MAX_SUBMISSION_CHARACTERS) {
    throw new DomainError('INVALID_INPUT', 'The submission exceeds the 6,000-character limit.', {
      totalLength: 'Use at most 6,000 characters across all five sections, including spaces and newlines.',
    });
  }
  // Preserve original text so feedback evidence refers to the exact submitted wording.
  return design;
}
