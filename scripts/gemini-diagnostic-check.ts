// One diagnostic request explicitly authorized after the first HTTP 400 check.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { PRACTICE_PROBLEMS } from '../src/content/problems.ts';
import { Attempt } from '../src/domain/attempt.ts';
import { isRecord } from '../src/domain/errors.ts';
import { DEFAULT_RUBRIC } from '../src/domain/rubric.ts';
import { buildGeminiRequest, GEMINI_ENDPOINT, GEMINI_MODEL } from '../src/infrastructure/gemini/request.ts';
import { loadCredential } from '../src/runtime/config.ts';

const reportFile = fileURLToPath(new URL('../outputs/gemini-diagnostic-check.json', import.meta.url));
const directory = fileURLToPath(new URL('../work/gemini-live-evaluation/', import.meta.url));
const marker = fileURLToPath(new URL('../work/gemini-live-evaluation/diagnostic-request-started.json', import.meta.url));

async function main() {
  if (existsSync(reportFile)) {
    console.log('The diagnostic result already exists. No additional request was made.');
    return;
  }
  if (existsSync(marker)) {
    console.log('The diagnostic request was already attempted. No additional request was made.');
    return;
  }
  const previous: unknown = JSON.parse(readFileSync(new URL('../outputs/gemini-live-evaluation-check.json', import.meta.url), 'utf8'));
  if (!isRecord(previous) || !isRecord(previous.sections)) throw new Error('Missing sample');
  const problem = PRACTICE_PROBLEMS.find((value) => value.id === 'parking-lot' && value.version === '1');
  if (!problem) throw new Error('Missing problem');
  const attempt = Attempt.start('diagnostic-attempt', 'diagnostic-learner', problem);
  attempt.updateDraft(previous.sections);
  const submission = attempt.submit('diagnostic-submission');
  const request = buildGeminiRequest({ problem, submission, rubric: DEFAULT_RUBRIC });
  const apiKey = loadCredential('GEMINI_API_KEY');
  const local = parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
  const secrets = [apiKey, ...Object.entries(local).filter(([name]) => /(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(name)).map(([, value]) => value)]
    .filter((value): value is string => typeof value === 'string' && value.length > 0).sort((a, b) => b.length - a.length);
  function redact(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    let result = value;
    for (const secret of secrets) result = result.split(secret).join('[REDACTED]');
    for (const section of Object.values(submission.sections)) result = result.split(section).join('[SUBMISSION REDACTED]');
    return result.replace(/\b(?:AIza|AQ\.)[A-Za-z0-9_.-]+/g, '[REDACTED]')
      .replace(/[A-Za-z0-9_-]{32,}/g, '[LONG VALUE REDACTED]').slice(0, 4000);
  }
  const startedAt = new Date().toISOString();
  mkdirSync(directory, { recursive: true });
  // Exclusive marker persists even if the process is interrupted after sending.
  writeFileSync(marker, JSON.stringify({ startedAt, model: GEMINI_MODEL }), { flag: 'wx' });
  let report: Record<string, unknown>;
  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(request),
    });
    let envelope: unknown;
    try { envelope = await response.json(); } catch { envelope = null; }
    const error = isRecord(envelope) && isRecord(envelope.error) ? envelope.error : null;
    const details = error && Array.isArray(error.details) ? error.details.filter(isRecord).map((detail) => ({
      type: redact(detail['@type']), reason: redact(detail.reason), domain: redact(detail.domain),
      fieldViolations: Array.isArray(detail.fieldViolations) ? detail.fieldViolations.filter(isRecord).map((violation) => ({
        field: redact(violation.field), description: redact(violation.description),
      })) : [],
    })) : [];
    let validatedFeedback: unknown = null;
    let feedbackValidation: string | null = null;
    if (response.ok && isRecord(envelope) && Array.isArray(envelope.candidates) && envelope.candidates.length === 1) {
      const candidate: unknown = envelope.candidates[0];
      try {
        if (!isRecord(candidate) || candidate.finishReason !== 'STOP' || !isRecord(candidate.content)
          || !Array.isArray(candidate.content.parts)) throw new Error('Incomplete response');
        const content = candidate.content.parts.filter(isRecord).filter((part) => part.thought !== true)
          .map((part) => typeof part.text === 'string' ? part.text : '').join('');
        validatedFeedback = DEFAULT_RUBRIC.validateFeedback(JSON.parse(content), submission.sections);
        feedbackValidation = 'Accepted by the domain rubric validator.';
      } catch { feedbackValidation = 'No accepted complete feedback.'; }
    }
    report = { startedAt, finishedAt: new Date().toISOString(), model: GEMINI_MODEL, requests: 1, automaticRetries: 0,
      httpStatus: response.status, providerStatus: redact(error?.status), providerMessage: redact(error?.message),
      providerDetails: details, feedbackValidation, validatedFeedback };
  } catch {
    report = { startedAt, finishedAt: new Date().toISOString(), model: GEMINI_MODEL, requests: 1,
      automaticRetries: 0, httpStatus: null, diagnostic: 'Transport failed or timed out; no retry was made.' };
  }
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const { validatedFeedback: _feedback, ...summary } = report;
  console.log(JSON.stringify(summary));
}

try { await main(); }
catch {
  console.error('The diagnostic could not finish. Check the marker and saved result before authorizing any further request.');
  process.exitCode = 1;
}
