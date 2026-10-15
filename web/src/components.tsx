import type { ReactNode } from 'react';
import type { AttemptDetails, EvaluationData, ProblemData } from './api.ts';

export function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={back ? 'arrow back' : 'arrow'}
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProblemArt({ id }: { id: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 160 120" fill="none" className="problem-art">
      <circle cx="80" cy="60" r="49" fill="currentColor" opacity=".08" />
      {id === 'parking-lot' ? (
        <>
          <path
            d="M32 89h96M44 77V52l9-17h54l9 17v25M44 55h72M54 77v9M106 77v9"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect
            x="40"
            y="55"
            width="80"
            height="23"
            rx="7"
            fill="var(--art-bg)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <circle cx="53" cy="65" r="3" fill="currentColor" />
          <circle cx="107" cy="65" r="3" fill="currentColor" />
          <path d="M71 66h18" stroke="currentColor" strokeWidth="2.5" />
        </>
      ) : id === 'vending-machine' ? (
        <>
          <rect
            x="49"
            y="17"
            width="62"
            height="87"
            rx="7"
            fill="var(--art-bg)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <rect x="58" y="28" width="31" height="46" rx="3" stroke="currentColor" strokeWidth="2" />
          <path
            d="M59 51h29M65 35v9m14-9v9M65 59v8m14-8v8M96 39h7M96 49h7M64 86h31"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="99" cy="62" r="3" stroke="currentColor" strokeWidth="2" />
        </>
      ) : (
        <>
          <rect
            x="38"
            y="37"
            width="21"
            height="58"
            rx="3"
            transform="rotate(-10 38 37)"
            fill="var(--art-bg)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <rect
            x="67"
            y="25"
            width="22"
            height="70"
            rx="3"
            fill="var(--art-bg)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <rect
            x="95"
            y="40"
            width="22"
            height="55"
            rx="3"
            fill="var(--art-bg)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path
            d="M73 37h10M73 81h10M100 51h12M100 82h12M35 99h91"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

export function Loading({ text = 'Loading your workspace…' }: { text?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="spinner" />
      {text}
    </div>
  );
}

export function ErrorNotice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="error-notice" role="alert">
      <div>{children}</div>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const text: Record<string, string> = {
    draft: 'Draft',
    queued: 'Queued',
    evaluating: 'Evaluating',
    completed: 'Feedback ready',
    failed: 'Evaluation failed',
    submitted: 'Submitted',
  };
  return (
    <span className={`badge status-${status}`}>
      {(status === 'queued' || status === 'evaluating') && <span className="status-dot" />}
      {text[status] ?? status}
    </span>
  );
}

export function latestEvaluation(attempt: AttemptDetails): EvaluationData | undefined {
  return attempt.evaluations.at(-1);
}

export function attemptStatus(attempt: AttemptDetails): string {
  return attempt.status === 'draft' ? 'draft' : (latestEvaluation(attempt)?.status ?? 'submitted');
}

export function dateText(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export const problemNotes: Record<string, { focus: string; summary: string }> = {
  'parking-lot': {
    focus: 'Responsibilities & allocation',
    summary: 'Model vehicle entry, parking spaces, pricing, and a reliable exit flow.',
  },
  'vending-machine': {
    focus: 'States & failure handling',
    summary: 'Reason through payments, product dispensing, change, and cancellation.',
  },
  'library-management': {
    focus: 'Relationships & lending rules',
    summary: 'Connect books, copies, members, and loans with clear borrowing rules.',
  },
};

export function ProblemCard({
  problem,
  index,
  busy,
  onStart,
}: {
  problem: ProblemData;
  index: number;
  busy: boolean;
  onStart: () => void;
}) {
  const notes = problemNotes[problem.id];
  return (
    <article className={`problem-card art-${problem.id}`}>
      <div className="card-visual">
        <ProblemArt id={problem.id} />
        <span className="card-number">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="card-body">
        <span className="eyebrow">{notes?.focus ?? 'Low-level design'}</span>
        <h2>{problem.title}</h2>
        <p>{notes?.summary ?? problem.description.split('\n')[0]}</p>
        <div className="card-meta">
          {problem.requirements.length} requirements <span>·</span> 5 answer sections
        </div>
        <button className="button card-button" disabled={busy} onClick={onStart}>
          Start practice <Arrow />
        </button>
      </div>
    </article>
  );
}
