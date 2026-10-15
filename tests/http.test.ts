import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { PracticeService } from '../src/application/practice-service.ts';
import { Problem } from '../src/domain/problem.ts';
import { ASSESSMENT_LABELS, DEFAULT_RUBRIC, Rubric } from '../src/domain/rubric.ts';
import { createApp } from '../src/http/app.ts';
import type { attemptResponse, attemptDetailsResponse, evaluationResponse } from '../src/http/representations.ts';
import { SqlitePracticeRepository } from '../src/infrastructure/sqlite/practice-repository.ts';

type AttemptJson = ReturnType<typeof attemptResponse>;
type EvaluationJson = ReturnType<typeof evaluationResponse>;
type AttemptDetailsJson = ReturnType<typeof attemptDetailsResponse>;
type SubmittedJson = { attempt: AttemptJson; evaluation: EvaluationJson };
interface Envelope<T> {
  data: T;
  error: { code: string; message: string; issues: Record<string, string> };
}

const sections = {
  requirements: 'Allow a member to borrow an available book.',
  responsibilities: 'LoanService manages loans. Inventory tracks copies.',
  interactions: 'Reserve a copy before creating the loan.',
  edgeCases: 'Test unavailable copies and duplicate returns.',
  tradeOffs: 'A loan policy interface allows different borrowing limits.',
};

function fixtureProblem(id = 'library', version = '1', rubricVersion = '1') {
  return new Problem({ id, version, rubricVersion, title: 'Library HTTP fixture',
    description: 'Design book lending.', requirements: ['Borrow an available book.'] });
}

function feedback() {
  return { assessments: DEFAULT_RUBRIC.criteria.map((criterion) => ({
    criterionId: criterion.id, label: 'insufficient_evidence', evidence: [],
    explanation: 'Simulated feedback for HTTP integration testing.', suggestion: 'Explain the interaction further.',
  })), priorityImprovements: ['Describe simultaneous borrowing attempts.'] };
}

async function setup(t: TestContext) {
  const repository = new SqlitePracticeRepository(':memory:');
  repository.putRubric(DEFAULT_RUBRIC);
  repository.putProblem(fixtureProblem());
  let sequence = 0;
  const service = new PracticeService(repository, {
    learnerId: 'demo-learner', evaluatorId: 'offline-fixture', createId: (kind) => `${kind}-${++sequence}`,
  });
  const server = createApp(service).listen(0, '127.0.0.1');
  t.after(async () => {
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    } finally { repository.close(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = async <T = unknown>(path: string, init: RequestInit = {}) => {
    const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) });
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    return { response, body: await response.json() as Envelope<T> };
  };
  const send = <T = unknown>(method: string, path: string, body?: unknown) => request<T>(path, {
    method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const start = () => send<AttemptJson>('POST', '/api/attempts', { problemId: 'library', problemVersion: '1' });
  const submit = async () => {
    const started = await start();
    assert.equal(started.response.status, 201);
    const saved = await send<AttemptJson>('PATCH', `/api/attempts/${started.body.data.id}/draft`,
      { expectedRevision: started.body.data.revision, patch: sections });
    assert.equal(saved.response.status, 200);
    const result = await send<SubmittedJson>('POST', `/api/attempts/${saved.body.data.id}/submit`,
      { expectedRevision: saved.body.data.revision });
    assert.equal(result.response.status, 202);
    return result;
  };
  return { repository, service, request, send, start, submit };
}

test('health reports server liveness with JSON and no caching', async (t) => {
  const { request } = await setup(t);
  const result = await request('/api/health');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { data: { status: 'ok' } });
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.response.headers.get('x-powered-by'), null);
});

test('catalogue, versioned problem details and rubric details expose the saved definitions', async (t) => {
  const { request, repository } = await setup(t);
  repository.putRubric(new Rubric('2', DEFAULT_RUBRIC.criteria.map((criterion) => ({
    ...criterion, description: 'Updated rubric fixture.',
  }))));
  repository.putProblem(fixtureProblem('library', '2', '2'));
  const catalogue = await request<Problem[]>('/api/problems');
  assert.equal(catalogue.response.status, 200);
  assert.equal(catalogue.body.data.length, 2);
  const oldProblem = await request<Problem>('/api/problems/library/versions/1');
  assert.deepEqual(oldProblem.body.data, JSON.parse(JSON.stringify(fixtureProblem())));
  const latest = await request<Problem>('/api/problems/library/versions/2');
  assert.equal(latest.body.data.rubricVersion, '2');
  const rubric = await request<{ version: string; criteria: unknown; labels: unknown }>('/api/rubrics/1');
  assert.equal(rubric.response.status, 200);
  assert.deepEqual(rubric.body.data, { version: '1', criteria: DEFAULT_RUBRIC.criteria, labels: ASSESSMENT_LABELS });
  for (const path of ['/api/problems/library/versions/3', '/api/problems/missing/versions/1', '/api/rubrics/3']) {
    const missing = await request(path);
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  }
});

test('HTTP learner flow saves draft fields, queues a submission, polls status and reads history', async (t) => {
  const { request, submit, repository } = await setup(t);
  const submitted = await submit();
  const { attempt, evaluation } = submitted.body.data;
  assert.equal(attempt.status, 'submitted');
  assert.equal(attempt.revision, 2);
  assert.deepEqual(attempt.draft, sections);
  assert.deepEqual(attempt.submission?.sections, sections);
  assert.equal(evaluation.status, 'queued');
  assert.equal(evaluation.feedback, null);
  assert.equal(evaluation.failure, null);
  assert.equal(evaluation.startedAt, null);
  assert.equal(submitted.response.headers.get('location'), `/api/evaluations/${evaluation.id}`);
  const polled = await request<EvaluationJson>(`/api/evaluations/${evaluation.id}`);
  assert.equal(polled.response.status, 200);
  assert.deepEqual(polled.body.data, evaluation);
  const detail = await request<AttemptDetailsJson>(`/api/attempts/${attempt.id}`);
  assert.deepEqual(detail.body.data.evaluations, [evaluation]);
  const history = await request<AttemptDetailsJson[]>('/api/attempts?problemId=library');
  assert.equal(history.body.data[0]!.id, attempt.id);
  assert.equal(repository.getAttempt(attempt.id)?.value.submission?.learnerId, 'demo-learner');
});

test('completed evaluation responses include feedback and lifecycle timestamps', async (t) => {
  const { submit, repository, request } = await setup(t);
  const submitted = await submit();
  const claimed = repository.claimNextEvaluation()!;
  claimed.value.complete(feedback());
  repository.saveEvaluation(claimed.value, claimed.revision);
  const result = await request<EvaluationJson>(`/api/evaluations/${claimed.value.id}`);
  assert.equal(result.body.data.status, 'completed');
  assert.deepEqual(result.body.data.feedback, feedback());
  assert.equal(typeof result.body.data.startedAt, 'string');
  assert.equal(typeof result.body.data.finishedAt, 'string');
  const detail = await request<AttemptDetailsJson>(`/api/attempts/${submitted.body.data.attempt.id}`);
  assert.deepEqual(detail.body.data.evaluations[0]!.feedback, feedback());
});

test('revisions are separate prefilled drafts and editing one preserves the original', async (t) => {
  const { submit, send, request } = await setup(t);
  const original = (await submit()).body.data.attempt;
  const revision = await send<AttemptJson>('POST', `/api/attempts/${original.id}/revisions`);
  assert.equal(revision.response.status, 201);
  assert.equal(revision.response.headers.get('location'), `/api/attempts/${revision.body.data.id}`);
  assert.equal(revision.body.data.previousAttemptId, original.id);
  assert.equal(revision.body.data.status, 'draft');
  assert.equal(revision.body.data.submission, null);
  assert.deepEqual(revision.body.data.draft, sections);
  await send('PATCH', `/api/attempts/${revision.body.data.id}/draft`, {
    expectedRevision: 0, patch: { requirements: 'Changed draft.' },
  });
  const detail = await request<AttemptDetailsJson>(`/api/attempts/${original.id}`);
  assert.deepEqual(detail.body.data.submission?.sections, sections);
});

test('retry queues the original submission, preserves failure details and rejects duplicate retries', async (t) => {
  const { submit, repository, request, send } = await setup(t);
  const submitted = await submit();
  const claimed = repository.claimNextEvaluation()!;
  claimed.value.fail({ code: 'PROVIDER_TIMEOUT', message: 'Simulated timeout.' });
  repository.saveEvaluation(claimed.value, claimed.revision);
  const result = await send<EvaluationJson>('POST', `/api/evaluations/${claimed.value.id}/retries`, {});
  assert.equal(result.response.status, 202);
  assert.equal(result.body.data.previousEvaluationId, claimed.value.id);
  assert.equal(result.body.data.submissionId, submitted.body.data.evaluation.submissionId);
  assert.equal(result.body.data.status, 'queued');
  assert.equal(result.response.headers.get('location'), `/api/evaluations/${result.body.data.id}`);
  const failed = await request<EvaluationJson>(`/api/evaluations/${claimed.value.id}`);
  assert.deepEqual(failed.body.data.failure, { code: 'PROVIDER_TIMEOUT', message: 'Simulated timeout.' });
  const duplicate = await send('POST', `/api/evaluations/${claimed.value.id}/retries`);
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'CONFLICT');
  assert.equal(repository.listEvaluations(claimed.value.submissionId).length, 2);
});

test('missing submission sections return useful field errors without creating queued work', async (t) => {
  const { start, send, repository } = await setup(t);
  const started = await start();
  const result = await send('POST', `/api/attempts/${started.body.data.id}/submit`, { expectedRevision: 0 });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, 'INVALID_INPUT');
  assert.deepEqual(Object.keys(result.body.error.issues).sort(), Object.keys(sections).sort());
  assert.equal(repository.claimNextEvaluation(), null);
  assert.equal(repository.getAttempt(started.body.data.id)?.value.status, 'draft');
});

test('stale saves and repeated submissions return conflicts without overwriting persisted work', async (t) => {
  const { submit, send, repository } = await setup(t);
  const submitted = (await submit()).body.data;
  const id = submitted.attempt.id;
  for (const result of [
    await send('PATCH', `/api/attempts/${id}/draft`, { expectedRevision: 0, patch: { requirements: 'Old edit.' } }),
    await send('POST', `/api/attempts/${id}/submit`, { expectedRevision: 1 }),
  ]) {
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'CONFLICT');
  }
  assert.deepEqual(repository.getAttempt(id)?.value.submission?.sections, sections);
  assert.equal(repository.listEvaluations(submitted.evaluation.submissionId).length, 1);
});

test('invalid lifecycle actions return 409', async (t) => {
  const { start, submit, send } = await setup(t);
  const draft = (await start()).body.data;
  const submitted = (await submit()).body.data;
  const results = [
    await send('POST', `/api/attempts/${draft.id}/revisions`),
    await send('POST', `/api/evaluations/${submitted.evaluation.id}/retries`),
    await send('PATCH', `/api/attempts/${submitted.attempt.id}/draft`,
      { expectedRevision: submitted.attempt.revision, patch: sections }),
  ];
  for (const result of results) {
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, 'INVALID_TRANSITION');
  }
});

test('malformed JSON and non-object bodies return safe JSON errors', async (t) => {
  const { request, repository } = await setup(t);
  for (const body of ['{"secret":"must-not-echo",', 'null', '[]', '42']) {
    const result = await request('/api/attempts', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'INVALID_INPUT');
    assert.ok(!JSON.stringify(result.body).includes('must-not-echo'));
  }
  assert.equal(repository.listAttempts('demo-learner').length, 0);
});

test('wrong field types, missing fields and identity injection are rejected', async (t) => {
  const { send, start, repository } = await setup(t);
  for (const body of [
    {}, { problemId: 'library', problemVersion: 1 },
    { problemId: 'library', problemVersion: '1', learnerId: 'someone-else' },
    { problemId: 'library', problemVersion: '1', evaluatorId: 'someone-else' },
  ]) {
    assert.equal((await send('POST', '/api/attempts', body)).response.status, 400);
  }
  const draft = (await start()).body.data;
  for (const body of [{ expectedRevision: '0', patch: sections }, { expectedRevision: -1, patch: sections },
    { expectedRevision: 0 }, { expectedRevision: 0, patch: { unknownSection: 'invalid' } }]) {
    assert.equal((await send('PATCH', `/api/attempts/${draft.id}/draft`, body)).response.status, 400);
  }
  assert.equal(repository.getAttempt(draft.id)?.revision, 0);
  assert.equal((await send('POST', `/api/attempts/${draft.id}/revisions`, { learnerId: 'other' })).response.status, 400);
});

test('unsupported content types, encodings and oversized payloads get explicit errors', async (t) => {
  const { request, repository } = await setup(t);
  const wrongType = await request('/api/attempts', { method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ problemId: 'library', problemVersion: '1' }) });
  assert.equal(wrongType.response.status, 415);
  const wrongEncoding = await request('/api/attempts', { method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=iso-8859-1' }, body: '{}' });
  assert.equal(wrongEncoding.response.status, 415);
  const tooLarge = await request('/api/attempts', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(110_000) }) });
  assert.equal(tooLarge.response.status, 413);
  assert.equal(tooLarge.body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(repository.listAttempts('demo-learner').length, 0);
});

test('history filters reject ambiguous values and preserve an empty result', async (t) => {
  const { request, start } = await setup(t);
  await start();
  const empty = await request('/api/attempts?problemId=missing');
  assert.deepEqual(empty.body.data, []);
  for (const query of ['problemId=', 'problemId=library&problemId=other', 'learnerId=other', 'problemId[]=library']) {
    assert.equal((await request(`/api/attempts?${query}`)).response.status, 400);
  }
});

test('missing resources, unknown routes and malformed URL parameters return JSON errors', async (t) => {
  const { request, send } = await setup(t);
  for (const path of ['/api/attempts/missing', '/api/evaluations/missing', '/api/unknown']) {
    assert.equal((await request(path)).response.status, 404);
  }
  assert.equal((await send('POST', '/api/attempts', { problemId: 'library', problemVersion: '99' })).response.status, 404);
  const malformed = await request('/api/attempts/%E0%A4%A');
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.body.error.code, 'INVALID_INPUT');
});

test('HTTP reads and commands cannot access another learner records', async (t) => {
  const { repository, request, send } = await setup(t);
  let sequence = 0;
  const other = new PracticeService(repository, { learnerId: 'other', evaluatorId: 'offline-fixture',
    createId: (kind) => `other-${kind}-${++sequence}` });
  const started = other.startAttempt('library', '1');
  const saved = other.saveDraft({ attemptId: started.value.id, expectedRevision: 0, patch: sections });
  const submitted = other.submitAttempt({ attemptId: saved.value.id, expectedRevision: saved.revision });
  assert.deepEqual((await request('/api/attempts')).body.data, []);
  assert.equal((await request(`/api/attempts/${started.value.id}`)).response.status, 404);
  assert.equal((await request(`/api/evaluations/${submitted.evaluation.value.id}`)).response.status, 404);
  assert.equal((await send('POST', `/api/attempts/${started.value.id}/revisions`)).response.status, 404);
  assert.equal((await send('POST', `/api/evaluations/${submitted.evaluation.value.id}/retries`)).response.status, 404);
});

test('unexpected storage failures return a generic 500 while health remains a liveness check', async (t) => {
  const { repository, request } = await setup(t);
  repository.close();
  const failed = await request('/api/problems');
  assert.equal(failed.response.status, 500);
  assert.deepEqual(failed.body, { error: {
    code: 'INTERNAL_ERROR', message: 'The server could not complete this request.', issues: {},
  } });
  assert.equal((await request('/api/health')).response.status, 200);
});

test('oversized drafts can be saved but submission rejects them until shortened', async (t) => {
  const { start, send, repository } = await setup(t);
  const draft = (await start()).body.data;
  const saved = await send<AttemptJson>('PATCH', `/api/attempts/${draft.id}/draft`, {
    expectedRevision: draft.revision, patch: { ...sections, requirements: 'x'.repeat(6001) },
  });
  assert.equal(saved.response.status, 200);
  const rejected = await send('POST', `/api/attempts/${draft.id}/submit`, { expectedRevision: saved.body.data.revision });
  assert.equal(rejected.response.status, 400);
  assert.ok(rejected.body.error.issues.totalLength);
  assert.equal(repository.getAttempt(draft.id)?.value.status, 'draft');
  assert.equal(repository.claimNextEvaluation(), null);
  const shortened = await send<AttemptJson>('PATCH', `/api/attempts/${draft.id}/draft`, {
    expectedRevision: saved.body.data.revision, patch: { requirements: sections.requirements },
  });
  const accepted = await send('POST', `/api/attempts/${draft.id}/submit`, { expectedRevision: shortened.body.data.revision });
  assert.equal(accepted.response.status, 202);
});
