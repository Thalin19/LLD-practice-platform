import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProblemData } from './api.ts';
import { Arrow, ErrorNotice, Loading, ProblemCard } from './components.tsx';
import { Practice } from './Practice.tsx';
import { History } from './History.tsx';

export type Navigate = (path: string) => void;
function currentPath() {
  return window.location.hash.slice(1) || '/problems';
}

export function App() {
  const [path, setPath] = useState(currentPath);
  const [dirty, setDirty] = useState(false);
  const previous = useRef(path);
  const busyNavigation = useRef(false);
  const onBusy = useCallback((value: boolean) => {
    busyNavigation.current = value;
  }, []);
  useEffect(() => {
    const change = () => {
      const next = currentPath();
      if (next === previous.current) return;
      if (
        busyNavigation.current ||
        (dirty && !window.confirm('Leave this draft? Your unsaved changes will be lost.'))
      ) {
        window.location.hash = previous.current;
        return;
      }
      previous.current = next;
      setDirty(false);
      setPath(next);
      window.scrollTo(0, 0);
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || busyNavigation.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('hashchange', change);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('beforeunload', unload);
    };
  }, [dirty]);
  const navigate: Navigate = (next) => {
    window.location.hash = next;
  };
  const practiceMatch = /^\/practice\/([^/]+)$/.exec(path);
  let attemptId: string | null = null;
  try {
    if (practiceMatch) attemptId = decodeURIComponent(practiceMatch[1]!);
  } catch {
    /* Show unknown-page state. */
  }
  const preview =
    document.querySelector('meta[name="practice-mode"]')?.getAttribute('content') === 'simulated';
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#/problems">
            <span className="brand-mark" aria-hidden="true">
              [<i />]
            </span>
            <span>
              Design Lab<small>LOW-LEVEL DESIGN PRACTICE</small>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#/problems" aria-current={path === '/problems' ? 'page' : undefined}>
              Problems
            </a>
            <a href="#/history" aria-current={path === '/history' ? 'page' : undefined}>
              History
            </a>
          </nav>
          <div className="learner">
            <span className="avatar">D</span>
            <span>Demo learner</span>
          </div>
        </div>
      </header>
      {preview && (
        <div className="preview-banner">
          Preview mode <span>·</span> Feedback is simulated. No AI quota is used.
        </div>
      )}
      <main id="main" className="main-container" tabIndex={-1}>
        {path === '/problems' ? (
          <Problems navigate={navigate} />
        ) : path === '/history' ? (
          <History navigate={navigate} />
        ) : attemptId ? (
          <Practice
            key={attemptId}
            attemptId={attemptId}
            navigate={navigate}
            onDirty={setDirty}
            onBusy={onBusy}
          />
        ) : (
          <div className="empty-state">
            <h1>Page not found</h1>
            <p>Choose a problem to get back to practice.</p>
            <button className="button primary" onClick={() => navigate('/problems')}>
              Browse problems <Arrow />
            </button>
          </div>
        )}
      </main>
      <footer className="site-footer">
        <span>Design Lab</span>
        <span>Make your reasoning visible.</span>
        <span>Built for deliberate practice</span>
      </footer>
    </>
  );
}

function Problems({ navigate }: { navigate: Navigate }) {
  const [problems, setProblems] = useState<ProblemData[] | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api
      .problems(controller.signal)
      .then(setProblems)
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [refresh]);
  async function start(problem: ProblemData) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const draft = await api.start(problem);
      navigate(`/practice/${encodeURIComponent(draft.id)}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-square" /> A SPACE TO THINK THROUGH DESIGN
          </div>
          <h1>
            Good design starts
            <br />
            with clear thinking<span>.</span>
          </h1>
          <p>
            Work through real design problems. Explain your decisions.
            <br className="desktop-break" /> Turn focused feedback into a stronger next attempt.
          </p>
        </div>
        <div className="hero-diagram" aria-hidden="true">
          <span className="diagram-note">
            A little structure.
            <br />
            Room for your ideas.
          </span>
          <div className="diagram-node node-top">
            <span />
            Problem
          </div>
          <div className="diagram-connector" />
          <div className="diagram-row">
            <div className="diagram-node">
              <span />
              Your design
            </div>
            <div className="diagram-node">
              <span />
              Feedback
            </div>
          </div>
          <div className="diagram-loop">↳ revise & try again</div>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <div className="eyebrow">THE PRACTICE COLLECTION</div>
          <h2>Choose your next challenge</h2>
        </div>
        <span className="collection-count">
          {problems?.length ?? '—'} problems <span>·</span> One clear process
        </span>
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
      {!problems && !error ? (
        <Loading text="Loading the problem collection…" />
      ) : problems?.length === 0 ? (
        <div className="empty-state">
          <h3>No problems available yet</h3>
          <p>The collection will appear here once it is ready.</p>
        </div>
      ) : (
        <div className="problem-grid">
          {problems?.map((problem, index) => (
            <ProblemCard
              key={`${problem.id}:${problem.version}`}
              problem={problem}
              index={index}
              busy={busy}
              onStart={() => void start(problem)}
            />
          ))}
        </div>
      )}
      <section className="how-it-works" aria-label="How practice works">
        <div>
          <span>01</span>
          <p>
            Choose a problem<small>Read its scope and requirements.</small>
          </p>
        </div>
        <span className="step-arrow">→</span>
        <div>
          <span>02</span>
          <p>
            Explain your design<small>Build your answer in five sections.</small>
          </p>
        </div>
        <span className="step-arrow">→</span>
        <div>
          <span>03</span>
          <p>
            Learn from feedback<small>Review, revise, and try again.</small>
          </p>
        </div>
      </section>
    </>
  );
}
