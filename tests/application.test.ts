import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { PracticeService, type PracticeIdKind } from '../src/application/practice-service.ts';
import { StorageError, type StorageErrorCode } from '../src/application/ports/practice-repository.ts';
import { DomainError, type DomainErrorCode } from '../src/domain/errors.ts';
import { Problem } from '../src/domain/problem.ts';
import { DEFAULT_RUBRIC, Rubric } from '../src/domain/rubric.ts';
import { SqlitePracticeRepository } from '../src/infrastructure/sqlite/practice-repository.ts';

const sections = {
  requirements: 'Reject a checkout when no copies are available.',
  responsibilities: 'Catalogue finds titles. LoanService manages loans.',
  interactions: 'LoanService asks Inventory to reserve a copy.',
  edgeCases: 'Test duplicate returns and unavailable copies.',
  tradeOffs: 'Keep the loan policy separate so loan limits can change.',
};

function problem(id = 'library', version = '1', rubricVersion = '1') {
  return new Problem({ id, version, rubricVersion, title: 'Library test fixture',
    description: 'Design book loans.', requirements: ['Reject unavailable book loans.'] });
}

function feedback() {
  return { assessments: DEFAULT_RUBRIC.criteria.map((criterion) => ({
    criterionId: criterion.id, label: 'insufficient_evidence', evidence: [],
    explanation: 'Offline fixture; no model judgement was performed.',
    suggestion: 'Explain the relevant interaction in more detail.',
  })), priorityImprovements: ['Describe how concurrent loan requests are handled.'] };
}

function setup(t: TestContext) {
  const base = resolve(fileURLToPath(new URL('../work/test-databases/', import.meta.url)));
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'application-'));
  const filename = join(directory, 'practice.sqlite');
  const repositories: SqlitePracticeRepository[] = [];
  let tick = Date.UTC(2026, 0, 1);
  let sequence = 0;
  const createId = (kind: PracticeIdKind) => `${kind}-${++sequence}`;
  const open = () => {
    const repository = new SqlitePracticeRepository(filename, () => new Date(tick++).toISOString());
    repositories.push(repository);
    return repository;
  };
  const serviceFor = (repository: SqlitePracticeRepository, learnerId = 'demo-learner', evaluatorId = 'offline-fixture') =>
    new PracticeService(repository, { learnerId, evaluatorId, createId });
  t.after(() => {
    for (const repository of repositories) repository.close();
    const target = resolve(directory);
    if (!target.startsWith(base + sep)) throw new Error('Unsafe test cleanup path.');
    rmSync(target, { recursive: true });
  });
  const repository = open();
  repository.putRubric(DEFAULT_RUBRIC);
  repository.putProblem(problem());
  return { repository, service: serviceFor(repository), serviceFor, open, createId };
}

function submit(service: PracticeService) {
  const started = service.startAttempt('library', '1');
  const saved = service.saveDraft({ attemptId: started.value.id, expectedRevision: started.revision, patch: sections });
  return service.submitAttempt({ attemptId: saved.value.id, expectedRevision: saved.revision });
}

function expectStorage(action: () => unknown, code: StorageErrorCode) {
  assert.throws(action, (error: unknown) => error instanceof StorageError && error.code === code);
}

function expectDomain(action: () => unknown, code: DomainErrorCode) {
  assert.throws(action, (error: unknown) => error instanceof DomainError && error.code === code);
}

test('learner can start, save, submit, view feedback, revise and submit again across database reopen', (t) => {
  const { repository, service, open, serviceFor } = setup(t);
  const first = submit(service);
  assert.equal(first.evaluation.value.status, 'queued');
  const claimed = repository.claimNextEvaluation()!;
  claimed.value.complete(feedback()); // Offline stand-in for the future worker.
  repository.saveEvaluation(claimed.value, claimed.revision);
  repository.close();

  const reopened = open();
  const resumed = serviceFor(reopened);
  assert.deepEqual(resumed.getEvaluation(first.evaluation.value.id).value.feedback, feedback());
  const revision = resumed.reviseAttempt(first.attempt.value.id);
  assert.deepEqual(revision.value.draft, sections);
  assert.equal(revision.value.previousAttemptId, first.attempt.value.id);
  const changed = resumed.saveDraft({ attemptId: revision.value.id, expectedRevision: revision.revision,
    patch: { interactions: 'Inventory reserves a copy atomically before LoanService creates a loan.' } });
  const second = resumed.submitAttempt({ attemptId: changed.value.id, expectedRevision: changed.revision });
  assert.notEqual(second.attempt.value.submission?.id, first.attempt.value.submission?.id);
  const history = resumed.listHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0]!.attempt.value.id, second.attempt.value.id);
  assert.equal(history[1]!.evaluations[0]!.value.status, 'completed');
  assert.equal(history[1]!.attempt.value.submission?.sections.interactions, sections.interactions);
});

test('incomplete submission reports missing sections and leaves a draft with no evaluation', (t) => {
  const { service, repository } = setup(t);
  const started = service.startAttempt('library', '1');
  const saved = service.saveDraft({ attemptId: started.value.id, expectedRevision: 0,
    patch: { requirements: sections.requirements } });
  assert.throws(() => service.submitAttempt({ attemptId: saved.value.id, expectedRevision: saved.revision }),
    (error: unknown) => error instanceof DomainError && error.code === 'INVALID_INPUT'
      && Object.keys(error.issues).length === 4);
  assert.equal(service.getAttempt(saved.value.id).attempt.value.status, 'draft');
  assert.deepEqual(service.getAttempt(saved.value.id).evaluations, []);
  assert.equal(repository.claimNextEvaluation(), null);
});

test('partial saves preserve existing sections and malformed edits do not overwrite saved work', (t) => {
  const { service } = setup(t);
  const started = service.startAttempt('library', '1');
  const saved = service.saveDraft({ attemptId: started.value.id, expectedRevision: 0,
    patch: { requirements: sections.requirements } });
  const next = service.saveDraft({ attemptId: started.value.id, expectedRevision: saved.revision,
    patch: { responsibilities: sections.responsibilities } });
  assert.equal(next.value.draft.requirements, sections.requirements);
  expectDomain(() => service.saveDraft({ attemptId: started.value.id, expectedRevision: next.revision,
    patch: { requirements: 123 } }), 'INVALID_INPUT');
  assert.deepEqual(service.getAttempt(started.value.id).attempt.value.draft, next.value.draft);
  assert.equal(service.getAttempt(started.value.id).attempt.revision, next.revision);
});

test('stale save and submit commands cannot replace a newer draft', (t) => {
  const { service, open, serviceFor } = setup(t);
  const started = service.startAttempt('library', '1');
  const otherTab = serviceFor(open());
  const saved = service.saveDraft({ attemptId: started.value.id, expectedRevision: 0, patch: sections });
  expectStorage(() => otherTab.saveDraft({ attemptId: started.value.id, expectedRevision: 0,
    patch: { requirements: 'An old edit.' } }), 'CONFLICT');
  expectStorage(() => otherTab.submitAttempt({ attemptId: started.value.id, expectedRevision: 0 }), 'CONFLICT');
  assert.deepEqual(service.getAttempt(started.value.id).attempt.value.draft, sections);
  assert.equal(service.getAttempt(started.value.id).attempt.revision, saved.revision);
});

test('invalid revision values are rejected before writing', (t) => {
  const { service } = setup(t);
  const started = service.startAttempt('library', '1');
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expectDomain(() => service.saveDraft({ attemptId: started.value.id, expectedRevision: revision,
      patch: sections }), 'INVALID_INPUT');
    expectDomain(() => service.submitAttempt({ attemptId: started.value.id, expectedRevision: revision }), 'INVALID_INPUT');
  }
  assert.equal(service.getAttempt(started.value.id).attempt.revision, 0);
});

test('duplicate submission is rejected and creates no second evaluation', (t) => {
  const { service } = setup(t);
  const submitted = submit(service);
  expectStorage(() => service.submitAttempt({ attemptId: submitted.attempt.value.id,
    expectedRevision: submitted.attempt.revision - 1 }), 'CONFLICT');
  expectDomain(() => service.submitAttempt({ attemptId: submitted.attempt.value.id,
    expectedRevision: submitted.attempt.revision }), 'INVALID_TRANSITION');
  assert.equal(service.getAttempt(submitted.attempt.value.id).evaluations.length, 1);
});

test('submitted answers cannot be edited through the service', (t) => {
  const { service } = setup(t);
  const submitted = submit(service);
  expectDomain(() => service.saveDraft({ attemptId: submitted.attempt.value.id,
    expectedRevision: submitted.attempt.revision, patch: { requirements: 'Overwrite.' } }), 'INVALID_TRANSITION');
  assert.deepEqual(service.getAttempt(submitted.attempt.value.id).attempt.value.submission?.sections, sections);
});

test('failed evaluation can retry against the saved submission without changing its attempt', (t) => {
  const { service, repository } = setup(t);
  const submitted = submit(service);
  const claimed = repository.claimNextEvaluation()!;
  claimed.value.fail({ code: 'PROVIDER_TIMEOUT', message: 'The offline provider timed out.' });
  repository.saveEvaluation(claimed.value, claimed.revision);
  const retry = service.retryEvaluation(claimed.value.id);
  assert.equal(retry.value.status, 'queued');
  assert.equal(retry.value.previousEvaluationId, claimed.value.id);
  assert.equal(retry.value.submissionId, submitted.attempt.value.submission?.id);
  assert.equal(retry.value.evaluatorId, claimed.value.evaluatorId);
  assert.equal(service.getAttempt(submitted.attempt.value.id).attempt.revision, submitted.attempt.revision);
  assert.equal(service.getEvaluation(claimed.value.id).value.failure?.code, 'PROVIDER_TIMEOUT');
  assert.equal(service.listHistory()[0]!.evaluations.length, 2);
  expectStorage(() => service.retryEvaluation(claimed.value.id), 'CONFLICT');
});

test('only failed evaluations can be retried', (t) => {
  const { service, repository } = setup(t);
  const submitted = submit(service);
  expectDomain(() => service.retryEvaluation(submitted.evaluation.value.id), 'INVALID_TRANSITION');
  const claimed = repository.claimNextEvaluation()!;
  expectDomain(() => service.retryEvaluation(claimed.value.id), 'INVALID_TRANSITION');
  claimed.value.complete(feedback());
  repository.saveEvaluation(claimed.value, claimed.revision);
  expectDomain(() => service.retryEvaluation(claimed.value.id), 'INVALID_TRANSITION');
  assert.equal(service.getAttempt(submitted.attempt.value.id).evaluations.length, 1);
});

test('a failed retry can itself be retried and keeps the full failure chain', (t) => {
  const { service, repository } = setup(t);
  const submitted = submit(service);
  for (let index = 0; index < 2; index++) {
    const claimed = repository.claimNextEvaluation()!;
    claimed.value.fail({ code: 'OFFLINE_FAILURE', message: 'Simulated failure.' });
    repository.saveEvaluation(claimed.value, claimed.revision);
    service.retryEvaluation(claimed.value.id);
  }
  const runs = service.getAttempt(submitted.attempt.value.id).evaluations;
  assert.deepEqual(runs.map((run) => run.value.status), ['failed', 'failed', 'queued']);
  assert.equal(runs[2]!.value.previousEvaluationId, runs[1]!.value.id);
  assert.ok(runs.every((run) => run.value.submissionId === submitted.evaluation.value.submissionId));
});

test('a draft cannot be revised before it has a submission', (t) => {
  const { service } = setup(t);
  const started = service.startAttempt('library', '1');
  expectDomain(() => service.reviseAttempt(started.value.id), 'INVALID_TRANSITION');
  assert.equal(service.listHistory().length, 1);
});

test('revisions and evaluations retain the original problem, rubric and evaluator versions', (t) => {
  const { service, repository, serviceFor } = setup(t);
  const submitted = submit(service);
  repository.putRubric(new Rubric('2', DEFAULT_RUBRIC.criteria));
  repository.putProblem(problem('library', '2', '2'));
  const newConfiguration = serviceFor(repository, 'demo-learner', 'different-evaluator');
  const revised = newConfiguration.reviseAttempt(submitted.attempt.value.id);
  const resubmitted = newConfiguration.submitAttempt({ attemptId: revised.value.id, expectedRevision: revised.revision });
  assert.equal(resubmitted.attempt.value.problem.version, '1');
  assert.equal(resubmitted.evaluation.value.rubricVersion, '1');
  const claimed = repository.claimNextEvaluation()!;
  claimed.value.fail({ code: 'OFFLINE_FAILURE', message: 'Simulated failure.' });
  repository.saveEvaluation(claimed.value, claimed.revision);
  assert.equal(newConfiguration.retryEvaluation(claimed.value.id).value.evaluatorId, 'offline-fixture');
  assert.equal(newConfiguration.startAttempt('library', '2').value.problem.rubricVersion, '2');
});

test('history includes drafts and feedback, filters by problem and isolates the configured learner', (t) => {
  const { service, repository, serviceFor } = setup(t);
  repository.putProblem(problem('other-problem'));
  const submitted = submit(service);
  service.startAttempt('library', '1');
  service.startAttempt('other-problem', '1');
  serviceFor(repository, 'another-learner').startAttempt('library', '1');
  assert.equal(service.listHistory().length, 3);
  assert.equal(service.listHistory('library').length, 2);
  assert.equal(service.listHistory('unknown').length, 0);
  const details = service.getAttempt(submitted.attempt.value.id);
  assert.equal(details.evaluations[0]!.value.id, submitted.evaluation.value.id);
  assert.equal(service.listHistory().filter((entry) => entry.attempt.value.status === 'draft').length, 2);
});

test('another learner cannot read, edit, submit, revise or retry saved records', (t) => {
  const { service, repository, serviceFor } = setup(t);
  const submitted = submit(service);
  const draft = service.startAttempt('library', '1');
  const other = serviceFor(repository, 'another-learner');
  const claimed = repository.claimNextEvaluation()!;
  claimed.value.fail({ code: 'OFFLINE_FAILURE', message: 'Simulated failure.' });
  repository.saveEvaluation(claimed.value, claimed.revision);
  for (const action of [
    () => other.getAttempt(submitted.attempt.value.id),
    () => other.saveDraft({ attemptId: draft.value.id, expectedRevision: draft.revision, patch: sections }),
    () => other.submitAttempt({ attemptId: draft.value.id, expectedRevision: draft.revision }),
    () => other.reviseAttempt(submitted.attempt.value.id),
    () => other.getEvaluation(claimed.value.id),
    () => other.retryEvaluation(claimed.value.id),
  ]) expectStorage(action, 'NOT_FOUND');
  assert.equal(other.listHistory().length, 0);
  assert.equal(service.getAttempt(draft.value.id).attempt.revision, 0);
  assert.equal(service.getAttempt(submitted.attempt.value.id).evaluations.length, 1);
});

test('unknown resources and unknown problem versions report not found without creating work', (t) => {
  const { service } = setup(t);
  for (const action of [
    () => service.startAttempt('missing', '1'),
    () => service.startAttempt('library', 'missing'),
    () => service.getAttempt('missing'),
    () => service.saveDraft({ attemptId: 'missing', expectedRevision: 0, patch: sections }),
    () => service.submitAttempt({ attemptId: 'missing', expectedRevision: 0 }),
    () => service.reviseAttempt('missing'),
    () => service.getEvaluation('missing'),
    () => service.retryEvaluation('missing'),
  ]) expectStorage(action, 'NOT_FOUND');
  assert.equal(service.listHistory().length, 0);
});

test('a failed submission transaction can be retried through the service after reloading saved state', (t) => {
  const { service, repository, createId } = setup(t);
  const original = submit(service);
  const collisionService = new PracticeService(repository, {
    learnerId: 'demo-learner', evaluatorId: 'offline-fixture',
    createId: (kind) => kind === 'evaluation' ? original.evaluation.value.id : createId(kind),
  });
  const started = collisionService.startAttempt('library', '1');
  const saved = collisionService.saveDraft({ attemptId: started.value.id, expectedRevision: 0, patch: sections });
  expectStorage(() => collisionService.submitAttempt({ attemptId: saved.value.id,
    expectedRevision: saved.revision }), 'CONFLICT');
  assert.equal(service.getAttempt(saved.value.id).attempt.value.status, 'draft');
  assert.equal(service.getAttempt(saved.value.id).evaluations.length, 0);
  const retried = service.submitAttempt({ attemptId: saved.value.id, expectedRevision: saved.revision });
  assert.equal(retried.attempt.value.status, 'submitted');
  assert.equal(service.getAttempt(saved.value.id).evaluations.length, 1);
});

test('problem listing preserves explicit versions and accepts an empty catalogue', (t) => {
  const { service, repository, serviceFor } = setup(t);
  repository.putProblem(problem('library', '2'));
  assert.deepEqual(service.listProblems().map((entry) => entry.version), ['1', '2']);
  const empty = new SqlitePracticeRepository(':memory:');
  t.after(() => empty.close());
  assert.deepEqual(serviceFor(empty).listProblems(), []);
});
