import { DomainError } from '../domain/errors.ts';
import { validateSubmission } from '../domain/design.ts';
import { EvaluationError } from './evaluation-errors.ts';
import type { Evaluator } from './ports/evaluator.ts';
import type { PracticeRepository, StoredEvaluation } from './ports/practice-repository.ts';

/** Executes one claimed run. Scheduling and restart recovery are supplied separately. */
export class EvaluationProcessor {
  readonly #repository: PracticeRepository;
  readonly #evaluator: Evaluator;

  constructor(repository: PracticeRepository, evaluator: Evaluator) {
    this.#repository = repository;
    this.#evaluator = evaluator;
  }

  async processNext(signal?: AbortSignal): Promise<StoredEvaluation | null> {
    if (signal?.aborted) return null;
    const saved = this.#repository.claimNextEvaluation();
    if (saved === null) return null;
    const run = saved.value;
    try {
      if (run.evaluatorId !== this.#evaluator.id) throw new EvaluationError('EVALUATION_CONFIGURATION');
      const submission = this.#repository.getSubmission(run.submissionId);
      if (submission === null) throw new EvaluationError('EVALUATION_CONFIGURATION');
      const problem = this.#repository.getProblem(submission.problemId, submission.problemVersion);
      const rubric = this.#repository.getRubric(submission.rubricVersion);
      if (problem === null || rubric === null) throw new EvaluationError('EVALUATION_CONFIGURATION');
      validateSubmission(submission.sections);
      const feedback = await this.#evaluator.evaluate({ submission, problem, rubric }, signal);
      if (signal?.aborted) throw new EvaluationError('EVALUATION_CANCELLED');
      run.complete(feedback);
    } catch (error) {
      const failure = error instanceof EvaluationError ? new EvaluationError(error.code)
        : error instanceof DomainError && error.code === 'INVALID_FEEDBACK' ? new EvaluationError('INVALID_FEEDBACK')
        : error instanceof DomainError && error.code === 'INVALID_INPUT' ? new EvaluationError('INVALID_SUBMISSION')
        : new EvaluationError('EVALUATION_ERROR');
      run.fail({ code: failure.code, message: failure.message });
    }
    // Keep persistence failures outside the provider catch. A stale result must not overwrite newer state.
    return this.#repository.saveEvaluation(run, saved.revision);
  }
}
