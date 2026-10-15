import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Attempt } from '../src/domain/attempt.ts';
import { SECTION_IDS, validateSubmission } from '../src/domain/design.ts';
import { DomainError, type DomainErrorCode } from '../src/domain/errors.ts';
import { Evaluation } from '../src/domain/evaluation.ts';
import { Problem } from '../src/domain/problem.ts';
import { DEFAULT_RUBRIC, Rubric } from '../src/domain/rubric.ts';
import type { EvaluationContext, Evaluator } from '../src/application/ports/evaluator.ts';

function problem() {
  return new Problem({
    id: 'parking-lot', version: '1', title: 'Parking Lot',
    description: 'Design a small parking lot.',
    requirements: ['Allocate a space or report that the lot is full.'],
    rubricVersion: DEFAULT_RUBRIC.version,
  });
}

function sections() {
  return {
    requirements: 'Allocate a space or report that the lot is full.',
    responsibilities: 'ParkingLot owns spaces. PricingPolicy calculates the parking fee.',
    interactions: 'ParkingLot asks a Space to reserve itself before returning a ticket.',
    edgeCases: 'Test a full lot and duplicate exits with deterministic fixtures.',
    tradeOffs: 'A PricingPolicy interface permits new pricing rules without changing allocation.',
  };
}

function readyAttempt(id = 'attempt-1') {
  const attempt = Attempt.start(id, 'demo-learner', problem());
  attempt.updateDraft(sections());
  return attempt;
}

function submission() { return readyAttempt().submit('submission-1'); }

function feedback() {
  const evidenceSections = [
    'requirements', 'responsibilities', 'interactions', 'tradeOffs', 'edgeCases',
  ] as const;
  const design = sections();
  return {
    assessments: DEFAULT_RUBRIC.criteria.map((criterion, index) => {
      const sectionId = evidenceSections[index]!;
      return {
        criterionId: criterion.id,
        label: 'strong',
        evidence: [{ sectionId, quote: design[sectionId] }],
        explanation: `Fixture explanation for ${criterion.title}.`,
        suggestion: 'Keep the stated responsibility explicit as the design evolves.',
      };
    }),
    priorityImprovements: [] as string[],
  };
}

function evaluation() {
  return Evaluation.queue('evaluation-1', submission(), DEFAULT_RUBRIC, 'offline-fixture');
}

function expectError(action: () => unknown, code: DomainErrorCode) {
  assert.throws(action, (error: unknown) => error instanceof DomainError && error.code === code);
}

test('drafts accept partial answers and preserve other fields on update', () => {
  const attempt = Attempt.start('attempt-1', 'demo-learner', problem());
  attempt.updateDraft({ requirements: 'An initial assumption' });
  attempt.updateDraft({ responsibilities: 'ParkingLot manages spaces' });
  assert.equal(attempt.status, 'draft');
  assert.equal(attempt.draft.requirements, 'An initial assumption');
  assert.equal(attempt.draft.responsibilities, 'ParkingLot manages spaces');
  assert.equal(attempt.draft.interactions, '');
});

for (const section of SECTION_IDS) {
  test(`submission rejects whitespace-only ${section} and preserves the draft`, () => {
    const attempt = readyAttempt();
    attempt.updateDraft({ [section]: ' \n\t ' });
    assert.throws(() => attempt.submit('submission-1'), (error: unknown) => {
      return error instanceof DomainError && error.code === 'INVALID_INPUT'
        && Object.hasOwn(error.issues, section);
    });
    assert.equal(attempt.status, 'draft');
    assert.equal(attempt.submission, null);
  });
}

test('missing sections are reported together', () => {
  assert.throws(() => validateSubmission({}), (error: unknown) => {
    return error instanceof DomainError && Object.keys(error.issues).length === 5;
  });
});

test('validation rejects non-object payloads, wrong field types and unknown sections', () => {
  for (const input of [null, [], 'a design', 42, { responsibilities: 7 }, { unexpected: 'text' }]) {
    expectError(() => validateSubmission(input), 'INVALID_INPUT');
  }
  expectError(() => validateSubmission(JSON.parse('{"__proto__":"unexpected"}')), 'INVALID_INPUT');
});

test('an invalid draft update is atomic', () => {
  const attempt = readyAttempt();
  expectError(() => attempt.updateDraft({ requirements: 'Changed', tradeOffs: null }), 'INVALID_INPUT');
  assert.deepEqual(attempt.draft, sections());
});

test('submission preserves exact text and captures its ownership and versions', () => {
  const attempt = readyAttempt();
  attempt.updateDraft({ requirements: '  Requirements with whitespace.\n' });
  const saved = attempt.submit('submission-1');
  assert.equal(saved.sections.requirements, '  Requirements with whitespace.\n');
  assert.equal(saved.attemptId, attempt.id);
  assert.equal(saved.learnerId, 'demo-learner');
  assert.equal(saved.problemId, 'parking-lot');
  assert.equal(saved.problemVersion, '1');
  assert.equal(saved.rubricVersion, DEFAULT_RUBRIC.version);
  assert.equal(saved.format, 'structured-text');
  assert.equal(saved.formatVersion, 1);
});

test('submitted designs cannot be edited or submitted a second time', () => {
  const attempt = readyAttempt();
  const saved = attempt.submit('submission-1');
  expectError(() => attempt.updateDraft({ requirements: 'Changed' }), 'INVALID_TRANSITION');
  expectError(() => attempt.submit('submission-2'), 'INVALID_TRANSITION');
  assert.equal(Reflect.set(saved.sections, 'requirements', 'Changed'), false);
  assert.equal(Reflect.set(saved, 'learnerId', 'someone-else'), false);
  assert.deepEqual(saved.sections, sections());
});

test('mutating an input object cannot rewrite a draft or submitted snapshot', () => {
  const input = sections();
  const attempt = readyAttempt();
  attempt.updateDraft(input);
  const saved = attempt.submit('submission-1');
  input.requirements = 'Changed externally';
  assert.equal(saved.sections.requirements, sections().requirements);
  assert.equal(attempt.draft.requirements, sections().requirements);
});

test('revision creates an independent prefilled draft linked to the previous attempt', () => {
  const original = readyAttempt();
  const saved = original.submit('submission-1');
  const revision = original.revise('attempt-2');
  assert.equal(revision.status, 'draft');
  assert.equal(revision.submission, null);
  assert.equal(revision.previousAttemptId, original.id);
  assert.equal(revision.learnerId, original.learnerId);
  assert.deepEqual(revision.draft, saved.sections);
  revision.updateDraft({ responsibilities: 'A revised responsibility boundary.' });
  const revisedSubmission = revision.submit('submission-2');
  assert.equal(revisedSubmission.sections.responsibilities, 'A revised responsibility boundary.');
  assert.equal(saved.sections.responsibilities, sections().responsibilities);
});

test('revision requires a submitted attempt and a different ID', () => {
  const attempt = readyAttempt();
  expectError(() => attempt.revise('attempt-2'), 'INVALID_TRANSITION');
  attempt.submit('submission-1');
  expectError(() => attempt.revise(attempt.id), 'INVALID_INPUT');
});

test('evaluation moves from queued through evaluating to completed', () => {
  const run = evaluation();
  assert.equal(run.status, 'queued');
  const initialFeedback = run.feedback;
  assert.equal(initialFeedback, null);
  run.start();
  assert.equal(run.status, 'evaluating');
  run.complete(feedback());
  assert.equal(run.status, 'completed');
  assert.equal(run.feedback?.assessments.length, 5);
  assert.equal(run.failure, null);
});

test('evaluation must start before completing or failing', () => {
  const run = evaluation();
  expectError(() => run.complete(feedback()), 'INVALID_TRANSITION');
  expectError(() => run.fail({ code: 'TIMEOUT', message: 'Evaluation timed out.' }), 'INVALID_TRANSITION');
  assert.equal(run.status, 'queued');
});

test('an evaluation cannot be started twice or retried while active', () => {
  const run = evaluation();
  run.start();
  expectError(() => run.start(), 'INVALID_TRANSITION');
  expectError(() => run.retry('evaluation-2'), 'INVALID_TRANSITION');
});

test('a completed evaluation cannot be overwritten, failed, or retried', () => {
  const run = evaluation();
  run.start();
  run.complete(feedback());
  expectError(() => run.complete(feedback()), 'INVALID_TRANSITION');
  expectError(() => run.fail({ code: 'LATE_ERROR', message: 'Late error.' }), 'INVALID_TRANSITION');
  expectError(() => run.retry('evaluation-2'), 'INVALID_TRANSITION');
});

test('retry preserves the failed run and reuses the same submission and rubric', () => {
  const run = evaluation();
  run.start();
  run.fail({ code: 'PROVIDER_TIMEOUT', message: 'Evaluation timed out. Please retry.' });
  const retry = run.retry('evaluation-2');
  assert.equal(run.status, 'failed');
  assert.equal(run.failure?.code, 'PROVIDER_TIMEOUT');
  assert.equal(retry.status, 'queued');
  assert.equal(retry.submissionId, run.submissionId);
  assert.equal(retry.rubricVersion, run.rubricVersion);
  assert.equal(retry.evaluatorId, run.evaluatorId);
  assert.equal(retry.previousEvaluationId, run.id);
  assert.equal(retry.failure, null);
  retry.start();
  retry.complete(feedback());
  assert.equal(retry.status, 'completed');
  assert.equal(run.status, 'failed');
});

test('a late result cannot complete a failed run after retry', () => {
  const run = evaluation();
  run.start();
  run.fail({ code: 'TIMEOUT', message: 'Evaluation timed out.' });
  const retry = run.retry('evaluation-2');
  expectError(() => run.complete(feedback()), 'INVALID_TRANSITION');
  assert.equal(retry.status, 'queued');
  assert.equal(run.feedback, null);
});

test('retry must use a new evaluation ID', () => {
  const run = evaluation();
  run.start();
  run.fail({ code: 'PROVIDER_ERROR', message: 'The evaluator failed.' });
  expectError(() => run.retry(run.id), 'INVALID_INPUT');
});

test('evaluation rejects the wrong rubric version', () => {
  const laterRubric = new Rubric('2', DEFAULT_RUBRIC.criteria);
  expectError(() => Evaluation.queue('run-1', submission(), laterRubric, 'fixture'), 'VERSION_MISMATCH');
});

test('rubric requires unique criteria and protects its definition from later edits', () => {
  const criteria = DEFAULT_RUBRIC.criteria.map((criterion) => ({ ...criterion }));
  const rubric = new Rubric('custom', criteria);
  criteria[0]!.title = 'Changed externally';
  assert.equal(rubric.criteria[0]?.title, 'Requirements coverage');
  expectError(() => new Rubric('invalid', [criteria[0]!, criteria[0]!]), 'INVALID_INPUT');
});

test('feedback rejects missing, repeated, and unknown criteria', () => {
  const missing = feedback();
  missing.assessments.pop();
  const repeated = feedback();
  repeated.assessments[1]!.criterionId = repeated.assessments[0]!.criterionId;
  const unknown = feedback();
  unknown.assessments[0]!.criterionId = 'unrequested_criterion';
  for (const input of [missing, repeated, unknown]) {
    expectError(() => DEFAULT_RUBRIC.validateFeedback(input, sections()), 'INVALID_FEEDBACK');
  }
});

test('feedback rejects numeric scores and unknown labels', () => {
  for (const label of ['85', 'excellent', 'toString', '__proto__']) {
    const input = feedback();
    input.assessments[0]!.label = label;
    expectError(() => DEFAULT_RUBRIC.validateFeedback(input, sections()), 'INVALID_FEEDBACK');
  }
});

test('feedback rejects fabricated quotations and quotations assigned to the wrong section', () => {
  const fabricated = feedback();
  fabricated.assessments[0]!.evidence[0]!.quote = 'A class that was never submitted.';
  const misplaced = feedback();
  misplaced.assessments[0]!.evidence[0]!.sectionId = 'tradeOffs';
  for (const input of [fabricated, misplaced]) {
    expectError(() => DEFAULT_RUBRIC.validateFeedback(input, sections()), 'INVALID_FEEDBACK');
  }
});

test('a strong or needs-improvement judgement requires evidence', () => {
  for (const label of ['strong', 'needs_improvement']) {
    const input = feedback();
    input.assessments[0]!.label = label;
    input.assessments[0]!.evidence = [];
    expectError(() => DEFAULT_RUBRIC.validateFeedback(input, sections()), 'INVALID_FEEDBACK');
  }
});

test('insufficient evidence can explain missing detail without inventing a quotation', () => {
  const input = feedback();
  input.assessments[0]!.label = 'insufficient_evidence';
  input.assessments[0]!.evidence = [];
  input.assessments[0]!.explanation = 'The submission does not explain how the allocation rule is enforced.';
  input.assessments[0]!.suggestion = 'Describe the allocation decision and its owner.';
  const validated = DEFAULT_RUBRIC.validateFeedback(input, sections());
  assert.equal(validated.assessments[0]?.label, 'insufficient_evidence');
});

test('feedback requires explanations and suggestions and allows at most three priorities', () => {
  const noExplanation = feedback();
  noExplanation.assessments[0]!.explanation = '  ';
  const noSuggestion = feedback();
  noSuggestion.assessments[0]!.suggestion = '';
  const tooManyPriorities = feedback();
  tooManyPriorities.priorityImprovements = ['One', 'Two', 'Three', 'Four'];
  for (const input of [noExplanation, noSuggestion, tooManyPriorities, null, {}]) {
    expectError(() => DEFAULT_RUBRIC.validateFeedback(input, sections()), 'INVALID_FEEDBACK');
  }
});

test('malformed feedback cannot mark an evaluation successful', () => {
  const run = evaluation();
  run.start();
  expectError(() => run.complete({ assessments: [] }), 'INVALID_FEEDBACK');
  assert.equal(run.status, 'evaluating');
  assert.equal(run.feedback, null);
  run.fail({ code: 'INVALID_FEEDBACK', message: 'The evaluator returned invalid feedback.' });
  assert.equal(run.status, 'failed');
});

test('accepted feedback is independent of the provider object and deeply immutable', () => {
  const input = feedback();
  const run = evaluation();
  run.start();
  run.complete(input);
  input.assessments[0]!.explanation = 'Changed after acceptance';
  input.assessments[0]!.evidence[0]!.quote = 'Changed quotation';
  assert.notEqual(run.feedback?.assessments[0]?.explanation, 'Changed after acceptance');
  assert.equal(run.feedback?.assessments[0]?.evidence[0]?.quote, sections().requirements);
  assert.equal(Reflect.set(run.feedback!.assessments[0]!, 'label', 'needs_improvement'), false);
  assert.equal(Reflect.set(run.feedback!.assessments[0]!.evidence[0]!, 'quote', 'Changed'), false);
});

test('problem requirements are immutable and cannot be empty', () => {
  const requirements = ['A requirement'];
  const original = problem();
  const definition = { ...original, requirements };
  const copy = new Problem(definition);
  requirements[0] = 'Changed externally';
  assert.deepEqual(copy.requirements, ['A requirement']);
  expectError(() => new Problem({ ...definition, requirements: [] }), 'INVALID_INPUT');
});

test('the practice domain works with an offline evaluator and preserves revision history', async () => {
  class FixtureEvaluator implements Evaluator {
    readonly id = 'offline-fixture';
    async evaluate(context: EvaluationContext): Promise<unknown> {
      assert.equal(context.problem.id, context.submission.problemId);
      return feedback();
    }
  }
  const provider: Evaluator = new FixtureEvaluator();
  const attempt = readyAttempt();
  const saved = attempt.submit('submission-1');
  const run = Evaluation.queue('run-1', saved, DEFAULT_RUBRIC, provider.id);
  run.start();
  run.complete(await provider.evaluate({ problem: attempt.problem, submission: saved, rubric: DEFAULT_RUBRIC }));
  const revision = attempt.revise('attempt-2');
  revision.updateDraft({ tradeOffs: 'Explain a different pricing policy boundary.' });
  assert.equal(run.status, 'completed');
  assert.deepEqual(saved.sections, sections());
  assert.equal(revision.previousAttemptId, attempt.id);
  assert.notEqual(revision.draft.tradeOffs, saved.sections.tradeOffs);
});
