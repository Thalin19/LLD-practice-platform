import type { EvaluationContext, Evaluator } from '../../application/ports/evaluator.ts';
import { EvaluationError } from '../../application/evaluation-errors.ts';
import { isRecord } from '../../domain/errors.ts';
import type { EvaluationFeedback } from '../../domain/rubric.ts';
import { buildEvaluationRequest } from './request.ts';

type FetchTransport = (url: string, init: RequestInit) => Promise<Response>;
interface GroqEvaluatorOptions {
  readonly apiKey: string;
  readonly fetch?: FetchTransport;
  readonly timeoutMs?: number;
}

export class GroqEvaluator implements Evaluator {
  readonly id = 'groq';
  readonly #apiKey: string;
  readonly #fetch: FetchTransport;
  readonly #timeoutMs: number;

  constructor(options: GroqEvaluatorOptions) {
    if (typeof options.apiKey !== 'string' || options.apiKey.trim().length === 0) {
      throw new EvaluationError('EVALUATION_CONFIGURATION');
    }
    this.#apiKey = options.apiKey.trim();
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 2_147_483_647) {
      throw new EvaluationError('EVALUATION_CONFIGURATION');
    }
  }

  async evaluate(context: EvaluationContext, signal?: AbortSignal): Promise<EvaluationFeedback> {
    if (signal?.aborted) throw new EvaluationError('EVALUATION_CANCELLED');
    const request = buildEvaluationRequest(context);
    const deadline = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      // Native fetch has no model-request retry loop. Redirects are rejected rather than followed.
      const response = await this.#fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        // Discard error bodies; they may contain submitted text or provider internals.
        await response.body?.cancel();
        if (response.status === 429) throw new EvaluationError('PROVIDER_RATE_LIMIT');
        if (response.status === 401 || response.status === 403) throw new EvaluationError('PROVIDER_AUTH');
        if (response.status >= 500) throw new EvaluationError('PROVIDER_UNAVAILABLE');
        throw new EvaluationError('PROVIDER_REJECTED');
      }
      let envelope: unknown;
      try { envelope = await response.json(); }
      catch { throw new EvaluationError('INVALID_FEEDBACK'); }
      if (!isRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) {
        throw new EvaluationError('INVALID_FEEDBACK');
      }
      const choice: unknown = envelope.choices[0];
      if (!isRecord(choice)) throw new EvaluationError('INVALID_FEEDBACK');
      if (choice.finish_reason === 'length') throw new EvaluationError('OUTPUT_LIMIT');
      if (choice.finish_reason === 'content_filter') throw new EvaluationError('PROVIDER_REFUSAL');
      if (choice.finish_reason !== 'stop' || !isRecord(choice.message)) throw new EvaluationError('INVALID_FEEDBACK');
      if (choice.message.refusal) throw new EvaluationError('PROVIDER_REFUSAL');
      if (typeof choice.message.content !== 'string') throw new EvaluationError('INVALID_FEEDBACK');
      let feedback: unknown;
      try { feedback = JSON.parse(choice.message.content); }
      catch { throw new EvaluationError('INVALID_FEEDBACK'); }
      if (combined.aborted) throw new EvaluationError(signal?.aborted ? 'EVALUATION_CANCELLED' : 'PROVIDER_TIMEOUT');
      try { return context.rubric.validateFeedback(feedback, context.submission.sections); }
      catch { throw new EvaluationError('INVALID_FEEDBACK'); }
    } catch (error) {
      if (signal?.aborted) throw new EvaluationError('EVALUATION_CANCELLED');
      if (deadline.aborted) throw new EvaluationError('PROVIDER_TIMEOUT');
      if (error instanceof EvaluationError) throw error;
      throw new EvaluationError('PROVIDER_UNAVAILABLE');
    }
  }
}
