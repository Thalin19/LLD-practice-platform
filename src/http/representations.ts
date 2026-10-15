import type { Attempt } from '../domain/attempt.ts';
import type { Stored, StoredEvaluation } from '../application/ports/practice-repository.ts';
import type { AttemptDetails } from '../application/practice-service.ts';

// Domain getters and private lifecycle fields must be deliberately included in JSON.
export function attemptResponse(saved: Stored<Attempt>) {
  const attempt = saved.value;
  return {
    id: attempt.id,
    problem: attempt.problem,
    status: attempt.status,
    draft: attempt.draft,
    submission: attempt.submission,
    previousAttemptId: attempt.previousAttemptId,
    revision: saved.revision,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
}

export function evaluationResponse(saved: StoredEvaluation) {
  const evaluation = saved.value;
  return {
    id: evaluation.id,
    submissionId: evaluation.submissionId,
    rubricVersion: evaluation.rubricVersion,
    evaluatorId: evaluation.evaluatorId,
    status: evaluation.status,
    feedback: evaluation.feedback,
    failure: evaluation.failure,
    previousEvaluationId: evaluation.previousEvaluationId,
    revision: saved.revision,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    startedAt: saved.startedAt,
    finishedAt: saved.finishedAt,
  };
}

export function attemptDetailsResponse(details: AttemptDetails) {
  return { ...attemptResponse(details.attempt), evaluations: details.evaluations.map(evaluationResponse) };
}
