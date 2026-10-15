import type { EvaluationContext } from '../../application/ports/evaluator.ts';
import { buildEvaluationPrompt, MAX_COMPLETION_TOKENS } from '../../application/evaluation-prompt.ts';

export const GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export function buildGeminiRequest(context: EvaluationContext) {
  const prompt = buildEvaluationPrompt(context);
  return {
    systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt.userContent }] }],
    generationConfig: {
      candidateCount: 1,
      maxOutputTokens: MAX_COMPLETION_TOKENS,
      // Gemini 3.8 Flash supports LOW/MEDIUM/HIGH; MINIMAL is rejected.
      thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false },
      responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: prompt.responseSchema } },
    },
  };
}
