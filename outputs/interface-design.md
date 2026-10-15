# React interface

The candidate approved three screens, a clean light theme with teal accents, problem/rubric instructions beside the five answer sections, saved submission review, manual retries, revisions, and history. The implementation uses the existing React/TypeScript, Express, and SQLite architecture.

## Screens and actions

| Screen | Behaviour |
| --- | --- |
| Problems | Shows the three saved problem definitions. Start practice creates a draft for the selected problem/version. |
| Practice | Shows full instructions, requirements, and expandable rubric details beside a five-section editor. Shows a combined 6,000-character counter, Save draft, and Submit for feedback. |
| History | Lists drafts and submissions with their dates, revision status, evaluation count, and latest status. Filters by problem and supports resuming or reviewing an attempt. |

Saving is explicit. An incomplete or over-budget draft can be saved. Submit checks all five sections locally and saves any current edits before submitting with the returned revision. This avoids evaluating an earlier saved answer. Only explicit submission or manual evaluation retry queues a provider request; browsing, saving, and status polling do not.

Submitted answers are read-only. Feedback includes the five assessment labels, grounded evidence, explanations, suggestions, and priority improvements. Evaluation progress appears while queued/evaluating; polling stops on completion/failure. A polling connection error offers a status-read retry, which does not create another evaluation.

Failed evaluations offer Retry evaluation for the latest failed run. Earlier failures remain reviewable through the run selector, without an action that would duplicate an existing retry. Revise design creates a separate prefilled attempt linked to the original. Original answers and evaluation history remain intact.

Unsaved edits prompt before navigation or page exit. A stale save preserves local text and offers an explicit reload of the saved attempt, with confirmation before replacing edits. Inputs and navigation are guarded while an action is in flight. History has a manual Refresh action for checking current status.

## Implementation

React source lives in `web/`. Vite compiles it into `dist/`; the normal Express runtime serves the page at `/` and compiled files under `/assets`. API routing and JSON error handling remain separate. The browser uses hash routes for Problems, History, and an attempt workspace, allowing direct links without another routing service or package.

Response types are shared through type-only imports from the server representations. The browser shares the pure domain section names, submission validation, and Unicode character-count function. Server credentials and provider infrastructure are not included in the browser bundle. Vite's environment directory is `web/`, separate from the real project `.env`.

Visual assets are local SVG illustrations and system fonts. The desktop workspace has two columns; mobile stacks the instructions and editor. Form fields have labels, hints, error associations, visible focus, and status messages. The header includes a skip-to-content link. Reduced-motion preferences disable animation.

## Simulated preview

`npm run demo` builds the interface and starts `src/preview-server.ts` on `http://127.0.0.1:4173`. This entry point does not import Groq configuration or load the real `.env`. It uses a simulated evaluator and a separate database at `work/preview/practice.sqlite`. A visible banner and each assessment explain that the feedback is simulated.

The preview allows the full practice loop to be reviewed without spending API quota. It demonstrates presentation and state handling; its assessments are not model judgments. Browser tests use the same entry point with an isolated in-memory database on port 4183. A reserved `[preview-failure]` input exists only in this simulated evaluator to test one failed run followed by manual retry.

## Validation

The 128 backend tests, backend/frontend TypeScript checks, and production build pass. Nine real-browser tests pass using Microsoft Edge:

1. Catalogue rendering, simulated-feedback labelling, private-path protection, and desktop width.
2. Draft save, history filtering, resume, and persistence across page reload.
3. Missing-section and over-budget validation, with over-budget draft saving allowed.
4. Submitting unsaved edits, feedback polling, read-only answers, and a prefilled revision.
5. Manual retry with preserved failure/completion runs against the same submission.
6. Stale-write handling that retains local edits until an explicit reload.
7. Polling recovery without a new submission or evaluation.
8. Cancelling navigation without losing unsaved text.
9. Mobile collection, editor, and history without horizontal overflow.

Browser screenshots were reviewed for desktop and mobile and saved as `outputs/ui-problems.png`, `outputs/ui-practice.png`, `outputs/ui-feedback.png`, and `outputs/ui-mobile.png`. Windows initially blocked browser startup inside the sandbox; the successful checks ran with browser-launch access outside that sandbox. No real credentials or Groq requests were involved.

Live feedback compatibility/quality and final research/design submission notes remain pending. HTTP request deduplication that returns prior successful results remains unimplemented; stale or repeated writes are rejected and the interface preserves local work on conflicts.
