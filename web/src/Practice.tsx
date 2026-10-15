import { useEffect, useState } from 'react';
import {
  emptyDesign,
  MAX_SUBMISSION_CHARACTERS,
  SECTION_IDS,
  SECTION_NAMES,
  submissionCharacterCount,
  validateSubmission,
  type DesignSections,
  type SectionId,
} from '../../src/domain/design.ts';
import { DomainError } from '../../src/domain/errors.ts';
import { ASSESSMENT_LABELS } from '../../src/domain/rubric.ts';
import {
  api,
  ApiError,
  type AttemptData,
  type AttemptDetails,
  type EvaluationData,
  type RubricData,
} from './api.ts';
import type { Navigate } from './App.tsx';
import { Arrow, dateText, ErrorNotice, latestEvaluation, Loading, StatusBadge } from './components.tsx';

const hints: Record<SectionId, string> = {
  requirements: 'What must the system do? State the assumptions that shape your design.',
  responsibilities: 'Describe your classes or components and what each one owns.',
  interactions: 'Walk through the important flows and how your objects collaborate.',
  edgeCases: 'Describe failures, boundary cases, and the tests that would verify them.',
  tradeOffs: 'Explain your choices and how the design could accommodate change.',
};

export function Practice({
  attemptId,
  navigate,
  onDirty,
  onBusy,
}: {
  attemptId: string;
  navigate: Navigate;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
}) {
  const [data, setData] = useState<AttemptDetails | null>(null);
  const [rubric, setRubric] = useState<RubricData | null>(null);
  const [sections, setSections] = useState<DesignSections>(emptyDesign);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [pollError, setPollError] = useState('');
  const [pollRetry, setPollRetry] = useState(0);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const dirty =
    data?.status === 'draft' && SECTION_IDS.some((section) => sections[section] !== data.draft[section]);
  const latest = data ? latestEvaluation(data) : undefined;
  const count = submissionCharacterCount(sections);

  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    async function load() {
      const attempt = await api.attempt(attemptId, controller.signal);
      const definition = await api.rubric(attempt.problem.rubricVersion, controller.signal);
      if (controller.signal.aborted) return;
      setData(attempt);
      setSections(attempt.draft);
      setRubric(definition);
      setIssues({});
      setConflict(false);
      setSavedMessage('');
    }
    void load().catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [attemptId, reload]);

  useEffect(() => {
    if (!latest || (latest.status !== 'queued' && latest.status !== 'evaluating')) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const evaluationId = latest.id;
    setPollError('');
    async function poll() {
      try {
        const evaluation = await api.evaluation(evaluationId, controller.signal);
        if (controller.signal.aborted) return;
        setData((current) =>
          current
            ? {
                ...current,
                evaluations: current.evaluations.map((run) => (run.id === evaluation.id ? evaluation : run)),
              }
            : current,
        );
        if (evaluation.status === 'queued' || evaluation.status === 'evaluating')
          timer = setTimeout(() => void poll(), 1_000);
      } catch (failure) {
        if (!controller.signal.aborted) setPollError((failure as Error).message);
      }
    }
    timer = setTimeout(() => void poll(), 700);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [latest?.id, latest?.status, pollRetry]);

  function begin() {
    setBusy(true);
    onBusy(true);
    setError('');
    setIssues({});
    setConflict(false);
  }
  function end() {
    setBusy(false);
    onBusy(false);
  }
  function failed(failure: unknown) {
    setError((failure as Error).message);
    if (failure instanceof ApiError) {
      setIssues(failure.issues);
      setConflict(failure.status === 409 || failure.status === 0);
    }
  }
  async function persist(): Promise<AttemptData> {
    const saved = await api.save(attemptId, data!.revision, sections);
    setData((current) => (current ? { ...current, ...saved } : current));
    setSavedMessage(`Saved ${dateText(saved.updatedAt)}`);
    return saved;
  }
  async function save() {
    if (busy || !data) return;
    begin();
    try {
      await persist();
    } catch (failure) {
      failed(failure);
    } finally {
      end();
    }
  }
  async function submit() {
    if (busy || !data) return;
    try {
      validateSubmission(sections);
    } catch (failure) {
      if (failure instanceof DomainError) {
        setError(failure.message);
        setIssues(failure.issues);
        const first = SECTION_IDS.find((section) => failure.issues[section]);
        if (first) document.getElementById(`section-${first}`)?.focus();
      }
      return;
    }
    begin();
    try {
      const saved = dirty ? await persist() : data;
      const result = await api.submit(attemptId, saved.revision);
      setData({ ...result.attempt, evaluations: [result.evaluation] });
      setSelectedRun(null);
      requestAnimationFrame(() =>
        document.getElementById('feedback')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    } catch (failure) {
      failed(failure);
    } finally {
      end();
    }
  }
  async function revise() {
    if (busy) return;
    begin();
    try {
      const revision = await api.revise(attemptId);
      end();
      navigate(`/practice/${encodeURIComponent(revision.id)}`);
    } catch (failure) {
      failed(failure);
      end();
    }
  }
  async function retry() {
    if (busy || !latest || latest.status !== 'failed') return;
    begin();
    try {
      const run = await api.retry(latest.id);
      setData((current) => (current ? { ...current, evaluations: [...current.evaluations, run] } : current));
      setSelectedRun(null);
    } catch (failure) {
      failed(failure);
    } finally {
      end();
    }
  }
  function reloadSaved() {
    if (
      dirty &&
      !window.confirm(
        'Replace your local edits with the saved draft? Copy any changes you want to keep first.',
      )
    )
      return;
    setReload((value) => value + 1);
  }

  if (!data || !rubric)
    return (
      <>
        {error ? (
          <ErrorNotice
            action={
              <button className="text-button" onClick={() => setReload((value) => value + 1)}>
                Try loading again
              </button>
            }
          >
            {error}
          </ErrorNotice>
        ) : (
          <Loading />
        )}
        <button className="text-button" onClick={() => navigate('/problems')}>
          Back to problems
        </button>
      </>
    );
  const submitted = data.status === 'submitted';
  const displayed = data.evaluations.find((run) => run.id === selectedRun) ?? latest;
  return (
    <>
      <div className="breadcrumbs">
        <a href="#/problems">Problems</a>
        <span>/</span>
        <span>{data.problem.title}</span>
      </div>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">YOUR PRACTICE WORKSPACE</div>
          <h1>{data.problem.title}</h1>
          <p>
            {submitted
              ? 'Your submitted thinking, with room for a stronger next attempt.'
              : 'Make the responsibilities clear. Explain how the pieces work together.'}
          </p>
        </div>
        <StatusBadge status={submitted ? (latest?.status ?? 'submitted') : 'draft'} />
      </div>
      {data.previousAttemptId && (
        <div className="revision-note">
          You’re working on a revision.{' '}
          <a href={`#/practice/${encodeURIComponent(data.previousAttemptId)}`}>
            View the original attempt <Arrow />
          </a>
        </div>
      )}
      <div className="workspace-grid">
        <aside className="problem-panel" aria-label="Problem instructions">
          <div className="panel-heading">
            <span className="eyebrow">THE BRIEF</span>
            <span className="version">Version {data.problem.version}</span>
          </div>
          <h2>Understand the problem</h2>
          <div className="problem-description">
            {data.problem.description.split('\n\n').map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <details open className="brief-details">
            <summary>
              Requirements <span>{data.problem.requirements.length}</span>
            </summary>
            <ol className="requirements-list">
              {data.problem.requirements.map((requirement, index) => (
                <li key={index}>{requirement}</li>
              ))}
            </ol>
          </details>
          <details className="brief-details rubric-details">
            <summary>
              What your feedback covers <span>5</span>
            </summary>
            <ul>
              {rubric.criteria.map((criterion) => (
                <li key={criterion.id}>
                  <strong>{criterion.title}</strong>
                  <p>{criterion.description}</p>
                </li>
              ))}
            </ul>
            <p className="rubric-labels">Strong · Needs improvement · Insufficient evidence</p>
          </details>
        </aside>
        <div className="answer-column">
          <section className="editor-panel" aria-labelledby="design-title">
            <div className="editor-heading">
              <div>
                <span className="eyebrow">
                  {submitted ? 'SAVED SUBMISSION' : 'FIVE SECTIONS. YOUR REASONING.'}
                </span>
                <h2 id="design-title">{submitted ? 'Your submitted design' : 'Your design'}</h2>
              </div>
              {submitted && (
                <button className="button secondary" disabled={busy} onClick={() => void revise()}>
                  Revise design <Arrow />
                </button>
              )}
            </div>
            {submitted ? (
              <div className="read-only-note">
                This submission is saved. Create a revision to develop your answer further.
              </div>
            ) : (
              <p className="editor-intro">
                All five sections are required when you submit. Save a draft whenever you need a break.
              </p>
            )}
            {error && (
              <ErrorNotice
                action={
                  conflict ? (
                    <button className="text-button" onClick={reloadSaved}>
                      Reload saved attempt
                    </button>
                  ) : undefined
                }
              >
                {error}
                {conflict && (
                  <p>Your local text is still here. Reloading replaces it with the saved version.</p>
                )}
              </ErrorNotice>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              noValidate
            >
              {SECTION_IDS.map((section, index) => (
                <div className="answer-section" key={section}>
                  <div className="field-heading">
                    <span className="section-number">{String(index + 1).padStart(2, '0')}</span>
                    <label htmlFor={`section-${section}`}>{SECTION_NAMES[section]}</label>
                    {!submitted && <span className="required-label">Required</span>}
                  </div>
                  <p id={`help-${section}`} className="field-hint">
                    {hints[section]}
                  </p>
                  <textarea
                    id={`section-${section}`}
                    name={section}
                    value={sections[section]}
                    readOnly={submitted || busy}
                    rows={4}
                    spellCheck
                    placeholder="Explain your thinking here…"
                    aria-required={!submitted}
                    aria-invalid={Boolean(issues[section])}
                    aria-describedby={`help-${section}${issues[section] ? ` error-${section}` : ''}`}
                    onChange={(event) => {
                      setSections((current) => ({ ...current, [section]: event.target.value }));
                      setSavedMessage('');
                      setIssues((current) => ({ ...current, [section]: '' }));
                    }}
                  />
                  {issues[section] && (
                    <p className="field-error" id={`error-${section}`}>
                      {issues[section]}
                    </p>
                  )}
                </div>
              ))}
              <div className="editor-actions">
                <div className="budget">
                  <div>
                    <span className={count > MAX_SUBMISSION_CHARACTERS ? 'over-budget' : ''}>
                      {count.toLocaleString()} / 6,000 characters
                    </span>
                    <span className="save-status" role="status">
                      {dirty
                        ? 'Unsaved changes'
                        : savedMessage || (submitted ? 'Submission saved' : 'Draft saved')}
                    </span>
                  </div>
                  <div className="budget-track" aria-hidden="true">
                    <span
                      className={count > MAX_SUBMISSION_CHARACTERS ? 'over-budget' : ''}
                      style={{ width: `${Math.min(100, (count / MAX_SUBMISSION_CHARACTERS) * 100)}%` }}
                    />
                  </div>
                  {count > MAX_SUBMISSION_CHARACTERS && (
                    <p className="field-error">
                      Shorten your answer to 6,000 characters before submitting. You can still save this
                      draft.
                    </p>
                  )}
                </div>
                {!submitted && (
                  <div className="action-buttons">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy || !dirty}
                      onClick={() => void save()}
                    >
                      {busy ? 'Working…' : 'Save draft'}
                    </button>
                    <button
                      type="submit"
                      className="button primary"
                      disabled={busy || count > MAX_SUBMISSION_CHARACTERS}
                    >
                      Submit for feedback <Arrow />
                    </button>
                  </div>
                )}
              </div>
            </form>
          </section>
          {submitted && (
            <section className="feedback-panel" id="feedback" aria-labelledby="feedback-title">
              <div className="feedback-heading">
                <div>
                  <span className="eyebrow">YOUR NEXT STEP</span>
                  <h2 id="feedback-title">Design feedback</h2>
                </div>
                {data.evaluations.length > 1 && (
                  <select
                    aria-label="Evaluation run"
                    value={displayed?.id ?? ''}
                    onChange={(event) => setSelectedRun(event.target.value)}
                  >
                    {data.evaluations.map((run, index) => (
                      <option key={run.id} value={run.id}>
                        Run {index + 1} · {run.status}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {pollError && (
                <ErrorNotice
                  action={
                    <button className="text-button" onClick={() => setPollRetry((value) => value + 1)}>
                      Check status again
                    </button>
                  }
                >
                  {pollError}
                </ErrorNotice>
              )}
              {!displayed ? (
                <p className="muted">
                  No evaluation is available yet. Reload this attempt to check its saved status.
                </p>
              ) : (
                <Feedback
                  run={displayed}
                  rubric={rubric}
                  busy={busy}
                  canRetry={displayed.id === latest?.id}
                  onRetry={() => void retry()}
                />
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Feedback({
  run,
  rubric,
  busy,
  canRetry,
  onRetry,
}: {
  run: EvaluationData;
  rubric: RubricData;
  busy: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  if (run.status === 'queued' || run.status === 'evaluating')
    return (
      <div className="evaluation-progress" role="status">
        <span className="spinner" />
        <h3>{run.status === 'queued' ? 'Your design is in the queue' : 'Looking through your design'}</h3>
        <p>Your submission is saved. Feedback will appear here when it’s ready.</p>
      </div>
    );
  if (run.status === 'failed')
    return (
      <div className="evaluation-failure">
        <span className="failure-icon" aria-hidden="true">
          !
        </span>
        <h3>Your design is saved. Evaluation couldn’t finish.</h3>
        <p>{run.failure?.message ?? 'Please try the evaluation again when you are ready.'}</p>
        {canRetry ? (
          <button className="button primary" disabled={busy} onClick={onRetry}>
            Retry evaluation <Arrow />
          </button>
        ) : (
          <p className="muted">This is an earlier run. Choose the latest run to see its outcome.</p>
        )}
        <p className="micro-copy">
          Retrying evaluates the same submission. Your earlier result stays in history.
        </p>
      </div>
    );
  if (!run.feedback)
    return <p className="muted">Feedback is unavailable. Reload this attempt to check its saved result.</p>;
  return (
    <>
      <p className="feedback-intro">
        Use these observations to decide what to keep and what to develop in your next revision.
      </p>
      <div className="assessment-list">
        {run.feedback.assessments.map((assessment) => (
          <article className="assessment" key={assessment.criterionId}>
            <div className="assessment-heading">
              <h3>
                {rubric.criteria.find((criterion) => criterion.id === assessment.criterionId)?.title ??
                  assessment.criterionId}
              </h3>
              <span className={`badge label-${assessment.label}`}>{ASSESSMENT_LABELS[assessment.label]}</span>
            </div>
            <p>{assessment.explanation}</p>
            {assessment.evidence.map((evidence, index) => (
              <blockquote key={index}>
                <span>{SECTION_NAMES[evidence.sectionId]}</span>
                {evidence.quote}
              </blockquote>
            ))}
            <div className="suggestion">
              <strong>Try this</strong>
              <p>{assessment.suggestion}</p>
            </div>
          </article>
        ))}
      </div>
      {run.feedback.priorityImprovements.length > 0 && (
        <div className="priority-panel">
          <span className="eyebrow">FOCUS YOUR NEXT REVISION</span>
          <h3>Where to go from here</h3>
          <ol>
            {run.feedback.priorityImprovements.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
        </div>
      )}
      <p className="micro-copy">
        Evaluated {dateText(run.finishedAt ?? run.updatedAt)} · Feedback is coaching guidance.
      </p>
    </>
  );
}
