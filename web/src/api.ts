import type {
  attemptDetailsResponse,
  attemptResponse,
  evaluationResponse,
} from '../../src/http/representations.ts';
import type { Problem } from '../../src/domain/problem.ts';
import type { Criterion } from '../../src/domain/rubric.ts';
import type { DesignSections } from '../../src/domain/design.ts';

export type ProblemData = Problem;
export type AttemptData = ReturnType<typeof attemptResponse>;
export type AttemptDetails = ReturnType<typeof attemptDetailsResponse>;
export type EvaluationData = ReturnType<typeof evaluationResponse>;
export interface RubricData {
  version: string;
  criteria: readonly Criterion[];
  labels: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: Readonly<Record<string, string>>;
  constructor(status: number, code: string, message: string, issues: Readonly<Record<string, string>> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Your text stays on this page. Check the saved status before submitting again.',
    );
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an unreadable response. Try loading the saved status again.',
    );
  }
  if (!response.ok) {
    const details = result as {
      error?: { code?: string; message?: string; issues?: Record<string, string> };
    } | null;
    throw new ApiError(
      response.status,
      details?.error?.code ?? 'REQUEST_FAILED',
      details?.error?.message ?? 'The request could not be completed.',
      details?.error?.issues ?? {},
    );
  }
  if (result === null || typeof result !== 'object' || !('data' in result)) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The response did not contain the requested information.',
    );
  }
  return result.data as T;
}

const id = encodeURIComponent;
export const api = {
  problems: (signal?: AbortSignal) => request<ProblemData[]>('/problems', 'GET', undefined, signal),
  attempt: (attemptId: string, signal?: AbortSignal) =>
    request<AttemptDetails>(`/attempts/${id(attemptId)}`, 'GET', undefined, signal),
  rubric: (version: string, signal?: AbortSignal) =>
    request<RubricData>(`/rubrics/${id(version)}`, 'GET', undefined, signal),
  start: (problem: ProblemData) =>
    request<AttemptData>('/attempts', 'POST', { problemId: problem.id, problemVersion: problem.version }),
  save: (attemptId: string, expectedRevision: number, patch: DesignSections) =>
    request<AttemptData>(`/attempts/${id(attemptId)}/draft`, 'PATCH', { expectedRevision, patch }),
  submit: (attemptId: string, expectedRevision: number) =>
    request<{ attempt: AttemptData; evaluation: EvaluationData }>(
      `/attempts/${id(attemptId)}/submit`,
      'POST',
      { expectedRevision },
    ),
  revise: (attemptId: string) => request<AttemptData>(`/attempts/${id(attemptId)}/revisions`, 'POST'),
  retry: (evaluationId: string) =>
    request<EvaluationData>(`/evaluations/${id(evaluationId)}/retries`, 'POST'),
  evaluation: (evaluationId: string, signal?: AbortSignal) =>
    request<EvaluationData>(`/evaluations/${id(evaluationId)}`, 'GET', undefined, signal),
  history: (problemId?: string, signal?: AbortSignal) =>
    request<AttemptDetails[]>(
      '/attempts' + (problemId ? `?problemId=${id(problemId)}` : ''),
      'GET',
      undefined,
      signal,
    ),
};
