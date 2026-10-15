import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { Attempt } from '../src/domain/attempt.ts';
import { Evaluation } from '../src/domain/evaluation.ts';
import { Problem } from '../src/domain/problem.ts';
import { DEFAULT_RUBRIC, Rubric } from '../src/domain/rubric.ts';
import { StorageError, type StorageErrorCode } from '../src/application/ports/practice-repository.ts';
import { SqlitePracticeRepository } from '../src/infrastructure/sqlite/practice-repository.ts';

function problem() {
  return new Problem({ id: 'parking-lot', version: '1', title: 'Parking Lot test fixture',
    description: 'Design parking allocation.', requirements: ['Allocate a space or report a full lot.'],
    rubricVersion: DEFAULT_RUBRIC.version });
}

function sections() {
  return {
    requirements: 'Allocate a space or report a full lot.',
    responsibilities: 'ParkingLot manages spaces. PricingPolicy owns fee calculation.',
    interactions: 'Reserve a space before issuing a ticket.',
    edgeCases: 'Test full capacity and duplicate exits.',
    tradeOffs: 'A pricing interface lets rates change independently of allocation.',
  };
}

function feedback() {
  const names = ['requirements', 'responsibilities', 'interactions', 'tradeOffs', 'edgeCases'] as const;
  return { assessments: DEFAULT_RUBRIC.criteria.map((criterion, index) => {
    const sectionId = names[index]!;
    return { criterionId: criterion.id, label: 'strong',
      evidence: [{ sectionId, quote: sections()[sectionId] }],
      explanation: `Offline fixture for ${criterion.title}.`, suggestion: 'Keep this responsibility explicit.' };
  }), priorityImprovements: [] };
}

function setup(t: TestContext) {
  const base = resolve(fileURLToPath(new URL('../work/test-databases/', import.meta.url)));
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'storage-'));
  const filename = join(directory, 'practice.sqlite');
  const repositories: SqlitePracticeRepository[] = [];
  const inspections: DatabaseSync[] = [];
  let tick = Date.UTC(2026, 0, 1);
  const open = () => {
    const repository = new SqlitePracticeRepository(filename, () => new Date(tick++).toISOString());
    repositories.push(repository);
    return repository;
  };
  const inspect = () => {
    const db = new DatabaseSync(filename);
    db.exec('PRAGMA foreign_keys = ON;');
    inspections.push(db);
    return db;
  };
  t.after(() => {
    for (const repository of repositories) repository.close();
    for (const db of inspections) db.close();
    // Only this test's freshly created directory may be removed.
    const target = resolve(directory);
    if (!target.startsWith(base + sep)) throw new Error('Unsafe test cleanup path.');
    rmSync(target, { recursive: true });
  });
  const repository = open();
  repository.putRubric(DEFAULT_RUBRIC);
  repository.putProblem(problem());
  return { repository, open, inspect, filename };
}

function submitted(repository: SqlitePracticeRepository, suffix = '1', learnerId = 'demo-learner') {
  const attempt = Attempt.start(`attempt-${suffix}`, learnerId, problem());
  attempt.updateDraft(sections());
  const draft = repository.insertAttempt(attempt);
  const submission = attempt.submit(`submission-${suffix}`);
  const evaluation = Evaluation.queue(`evaluation-${suffix}`, submission, DEFAULT_RUBRIC, 'offline-fixture');
  return repository.submit(attempt, evaluation, draft.revision);
}

function expectStorageError(action: () => unknown, code: StorageErrorCode) {
  assert.throws(action, (error: unknown) => error instanceof StorageError && error.code === code);
}

test('initialization creates exactly the five approved tables and is safe to reopen', (t) => {
  const { repository, open, inspect } = setup(t);
  const tables = inspect().prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  assert.deepEqual(tables.map((row) => row.name), ['attempts', 'evaluations', 'problems', 'rubrics', 'submissions']);
  repository.close();
  const reopened = open();
  assert.equal(reopened.getRubric('1')?.criteria.length, 5);
  assert.equal(reopened.listProblems().length, 1);
});

test('rubric and problem definitions are idempotent but changing a saved version is rejected', (t) => {
  const { repository } = setup(t);
  repository.putRubric(DEFAULT_RUBRIC);
  repository.putProblem(problem());
  const changedCriteria = DEFAULT_RUBRIC.criteria.map((criterion) => ({ ...criterion }));
  changedCriteria[0]!.description = 'A different criterion.';
  expectStorageError(() => repository.putRubric(new Rubric('1', changedCriteria)), 'CONFLICT');
  expectStorageError(() => repository.putProblem(new Problem({ ...problem(), title: 'Changed title' })), 'CONFLICT');
  assert.equal(repository.getProblem('parking-lot', '1')?.title, problem().title);
});

test('saved attempts retain their original problem and rubric versions', (t) => {
  const { repository, open } = setup(t);
  submitted(repository);
  const nextRubric = new Rubric('2', DEFAULT_RUBRIC.criteria);
  repository.putRubric(nextRubric);
  repository.putProblem(new Problem({ ...problem(), version: '2', rubricVersion: '2', title: 'New requirements' }));
  repository.close();
  const reopened = open();
  const original = reopened.getAttempt('attempt-1')!;
  assert.equal(original.value.problem.version, '1');
  assert.equal(original.value.problem.title, problem().title);
  assert.equal(original.value.submission?.rubricVersion, '1');
  assert.equal(reopened.getProblem('parking-lot', '2')?.rubricVersion, '2');
});

test('draft text, ownership, revision numbers and timestamps survive reopening', (t) => {
  const { repository, open } = setup(t);
  const attempt = Attempt.start('draft-1', 'demo-learner', problem());
  attempt.updateDraft({ requirements: 'Draft with an apostrophe: learner\'s idea.\nSecond line.' });
  const first = repository.insertAttempt(attempt);
  attempt.updateDraft({ responsibilities: 'ParkingLot owns spaces.' });
  const saved = repository.saveDraft(attempt, first.revision);
  repository.close();
  const restored = open().getAttempt(attempt.id)!;
  assert.equal(restored.value.status, 'draft');
  assert.deepEqual(restored.value.draft, attempt.draft);
  assert.equal(restored.value.learnerId, 'demo-learner');
  assert.equal(restored.revision, 1);
  assert.equal(restored.createdAt, first.createdAt);
  assert.equal(restored.updatedAt, saved.updatedAt);
  assert.ok(restored.updatedAt > restored.createdAt);
});

test('submission and queued evaluation are saved together and remain linked after reopen', (t) => {
  const { repository, open, inspect } = setup(t);
  const result = submitted(repository);
  assert.equal(result.attempt.value.status, 'submitted');
  assert.equal(result.evaluation.value.status, 'queued');
  assert.equal(result.attempt.updatedAt, result.evaluation.createdAt);
  repository.close();
  const reopened = open();
  const saved = reopened.getSubmission('submission-1')!;
  assert.deepEqual(saved.sections, sections());
  assert.equal(reopened.getAttempt(saved.attemptId)?.value.submission?.id, saved.id);
  assert.equal(reopened.getEvaluation('evaluation-1')?.value.submissionId, saved.id);
  assert.equal(inspect().prepare("SELECT json_extract(sections_json, '$.requirements') AS answer FROM submissions").get()!.answer,
    sections().requirements);
});

test('an evaluation insert failure rolls back both submission insertion and attempt status', (t) => {
  const { repository } = setup(t);
  submitted(repository);
  const attempt = Attempt.start('attempt-2', 'demo-learner', problem());
  attempt.updateDraft(sections());
  const draft = repository.insertAttempt(attempt);
  const submission = attempt.submit('submission-2');
  // Force a genuine SQL failure after the transaction has updated the attempt and inserted its submission.
  const duplicateId = Evaluation.queue('evaluation-1', submission, DEFAULT_RUBRIC, 'offline-fixture');
  expectStorageError(() => repository.submit(attempt, duplicateId, draft.revision), 'CONFLICT');
  assert.equal(repository.getSubmission('submission-2'), null);
  assert.equal(repository.getAttempt('attempt-2')?.value.status, 'draft');
  assert.equal(repository.getAttempt('attempt-2')?.revision, draft.revision);
  assert.equal(repository.listEvaluations('submission-2').length, 0);
  assert.equal(repository.getEvaluation('evaluation-1')?.value.submissionId, 'submission-1');
});

test('missing related records are rejected', (t) => {
  const { repository } = setup(t);
  expectStorageError(() => repository.putProblem(new Problem({ ...problem(), version: '2', rubricVersion: 'missing' })), 'INTEGRITY');
  expectStorageError(() => repository.insertAttempt(Attempt.start('draft', 'demo', new Problem({ ...problem(), id: 'missing' }))), 'NOT_FOUND');
  assert.equal(repository.getProblem('parking-lot', '2'), null);
});

test('two connections cannot silently overwrite each other\'s draft changes', (t) => {
  const { repository, open } = setup(t);
  repository.insertAttempt(Attempt.start('draft', 'demo-learner', problem()));
  const other = open();
  const first = repository.getAttempt('draft')!;
  const stale = other.getAttempt('draft')!;
  first.value.updateDraft({ requirements: 'Newer answer' });
  repository.saveDraft(first.value, first.revision);
  stale.value.updateDraft({ requirements: 'Stale answer' });
  expectStorageError(() => other.saveDraft(stale.value, stale.revision), 'CONFLICT');
  assert.equal(other.getAttempt('draft')?.value.draft.requirements, 'Newer answer');
});

test('a stale submission cannot replace a more recently saved draft', (t) => {
  const { repository } = setup(t);
  const attempt = Attempt.start('draft', 'demo-learner', problem());
  attempt.updateDraft(sections());
  const initial = repository.insertAttempt(attempt);
  const fresh = repository.getAttempt('draft')!;
  fresh.value.updateDraft({ tradeOffs: 'A newer trade-off.' });
  repository.saveDraft(fresh.value, fresh.revision);
  const saved = attempt.submit('stale-submission');
  const run = Evaluation.queue('stale-run', saved, DEFAULT_RUBRIC, 'fixture');
  expectStorageError(() => repository.submit(attempt, run, initial.revision), 'CONFLICT');
  assert.equal(repository.getSubmission(saved.id), null);
  assert.equal(repository.getAttempt('draft')?.value.draft.tradeOffs, 'A newer trade-off.');
});

test('an already submitted attempt cannot produce another submission', (t) => {
  const { repository } = setup(t);
  const result = submitted(repository);
  expectStorageError(() => repository.submit(result.attempt.value, result.evaluation.value, result.attempt.revision), 'CONFLICT');
  assert.equal(repository.listEvaluations('submission-1').length, 1);
});

test('queue claims are exclusive across connections', (t) => {
  const { repository, open } = setup(t);
  submitted(repository);
  const second = open();
  const claim = repository.claimNextEvaluation()!;
  assert.equal(claim.value.status, 'evaluating');
  assert.equal(claim.revision, 1);
  assert.ok(claim.startedAt);
  assert.equal(second.claimNextEvaluation(), null);
  assert.equal(second.getEvaluation(claim.value.id)?.value.status, 'evaluating');
});

test('queue claims select the oldest pending work', (t) => {
  const { repository } = setup(t);
  submitted(repository, 'older');
  submitted(repository, 'newer');
  assert.equal(repository.claimNextEvaluation()?.value.id, 'evaluation-older');
  assert.equal(repository.claimNextEvaluation()?.value.id, 'evaluation-newer');
  assert.equal(repository.claimNextEvaluation(), null);
});

test('completed feedback survives reopening and remains immutable', (t) => {
  const { repository, open } = setup(t);
  submitted(repository);
  const claim = repository.claimNextEvaluation()!;
  claim.value.complete(feedback());
  const completed = repository.saveEvaluation(claim.value, claim.revision);
  repository.close();
  const restored = open().getEvaluation(claim.value.id)!;
  assert.equal(restored.value.status, 'completed');
  assert.deepEqual(restored.value.feedback, completed.value.feedback);
  assert.equal(restored.startedAt, claim.startedAt);
  assert.ok(restored.finishedAt! >= restored.startedAt!);
  assert.equal(Reflect.set(restored.value.feedback!.assessments[0]!, 'label', 'needs_improvement'), false);
});

test('an unfinished evaluation remains identifiable after a restart', (t) => {
  const { repository, open } = setup(t);
  submitted(repository);
  const claim = repository.claimNextEvaluation()!;
  repository.close();
  const reopened = open();
  assert.equal(reopened.getEvaluation(claim.value.id)?.value.status, 'evaluating');
  assert.equal(reopened.claimNextEvaluation(), null);
  assert.ok(reopened.getEvaluation(claim.value.id)?.startedAt);
});

test('failure and retry history survive reopening without creating another submission', (t) => {
  const { repository, open, inspect } = setup(t);
  submitted(repository);
  const claim = repository.claimNextEvaluation()!;
  claim.value.fail({ code: 'TIMEOUT', message: 'The evaluator timed out.' });
  const failed = repository.saveEvaluation(claim.value, claim.revision);
  const retry = repository.insertRetry(failed.value.retry('evaluation-retry'));
  repository.close();
  const reopened = open();
  const history = reopened.listEvaluations('submission-1');
  assert.equal(history.length, 2);
  assert.equal(history[0]!.value.status, 'failed');
  assert.equal(history[0]!.value.failure?.code, 'TIMEOUT');
  assert.equal(history[1]!.value.previousEvaluationId, failed.value.id);
  assert.equal(history[1]!.value.status, 'queued');
  assert.equal(history[1]!.value.submissionId, retry.value.submissionId);
  assert.equal(inspect().prepare('SELECT count(*) AS total FROM submissions').get()!.total, 1);
});

test('a failed run cannot spawn duplicate retries', (t) => {
  const { repository, open } = setup(t);
  submitted(repository);
  const claim = repository.claimNextEvaluation()!;
  claim.value.fail({ code: 'FAILURE', message: 'Evaluation failed.' });
  const failed = repository.saveEvaluation(claim.value, claim.revision);
  repository.insertRetry(failed.value.retry('retry-1'));
  expectStorageError(() => open().insertRetry(failed.value.retry('retry-2')), 'CONFLICT');
  assert.equal(repository.listEvaluations('submission-1').length, 2);
});

test('late worker results cannot overwrite a persisted failure or its retry', (t) => {
  const { repository, open } = setup(t);
  submitted(repository);
  const staleWorker = repository.claimNextEvaluation()!;
  const other = open();
  const current = other.getEvaluation(staleWorker.value.id)!;
  current.value.fail({ code: 'TIMEOUT', message: 'Evaluation timed out.' });
  const failed = other.saveEvaluation(current.value, current.revision);
  other.insertRetry(failed.value.retry('retry-1'));
  staleWorker.value.complete(feedback());
  expectStorageError(() => repository.saveEvaluation(staleWorker.value, staleWorker.revision), 'CONFLICT');
  assert.equal(repository.getEvaluation(staleWorker.value.id)?.value.status, 'failed');
  assert.equal(repository.getEvaluation('retry-1')?.value.status, 'queued');
});

test('revision drafts retain the original answers and their history link after reopen', (t) => {
  const { repository, open } = setup(t);
  const original = submitted(repository);
  const revision = original.attempt.value.revise('revision-1');
  const saved = repository.insertAttempt(revision);
  revision.updateDraft({ responsibilities: 'Revised class boundaries.' });
  repository.saveDraft(revision, saved.revision);
  repository.close();
  const reopened = open();
  assert.equal(reopened.getAttempt('revision-1')?.value.previousAttemptId, 'attempt-1');
  assert.equal(reopened.getAttempt('revision-1')?.value.status, 'draft');
  assert.equal(reopened.getSubmission('submission-1')?.sections.responsibilities, sections().responsibilities);
  assert.deepEqual(reopened.listAttempts('demo-learner').map((entry) => entry.value.id), ['revision-1', 'attempt-1']);
});

test('history filters by learner and optionally by problem', (t) => {
  const { repository } = setup(t);
  submitted(repository, 'one', 'demo-learner');
  submitted(repository, 'two', 'other-learner');
  assert.equal(repository.listAttempts('demo-learner').length, 1);
  assert.equal(repository.listAttempts('demo-learner', 'parking-lot').length, 1);
  assert.equal(repository.listAttempts('demo-learner', 'missing').length, 0);
  assert.equal(repository.listAttempts('missing').length, 0);
});

test('a revision cannot link to another learner\'s attempt', (t) => {
  const { repository } = setup(t);
  submitted(repository);
  const invalid = Attempt.restore({ id: 'bad-revision', learnerId: 'other-learner', problem: problem(),
    sections: sections(), previousAttemptId: 'attempt-1', submission: null });
  expectStorageError(() => repository.insertAttempt(invalid), 'INTEGRITY');
  assert.equal(repository.getAttempt(invalid.id), null);
});

test('draft updates cannot transfer ownership by reusing an existing ID', (t) => {
  const { repository } = setup(t);
  const original = repository.insertAttempt(Attempt.start('draft', 'demo-learner', problem()));
  const replacement = Attempt.start('draft', 'other-learner', problem());
  expectStorageError(() => repository.saveDraft(replacement, original.revision), 'INTEGRITY');
  assert.equal(repository.getAttempt('draft')?.value.learnerId, 'demo-learner');
});

test('SQL constraints protect immutable history even when repository methods are bypassed', (t) => {
  const { repository, inspect } = setup(t);
  submitted(repository);
  const db = inspect();
  assert.throws(() => db.prepare('UPDATE submissions SET sections_json = ? WHERE id = ?').run('{}', 'submission-1'));
  assert.throws(() => db.prepare('UPDATE problems SET title = ?').run('Rewritten problem'));
  assert.throws(() => db.prepare('UPDATE rubrics SET criteria_json = ?').run('[]'));
  assert.throws(() => db.prepare('UPDATE attempts SET draft_json = ?, revision = revision + 1 WHERE id = ?').run('{}', 'attempt-1'));
  assert.equal(repository.getSubmission('submission-1')?.sections.requirements, sections().requirements);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('a future schema version is rejected without rewriting the database', (t) => {
  const { repository, inspect, filename } = setup(t);
  repository.close();
  const db = inspect();
  db.exec('PRAGMA user_version = 999;');
  expectStorageError(() => new SqlitePracticeRepository(filename), 'SCHEMA_VERSION');
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 999);
  assert.equal(db.prepare('SELECT count(*) AS total FROM rubrics').get()!.total, 1);
});
