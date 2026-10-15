import type { EvaluationContext } from '../../application/ports/evaluator.ts';
import { buildEvaluationPrompt, MAX_COMPLETION_TOKENS } from '../../application/evaluation-prompt.ts';
export { MAX_COMPLETION_TOKENS, EVALUATION_PROMPT_VERSION, EVALUATION_SYSTEM_PROMPT } from '../../application/evaluation-prompt.ts';

export const GROQ_MODEL = 'qwen/qwen3.8-27b';

export function buildEvaluationRequest(context: EvaluationContext) {
  const prompt = buildEvaluationPrompt(context);
  return {
    model: GROQ_MODEL, reasoning_effort: 'none', max_completion_tokens: MAX_COMPLETION_TOKENS, stream: false, n: 1,
    messages: [{ role: 'system', content: prompt.systemInstruction }, { role: 'user', content: prompt.userContent }],
    response_format: { type: 'json_schema', json_schema: { name: 'lld_feedback', strict: true, schema: prompt.responseSchema } },
  };
}
