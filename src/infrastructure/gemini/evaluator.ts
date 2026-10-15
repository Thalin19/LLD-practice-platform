import type { EvaluationContext, Evaluator } from '../../application/ports/evaluator.ts';
import { EvaluationError } from '../../application/evaluation-errors.ts';
import { isRecord } from '../../domain/errors.ts';
import type { EvaluationFeedback } from '../../domain/rubric.ts';
import { buildGeminiRequest, GEMINI_ENDPOINT } from './request.ts';

interface GeminiEvaluatorOptions {
  readonly apiKey: string;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

const REFUSALS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']);

export class GeminiEvaluator implements Evaluator {
  readonly id = 'gemini';
  readonly #apiKey: string;
  readonly #fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly #timeoutMs: number;

  constructor(options: GeminiEvaluatorOptions) {
    if (typeof options.apiKey !== 'string' || !options.apiKey.trim()) throw new EvaluationError('EVALUATION_CONFIGURATION');
    this.#apiKey = options.apiKey.trim();
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 2_147_483_647) {
      throw new EvaluationError('EVALUATION_CONFIGURATION');
    }
  }

  async evaluate(context: EvaluationContext, signal?: AbortSignal): Promise<EvaluationFeedback> {
    if (signal?.aborted) throw new EvaluationError('EVALUATION_CANCELLED');
    const request = buildGeminiRequest(context);
    const deadline = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      // One native request; no retry, redirect, continuation, or provider fallback.
      const response = await this.#fetch(GEMINI_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#apiKey },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new EvaluationError('PROVIDER_RATE_LIMIT');
        if (response.status === 401 || response.status === 403) throw new EvaluationError('PROVIDER_AUTH');
        if (response.status >= 500) throw new EvaluationError('PROVIDER_UNAVAILABLE');
        throw new EvaluationError('PROVIDER_REJECTED');
      }
      let envelope: unknown;
      try { envelope = await response.json(); }
      catch { throw new EvaluationError('INVALID_FEEDBACK'); }
      if (!isRecord(envelope)) throw new EvaluationError('INVALID_FEEDBACK');
      if (isRecord(envelope.promptFeedback) && envelope.promptFeedback.blockReason
        && envelope.promptFeedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED') throw new EvaluationError('PROVIDER_REFUSAL');
      if (!Array.isArray(envelope.candidates) || envelope.candidates.length !== 1) throw new EvaluationError('INVALID_FEEDBACK');
      const candidate: unknown = envelope.candidates[0];
      if (!isRecord(candidate)) throw new EvaluationError('INVALID_FEEDBACK');
      if (candidate.finishReason === 'MAX_TOKENS' || candidate.finishReason === 'CONTINUATION') throw new EvaluationError('OUTPUT_LIMIT');
      if (typeof candidate.finishReason === 'string' && REFUSALS.has(candidate.finishReason)) throw new EvaluationError('PROVIDER_REFUSAL');
      if (candidate.finishReason !== 'STOP' || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
        throw new EvaluationError('INVALID_FEEDBACK');
      }
      let content = '';
      for (const part of candidate.content.parts as unknown[]) {
        if (!isRecord(part)) throw new EvaluationError('INVALID_FEEDBACK');
        if (part.thought === true) continue;
        if (typeof part.text !== 'string' || Object.keys(part).some((key) => !['text', 'thought', 'thoughtSignature'].includes(key))) {
          throw new EvaluationError('INVALID_FEEDBACK');
        }
        content += part.text;
      }
      let feedback: unknown;
      try { feedback = JSON.parse(content); }
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
