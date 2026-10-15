import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { EvaluationProcessor } from '../src/application/evaluation-processor.ts';
import { EvaluationError } from '../src/application/evaluation-errors.ts';
import { PracticeService } from '../src/application/practice-service.ts';
import type { EvaluationContext, Evaluator } from '../src/application/ports/evaluator.ts';
import { StorageError } from '../src/application/ports/practice-repository.ts';
import type { attemptResponse, evaluationResponse } from '../src/http/representations.ts';
import { DEFAULT_RUBRIC } from '../src/domain/rubric.ts';
import { GroqEvaluator } from '../src/infrastructure/groq/evaluator.ts';
import { SqlitePracticeRepository } from '../src/infrastructure/sqlite/practice-repository.ts';
import { seedCatalogue } from '../src/infrastructure/sqlite/seed-catalogue.ts';
import { EvaluationWorker } from '../src/infrastructure/worker/evaluation-worker.ts';
import { loadServerConfig } from '../src/runtime/config.ts';
import { startServer } from '../src/runtime/start-server.ts';

type Runtime = Awaited<ReturnType<typeof startServer>>;
type AttemptJson = ReturnType<typeof attemptResponse>;
type EvaluationJson = ReturnType<typeof evaluationResponse>;
const sections = {
  requirements: 'Allocate a matching spot or reject entry.',
  responsibilities: 'ParkingLot manages occupancy. PricingPolicy calculates the fee.',
  interactions: 'Reserve a spot before issuing a ticket.',
  edgeCases: 'Test full capacity, duplicate entry, and failed payment.',
  tradeOffs: 'Isolate pricing to permit new policies.',
};

function feedback() {
  return { assessments: DEFAULT_RUBRIC.criteria.map((criterion) => ({
    criterionId: criterion.id, label: 'insufficient_evidence', evidence: [],
    explanation: 'Offline worker fixture.', suggestion: 'Describe the failure interaction.',
  })), priorityImprovements: ['Clarify the failure outcome.'] };
}

async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 3_000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the local test condition.');
    await delay(5);
  }
}

function setup(t: TestContext) {
  const base = resolve(fileURLToPath(new URL('../work/test-databases/', import.meta.url)));
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'worker-'));
  const filename = join(directory, 'practice.sqlite');
  const repositories: SqlitePracticeRepository[] = [];
  const workers: EvaluationWorker[] = [];
  const runtimes: Runtime[] = [];
  let sequence = 0;
  const open = () => {
    const repository = new SqlitePracticeRepository(filename);
    repositories.push(repository);
    return repository;
  };
  const serviceFor = (repository: SqlitePracticeRepository) => new PracticeService(repository, {
    learnerId: 'demo-learner', evaluatorId: 'groq', createId: (kind) => `${kind}-${++sequence}`,
  });
  const queue = (repository: SqlitePracticeRepository) => {
    const service = serviceFor(repository);
    const draft = service.startAttempt('parking-lot', '1');
    const saved = service.saveDraft({ attemptId: draft.value.id, expectedRevision: 0, patch: sections });
    return service.submitAttempt({ attemptId: draft.value.id, expectedRevision: saved.revision });
  };
  const workerFor = (repository: SqlitePracticeRepository, evaluator: Evaluator,
    options: { pollIntervalMs?: number; onFatalError?: () => void } = {}) => {
    const worker = new EvaluationWorker(repository, new EvaluationProcessor(repository, evaluator), {
      pollIntervalMs: 5, ...options,
    });
    workers.push(worker);
    return worker;
  };
  const runServer = async (repository: SqlitePracticeRepository, evaluator: Evaluator, port = 0) => {
    const runtime = await startServer({ repository, evaluator, port, pollIntervalMs: 5 });
    runtimes.push(runtime);
    return runtime;
  };
  t.after(async () => {
    for (const runtime of runtimes) await runtime.close();
    for (const worker of workers) await worker.stop();
    for (const repository of repositories) repository.close();
    const target = resolve(directory);
    if (!target.startsWith(base + sep)) throw new Error('Unsafe test cleanup path.');
    rmSync(target, { recursive: true });
  });
  const repository = open();
  seedCatalogue(repository);
  return { repository, directory, filename, open, queue, serviceFor, workerFor, runServer };
}

test('worker processes a queue sequentially and does not start a second loop', async (t) => {
  const { repository, queue, workerFor } = setup(t);
  const first = queue(repository);
  const second = queue(repository);
  let active = 0;
  let peak = 0;
  let calls = 0;
  const worker = workerFor(repository, { id: 'groq', evaluate: async () => {
    calls++; active++; peak = Math.max(peak, active);
    await delay(15);
    active--;
    return feedback();
  } });
  assert.equal(worker.start(), 0);
  assert.throws(() => worker.start(), /already started/);
  await until(() => repository.getEvaluation(second.evaluation.value.id)?.value.status === 'completed');
  await worker.stop();
  assert.equal(worker.status, 'stopped');
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  assert.equal(repository.getEvaluation(first.evaluation.value.id)?.value.status, 'completed');
});

test('worker notices submissions added after it starts with an empty queue', async (t) => {
  const { repository, queue, workerFor } = setup(t);
  let calls = 0;
  const worker = workerFor(repository, { id: 'groq', evaluate: async () => { calls++; return feedback(); } });
  worker.start();
  assert.equal(calls, 0);
  const submitted = queue(repository);
  await until(() => repository.getEvaluation(submitted.evaluation.value.id)?.value.status === 'completed');
  await worker.stop();
  assert.equal(calls, 1);
});

test('restart fails interrupted work, preserves terminal history, and processes only never-started work', async (t) => {
  const { repository, open, queue, serviceFor, workerFor } = setup(t);
  const completed = queue(repository);
  let claimed = repository.claimNextEvaluation()!;
  claimed.value.complete(feedback()); repository.saveEvaluation(claimed.value, claimed.revision);
  const failed = queue(repository);
  claimed = repository.claimNextEvaluation()!;
  claimed.value.fail({ code: 'ORIGINAL_FAILURE', message: 'Existing failure.' });
  repository.saveEvaluation(claimed.value, claimed.revision);
  const interrupted = queue(repository);
  const running = repository.claimNextEvaluation()!;
  const pending = queue(repository);
  repository.close(); // Simulate losing the process while a claimed request was in progress.

  const reopened = open();
  const evaluated: string[] = [];
  const evaluator: Evaluator = { id: 'groq', evaluate: async (input) => {
    evaluated.push(input.submission.id); return feedback();
  } };
  const worker = workerFor(reopened, evaluator);
  assert.equal(worker.start(), 1);
  await until(() => reopened.getEvaluation(pending.evaluation.value.id)?.value.status === 'completed');
  await worker.stop();
  assert.deepEqual(evaluated, [pending.evaluation.value.submissionId]);
  const recovered = reopened.getEvaluation(interrupted.evaluation.value.id)!;
  assert.equal(recovered.value.failure?.code, 'EVALUATION_INTERRUPTED');
  assert.equal(recovered.startedAt, running.startedAt);
  assert.ok(recovered.finishedAt);
  assert.equal(reopened.getEvaluation(completed.evaluation.value.id)?.value.status, 'completed');
  assert.equal(reopened.getEvaluation(failed.evaluation.value.id)?.value.failure?.code, 'ORIGINAL_FAILURE');

  const retry = serviceFor(reopened).retryEvaluation(recovered.value.id);
  const restarted = workerFor(reopened, evaluator);
  assert.equal(restarted.start(), 0);
  await until(() => reopened.getEvaluation(retry.value.id)?.value.status === 'completed');
  await restarted.stop();
  assert.deepEqual(evaluated, [pending.evaluation.value.submissionId, recovered.value.submissionId]);
  assert.equal(reopened.getEvaluation(recovered.value.id)?.value.status, 'failed');
});

test('recovery rolls back all interrupted state changes if any saved failure cannot be written', (t) => {
  const { repository, queue, filename } = setup(t);
  const first = queue(repository);
  const second = queue(repository);
  repository.claimNextEvaluation(); repository.claimNextEvaluation();
  const raw = new DatabaseSync(filename);
  try {
    // IDs are generated by this test; quote the literal for the trigger definition.
    const id = second.evaluation.value.id.replaceAll("'", "''");
    raw.exec(`CREATE TRIGGER reject_recovery_fixture BEFORE UPDATE ON evaluations
      WHEN OLD.id = '${id}' AND NEW.status = 'failed'
      BEGIN SELECT RAISE(ABORT, 'offline recovery failure'); END;`);
    assert.throws(() => repository.failInterruptedEvaluations({ code: 'INTERRUPTED', message: 'Offline fixture.' }), StorageError);
    assert.equal(repository.getEvaluation(first.evaluation.value.id)?.value.status, 'evaluating');
    assert.equal(repository.getEvaluation(second.evaluation.value.id)?.value.status, 'evaluating');
    raw.exec('DROP TRIGGER reject_recovery_fixture');
  } finally { raw.close(); }
  assert.equal(repository.failInterruptedEvaluations({ code: 'INTERRUPTED', message: 'Offline fixture.' }), 2);
  assert.equal(repository.failInterruptedEvaluations({ code: 'INTERRUPTED', message: 'Offline fixture.' }), 0);
});

test('shutdown cancels an active evaluation, saves its failure, and leaves later work queued', async (t) => {
  const { repository, queue, workerFor, open } = setup(t);
  const first = queue(repository);
  const second = queue(repository);
  let calls = 0;
  const worker = workerFor(repository, { id: 'groq', evaluate: async (_input, signal) => {
    calls++;
    assert.ok(signal);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new EvaluationError('EVALUATION_CANCELLED')), { once: true }));
  } });
  worker.start();
  await until(() => calls === 1);
  await worker.stop();
  await worker.stop();
  repository.close();
  const reopened = open();
  assert.equal(reopened.getEvaluation(first.evaluation.value.id)?.value.failure?.code, 'EVALUATION_CANCELLED');
  assert.equal(reopened.getEvaluation(second.evaluation.value.id)?.value.status, 'queued');
  assert.equal(calls, 1);
});

test('stopping an idle polling worker cancels the timer promptly', async (t) => {
  const { repository, workerFor } = setup(t);
  const worker = workerFor(repository, { id: 'groq', evaluate: async () => { throw new Error('No queued work'); } },
    { pollIntervalMs: 60_000 });
  worker.start();
  await delay(5);
  const started = Date.now();
  await worker.stop();
  assert.ok(Date.now() - started < 1_000);
  assert.equal(worker.status, 'stopped');
});

test('persistence failure stops the worker without repeating a provider call or claiming later jobs', async (t) => {
  const { repository, queue, workerFor } = setup(t);
  const first = queue(repository);
  const second = queue(repository);
  let calls = 0;
  let fatal = 0;
  repository.saveEvaluation = () => { throw new Error('Simulated result storage failure.'); };
  const worker = workerFor(repository, { id: 'groq', evaluate: async () => { calls++; return feedback(); } },
    { onFatalError: () => { fatal++; } });
  worker.start();
  await until(() => worker.status === 'failed');
  await delay(20);
  assert.equal(calls, 1);
  assert.equal(fatal, 1);
  assert.equal(repository.getEvaluation(first.evaluation.value.id)?.value.status, 'evaluating');
  assert.equal(repository.getEvaluation(second.evaluation.value.id)?.value.status, 'queued');
});

function client(runtime: Runtime) {
  const request = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(runtime.url + path, { method, signal: AbortSignal.timeout(3_000),
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as { data: T } };
  };
  const submit = async () => {
    const started = await request<AttemptJson>('POST', '/api/attempts', { problemId: 'parking-lot', problemVersion: '1' });
    assert.equal(started.status, 201);
    const saved = await request<AttemptJson>('PATCH', `/api/attempts/${started.body.data.id}/draft`,
      { expectedRevision: started.body.data.revision, patch: sections });
    assert.equal(saved.status, 200);
    const submitted = await request<{ attempt: AttemptJson; evaluation: EvaluationJson }>('POST',
      `/api/attempts/${saved.body.data.id}/submit`, { expectedRevision: saved.body.data.revision });
    assert.equal(submitted.status, 202);
    return submitted.body.data;
  };
  return { request, submit };
}

test('running API processes an HTTP submission in the background and returns saved feedback when polled', async (t) => {
  const { repository, runServer } = setup(t);
  let calls = 0;
  const evaluator = new GroqEvaluator({ apiKey: 'offline-placeholder', fetch: async () => {
    calls++;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(feedback()) } }] });
  } });
  const runtime = await runServer(repository, evaluator);
  const { request, submit } = client(runtime);
  const submitted = await submit();
  await until(async () => (await request<EvaluationJson>('GET', `/api/evaluations/${submitted.evaluation.id}`)).body.data.status === 'completed');
  const result = await request<EvaluationJson>('GET', `/api/evaluations/${submitted.evaluation.id}`);
  assert.deepEqual(result.body.data.feedback, feedback());
  assert.equal(calls, 1);
  await runtime.close();
  assert.equal(runtime.worker.status, 'stopped');
});

test('background provider failure stays failed until an HTTP manual retry succeeds', async (t) => {
  const { repository, runServer } = setup(t);
  let calls = 0;
  const evaluator = new GroqEvaluator({ apiKey: 'offline-placeholder', fetch: async () => {
    calls++;
    return calls === 1 ? new Response('offline rate limit', { status: 429 })
      : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(feedback()) } }] });
  } });
  const runtime = await runServer(repository, evaluator);
  const { request, submit } = client(runtime);
  const submitted = await submit();
  await until(() => repository.getEvaluation(submitted.evaluation.id)?.value.status === 'failed');
  await delay(25);
  assert.equal(calls, 1);
  const retry = await request<EvaluationJson>('POST', `/api/evaluations/${submitted.evaluation.id}/retries`);
  assert.equal(retry.status, 202);
  await until(() => repository.getEvaluation(retry.body.data.id)?.value.status === 'completed');
  assert.equal(calls, 2);
  assert.equal(repository.getEvaluation(submitted.evaluation.id)?.value.failure?.code, 'PROVIDER_RATE_LIMIT');
});

test('a second server on an occupied port does not run recovery against the active server', async (t) => {
  const { repository, open, queue, runServer } = setup(t);
  const submitted = queue(repository);
  let finish!: (value: unknown) => void;
  const runtime = await runServer(repository, { id: 'groq', evaluate: async () => new Promise((resolve) => { finish = resolve; }) });
  await until(() => repository.getEvaluation(submitted.evaluation.value.id)?.value.status === 'evaluating');
  await assert.rejects(startServer({ repository: open(), evaluator: { id: 'groq', evaluate: async () => {
    throw new Error('Second server must not process jobs');
  } }, port: Number(new URL(runtime.url).port), pollIntervalMs: 5 }),
  (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EADDRINUSE');
  assert.equal(repository.getEvaluation(submitted.evaluation.value.id)?.value.status, 'evaluating');
  finish(feedback());
  await until(() => repository.getEvaluation(submitted.evaluation.value.id)?.value.status === 'completed');
});

test('runtime shutdown waits for active cancellation to be saved before closing SQLite', async (t) => {
  const { repository, open, queue, runServer } = setup(t);
  const submitted = queue(repository);
  const runtime = await runServer(repository, { id: 'groq', evaluate: async (_input, signal) => {
    assert.ok(signal);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new EvaluationError('EVALUATION_CANCELLED')), { once: true }));
  } });
  await until(() => repository.getEvaluation(submitted.evaluation.value.id)?.value.status === 'evaluating');
  await runtime.close();
  const reopened = open();
  assert.equal(reopened.getEvaluation(submitted.evaluation.value.id)?.value.failure?.code, 'EVALUATION_CANCELLED');
  await assert.rejects(fetch(runtime.url + '/api/health', { signal: AbortSignal.timeout(1000) }));
});

test('configuration reads a fixture key without changing environment state and respects explicit overrides', (t) => {
  const { directory } = setup(t);
  const envFile = join(directory, 'fixture.env');
  writeFileSync(envFile, 'GEMINI_API_KEY="offline-fixture-key"\nUNRELATED_VALUE=ignored\n');
  const environment = { PORT: '0' };
  const result = loadServerConfig(environment, envFile);
  assert.equal(result.apiKey, 'offline-fixture-key');
  assert.equal(result.port, 0);
  assert.deepEqual(environment, { PORT: '0' });
  assert.equal(loadServerConfig({ GEMINI_API_KEY: 'override-key' }, envFile).apiKey, 'override-key');
  assert.throws(() => loadServerConfig({ GEMINI_API_KEY: '' }, envFile), /Set GEMINI_API_KEY/);
});

test('missing credentials and invalid ports fail startup configuration without exposing fixture contents', (t) => {
  const { directory } = setup(t);
  const missing = join(directory, 'missing.env');
  assert.throws(() => loadServerConfig({}, missing), /Set GEMINI_API_KEY/);
  for (const port of ['', '-1', '65536', '1.5', '3000oops']) {
    assert.throws(() => loadServerConfig({ PORT: port, GEMINI_API_KEY: 'offline-placeholder' }, missing), /PORT must/);
  }
});
