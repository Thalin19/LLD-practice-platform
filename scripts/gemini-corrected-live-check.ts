// One separately authorized verification after correcting unsupported MINIMAL to LOW.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EvaluationProcessor } from '../src/application/evaluation-processor.ts';
import { PracticeService } from '../src/application/practice-service.ts';
import { GeminiEvaluator } from '../src/infrastructure/gemini/evaluator.ts';
import { EVALUATION_PROMPT_VERSION, MAX_COMPLETION_TOKENS } from '../src/application/evaluation-prompt.ts';
import { GEMINI_MODEL } from '../src/infrastructure/gemini/request.ts';
import { SqlitePracticeRepository } from '../src/infrastructure/sqlite/practice-repository.ts';
import { seedCatalogue } from '../src/infrastructure/sqlite/seed-catalogue.ts';
import { loadCredential } from '../src/runtime/config.ts';
import { submissionCharacterCount } from '../src/domain/design.ts';
import { isRecord } from '../src/domain/errors.ts';

const directory = fileURLToPath(new URL('../work/gemini-live-evaluation/corrected/', import.meta.url));
const reportFile = fileURLToPath(new URL('../outputs/gemini-corrected-live-check.json', import.meta.url));
const requestMarker = fileURLToPath(new URL('../work/gemini-live-evaluation/corrected/request-started.json', import.meta.url));

// This is a one-shot, explicitly authorized check, never part of npm test or server startup.
// Rerunning it displays the prior result instead of spending more quota.
if (existsSync(reportFile)) {
  const previous: unknown = JSON.parse(readFileSync(reportFile, 'utf8'));
  if (isRecord(previous)) console.log(JSON.stringify({ existingReport: true, status: previous.status,
    usage: previous.usage, newRequests: 0 }));
} else if (existsSync(requestMarker)) {
  console.log('A live request was already attempted. No additional request was made. Review the saved marker and result before authorizing more work.');
  process.exitCode = 1;
} else {
  mkdirSync(directory, { recursive: true });
  const repository = new SqlitePracticeRepository(fileURLToPath(new URL('../work/gemini-live-evaluation/corrected/practice.sqlite', import.meta.url)));
  try {
    seedCatalogue(repository);
    const apiKey = loadCredential('GEMINI_API_KEY');
    let requests = 0;
    let httpStatus: number | null = null;
    let finishReason: string | null = null;
    let providerDiagnostic: { status: string | null; message: string | null } | null = null;
    let usage: { promptTokens: number | null; completionTokens: number | null; thinkingTokens: number | null; totalTokens: number | null } | null = null;
    const startedAt = new Date().toISOString();
    const evaluator = new GeminiEvaluator({ apiKey, fetch: async (url, init) => {
      if (requests !== 0) throw new Error('The authorized live request limit was reached.');
      // Exclusive creation prevents a repeated or concurrent script invocation from sending again.
      writeFileSync(requestMarker, JSON.stringify({ startedAt, model: GEMINI_MODEL, promptVersion: EVALUATION_PROMPT_VERSION }), { flag: 'wx' });
      requests++;
      const response = await fetch(url, init);
      httpStatus = response.status;
      if (!response.ok) {
        let envelope: unknown;
        try { envelope = await response.clone().json(); } catch { envelope = null; }
        const providerError = isRecord(envelope) && isRecord(envelope.error) ? envelope.error : null;
        const sanitize = (value: unknown): string | null => typeof value === 'string'
          ? value.split(apiKey).join('[REDACTED]').replace(/\b(?:AIza|AQ\.)[A-Za-z0-9_.-]+/g, '[REDACTED]')
            .replace(/[A-Za-z0-9_-]{32,}/g, '[LONG VALUE REDACTED]').slice(0, 2000) : null;
        providerDiagnostic = { status: sanitize(providerError?.status), message: sanitize(providerError?.message) };
      }
      if (response.ok) {
        const envelope: unknown = await response.clone().json();
        if (isRecord(envelope)) {
          const counts = isRecord(envelope.usageMetadata) ? envelope.usageMetadata : {};
          const tokenCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
          usage = { promptTokens: tokenCount(counts.promptTokenCount), completionTokens: tokenCount(counts.candidatesTokenCount), thinkingTokens: tokenCount(counts.thoughtsTokenCount), totalTokens: tokenCount(counts.totalTokenCount) };
          if (Array.isArray(envelope.candidates) && isRecord(envelope.candidates[0])) {
            const reason: unknown = envelope.candidates[0].finishReason;
            if (typeof reason === 'string' && ['STOP', 'MAX_TOKENS', 'CONTINUATION', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'OTHER'].includes(reason)) finishReason = reason;
          }
        }
      }
      return response;
    } });
    const service = new PracticeService(repository, { learnerId: 'live-check', evaluatorId: evaluator.id,
      createId: (kind) => `live-check-${kind}-${randomUUID()}` });
    const sections = {
      requirements: 'One lot with matching motorcycle/car spots. Reject full capacity, duplicate active vehicles, and invalid tickets. Round fees up to started hours with a one-hour minimum. Release the spot only after successful payment.',
      responsibilities: 'ParkingLot owns allocation. Spot owns occupancy and vehicle type. Ticket records vehicle, spot, entry time, and status. PricingPolicy computes fees. PaymentGateway charges. Clock supplies time.',
      interactions: 'Entry locks allocation, finds a free matching spot, reserves it, and issues a ticket. Exit finds the active ticket, computes the fee, pays, then closes the ticket and releases the spot. Failed payment keeps the ticket and occupancy. Repeated exit returns an error without charging.',
      edgeCases: 'Use fake clock and payment implementations. Test full or mismatched capacity, duplicate entry and exit, failed payment, 59/60/61-minute fee boundaries, and simultaneous allocations.',
      tradeOffs: 'A single-process lock keeps allocation atomic. A pricing interface supports new rate policies. The lock does not coordinate multiple processes; persistent transactions would replace it if that scope were introduced.',
    };
    const draft = service.startAttempt('parking-lot', '1');
    const saved = service.saveDraft({ attemptId: draft.value.id, expectedRevision: draft.revision, patch: sections });
    const submitted = service.submitAttempt({ attemptId: draft.value.id, expectedRevision: saved.revision });
    const result = await new EvaluationProcessor(repository, evaluator).processNext();
    if (result === null) throw new Error('No queued live check was found.');
    const report = {
      startedAt, finishedAt: new Date().toISOString(), model: GEMINI_MODEL,
      promptVersion: EVALUATION_PROMPT_VERSION, problemId: 'parking-lot', problemVersion: '1', rubricVersion: '1',
      answerCharacters: submissionCharacterCount(sections), maxCompletionTokens: MAX_COMPLETION_TOKENS,
      requests, automaticRetries: 0, thinkingLevel: 'LOW', httpStatus, finishReason, usage, providerDiagnostic,
      status: result.value.status, feedback: result.value.feedback, failure: result.value.failure,
      sections, evaluationId: submitted.evaluation.value.id,
      validation: result.value.status === 'completed' ? 'Accepted by the domain rubric validator and persisted in the isolated check database.' : 'No accepted feedback was saved.',
    };
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, requests, httpStatus, finishReason, usage, providerDiagnostic,
      assessmentCount: report.feedback?.assessments.length ?? 0, failureCode: report.failure?.code ?? null }));
    if (report.status !== 'completed') process.exitCode = 1;
  } finally { repository.close(); }
}
