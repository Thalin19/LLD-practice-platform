/** Safe messages only: never persist raw provider bodies, credentials, or exception text. */
const FAILURE_MESSAGES = Object.freeze({
  EVALUATION_CONFIGURATION: 'The evaluator configuration or saved evaluation context is unavailable.',
  EVALUATION_CANCELLED: 'The evaluation was cancelled. You can retry it manually.',
  EVALUATION_INTERRUPTED: 'The server stopped before this evaluation finished. Retry manually if you want another evaluation.',
  EVALUATION_ERROR: 'The evaluation could not be completed. You can retry it manually.',
  INVALID_SUBMISSION: 'The saved submission does not meet the submission rules.',
  INVALID_FEEDBACK: 'The evaluator returned feedback that did not pass validation.',
  PROVIDER_AUTH: 'The evaluator could not authenticate with the provider.',
  PROVIDER_RATE_LIMIT: 'The provider quota or rate limit was reached. Wait before retrying manually.',
  PROVIDER_UNAVAILABLE: 'The evaluation provider is unavailable. You can retry it manually.',
  PROVIDER_REJECTED: 'The provider rejected the evaluation request.',
  PROVIDER_REFUSAL: 'The provider declined to evaluate this submission.',
  PROVIDER_TIMEOUT: 'The evaluation request timed out. You can retry it manually.',
  OUTPUT_LIMIT: 'The response reached its token limit before completion. No partial feedback was saved.',
});

export type EvaluationErrorCode = keyof typeof FAILURE_MESSAGES;

export class EvaluationError extends Error {
  readonly code: EvaluationErrorCode;
  constructor(code: EvaluationErrorCode) {
    super(FAILURE_MESSAGES[code]);
    this.name = 'EvaluationError';
    this.code = code;
  }
}
