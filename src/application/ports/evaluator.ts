import type { Problem } from '../../domain/problem.ts';
import type { Rubric } from '../../domain/rubric.ts';
import type { Submission } from '../../domain/submission.ts';

export interface EvaluationContext {
  readonly problem: Problem;
  readonly submission: Submission;
  readonly rubric: Rubric;
}

/** Provider responses are untrusted until Evaluation.complete validates them. */
export interface Evaluator {
  readonly id: string;
  evaluate(context: EvaluationContext, signal?: AbortSignal): Promise<unknown>;
}
