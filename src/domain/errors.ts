export type DomainErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_TRANSITION'
  | 'INVALID_FEEDBACK'
  | 'VERSION_MISMATCH';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly issues: Readonly<Record<string, string>>;

  constructor(code: DomainErrorCode, message: string, issues: Record<string, string> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.issues = Object.freeze({ ...issues });
  }
}

export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError('INVALID_INPUT', `${field} must be non-empty text.`);
  }
  return value.trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
