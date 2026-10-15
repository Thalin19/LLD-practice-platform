import { useEffect, useState } from 'react';
import { api, type AttemptDetails, type ProblemData } from './api.ts';
import type { Navigate } from './App.tsx';
import { Arrow, attemptStatus, dateText, ErrorNotice, Loading, StatusBadge } from './components.tsx';

export function History({ navigate }: { navigate: Navigate }) {
  const [attempts, setAttempts] = useState<AttemptDetails[] | null>(null);
  const [problems, setProblems] = useState<ProblemData[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api
      .problems(controller.signal)
      .then(setProblems)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setAttempts(null);
    api
      .history(filter || undefined, controller.signal)
      .then(setAttempts)
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [filter, refresh]);
  const distinct = problems.filter(
    (problem, index) => problems.findIndex((candidate) => candidate.id === problem.id) === index,
  );
  return (
    <>
      <section className="history-heading">
        <div className="eyebrow">YOUR PRACTICE, OVER TIME</div>
        <h1>
          Every attempt is a step forward<span>.</span>
        </h1>
        <p>Pick up a draft or revisit the decisions behind a submitted design.</p>
      </section>
      <div className="history-toolbar">
        <h2>Your attempts {attempts && <span>{attempts.length}</span>}</h2>
        <div>
          <label htmlFor="history-filter" className="sr-only">
            Filter by problem
          </label>
          <select id="history-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">All problems</option>
            {distinct.map((problem) => (
              <option key={problem.id} value={problem.id}>
                {problem.title}
              </option>
            ))}
          </select>
          <button className="button secondary small" onClick={() => setRefresh((value) => value + 1)}>
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <ErrorNotice
          action={
            <button className="text-button" onClick={() => setRefresh((value) => value + 1)}>
              Try loading again
            </button>
          }
        >
          {error}
        </ErrorNotice>
      )}
      {!attempts && !error ? (
        <Loading text="Loading your practice history…" />
      ) : attempts?.length === 0 ? (
        <div className="empty-state">
          <span className="empty-mark" aria-hidden="true">
            ↗
          </span>
          <h2>{filter ? 'No attempts for this problem yet' : 'Your first attempt starts here'}</h2>
          <p>Choose a problem, save your ideas, and build a practice history you can return to.</p>
          <button className="button primary" onClick={() => navigate('/problems')}>
            Explore problems <Arrow />
          </button>
        </div>
      ) : (
        <div className="history-list">
          {attempts?.map((attempt) => (
            <article className="history-row" key={attempt.id}>
              <div className="history-symbol" aria-hidden="true">
                {attempt.status === 'draft' ? '↗' : '✓'}
              </div>
              <div className="history-main">
                <h3>{attempt.problem.title}</h3>
                <p>
                  {dateText(attempt.createdAt)} <span>·</span>{' '}
                  {attempt.previousAttemptId ? 'Revision' : 'Original attempt'} <span>·</span>{' '}
                  {attempt.evaluations.length} evaluation{attempt.evaluations.length === 1 ? '' : 's'}
                </p>
              </div>
              <StatusBadge status={attemptStatus(attempt)} />
              <button
                className="button secondary small"
                onClick={() => navigate(`/practice/${encodeURIComponent(attempt.id)}`)}
              >
                {attempt.status === 'draft' ? 'Resume draft' : 'Review attempt'} <Arrow />
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
