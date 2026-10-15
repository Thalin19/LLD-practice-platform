# LLD Practice Platform

A focused CipherSchools assignment prototype for practising object-oriented design: choose a problem, save a structured draft, submit it, review explainable feedback, and revise while preserving attempt history.

The application uses React/TypeScript, Node.js/Express, SQLite, and a sequential background evaluator. It has one demo learner and three problems: Parking Lot, Vending Machine, and Library Management. The practice flow has automated coverage, and one live Gemini evaluation produced validated, persisted feedback.

## Submission documents

| Document | Contents |
| --- | --- |
| [Research note](outputs/research-note.md) / [two-page PDF](outputs/research-note.pdf) | Learner problem, three existing approaches, evidence limits, and product direction. |
| [Design note](outputs/design-note.md) | MVP, classes/interfaces, evaluation, reliability, trade-offs, and extension points. |
| [AI usage](AI_USAGE.md) | Five meaningful AI-assisted decisions, choices, and reasons. |
| [Demo walkthrough](outputs/demo-walkthrough.md) | Step-by-step demonstration, sample answer, failure/retry fixture, and optional live pass. |

The [full AI usage history](outputs/ai-usage-history.md) and earlier drafts are retained as development records. The final notes above describe the current submission.

## Quick start: simulated preview

Use **Node.js 24.12 or newer** and npm. Open a terminal in the project root: the folder containing `package.json` and this README.

For a fresh checkout, install the locked dependencies:

```sh
npm ci
```

Start the preview:

```sh
npm run demo
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The command builds the interface and starts a local API and simulated worker. **No API key is needed and no provider quota is used.** The page and feedback explicitly identify simulation. The preview demonstrates interactions rather than design judgement.

Preview data persists in `work/preview/practice.sqlite`, separate from the real application. Set the `PREVIEW_PORT` environment variable to override 4173. Stop with Ctrl+C. On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is restricted.

Follow the [demo walkthrough](outputs/demo-walkthrough.md) to show drafting, validation, feedback, history, revisions, and manual retries.

## Run with live Gemini feedback

For a fresh checkout without a `.env`, create one from `.env.example` and enter your own Google AI Studio key:

```dotenv
GEMINI_API_KEY=your_google_ai_studio_key
```

Use a project marked Free Tier with billing disabled to meet the assignment's zero-spending constraint. See [Google's key setup](https://ai.google.dev/gemini-api/docs/api-key) and [billing documentation](https://ai.google.dev/gemini-api/docs/billing). The application cannot determine billing status from a key. Keep an existing configured `.env`; it is excluded from Git and should not be included in a submission archive.

Build and start:

```sh
npm run build
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The same Express process serves the interface and API. Startup loads `GEMINI_API_KEY`, initializes the catalogue in `data/practice.sqlite`, and starts the worker. An explicit environment key takes precedence over the local file. Missing credentials prevent startup. `PORT` is an environment-variable override; the server does not load it from `.env`.

Each explicit submission or evaluation retry queues work that can make one Gemini request. Reads, draft saves, and polling do not. Starting the server also processes previously queued work. The worker runs one job at a time; there are no automatic retries, response repairs, or model fallbacks. The production adapter uses `gemini-3.8-flash`, LOW thinking, a 1,200-output-token cap, and a 30-second timeout.

Stop with Ctrl+C. Run one application process per database. Shutdown cancels active evaluation work and saves its failure where possible. At restart, runs left evaluating become failed for manual retry; never-started queued work can proceed. See [worker recovery](outputs/worker-design.md).

The production application, preview, automated tests, and historical live checks use separate databases. Saved live-check reports do not automatically populate the application History screen.

## Practice behaviour

The five answer sections cover requirements/assumptions, classes/responsibilities, relationships/interactions, edge cases/testing, and trade-offs. All are required on submission, with a combined limit of 6,000 Unicode code points including whitespace. Incomplete or over-budget drafts can still be saved. Draft saving is explicit, and submitting saves edited text before accepting its immutable snapshot.

The rubric assesses requirements coverage, class responsibilities, relationships/interfaces, extensibility/trade-offs, and edge cases/testability. Labels are Strong, Needs improvement, and Insufficient evidence. Each criterion includes an explanation and suggestion; Strong and Needs improvement require a literal quote from a named answer section. Up to three priorities guide revision. Provider output must pass local validation before completion is saved.

A **revision** creates a separate prefilled editable attempt. A **retry** creates a new evaluation against the same saved answer, rubric, and evaluator identity. Both preserve earlier history. Stale writes and duplicate submissions are rejected, and the interface retains local text after a conflict.

## Validation

| Command | Purpose |
| --- | --- |
| `npm test` | 146 offline domain, storage, application, HTTP, evaluator, and worker tests. |
| `npm run typecheck` | Backend and React TypeScript checks. |
| `npm run build` | Production interface build. |
| `npm run check` | TypeScript checks, offline tests, then build. |
| `npm run test:ui` | Build and run nine Playwright browser tests using installed Microsoft Edge. |
| `npm run db:init` | Optional standalone initialization of the real catalogue/database; startup also initializes it. |

The latest completed backend checks passed all 146 tests, both TypeScript checks, and the build. Nine browser tests previously passed against the labelled simulated preview, including mobile layout, draft persistence, validation, revision, manual retry, stale edits, polling errors, and unsaved navigation. Desktop/mobile screenshots are under `outputs/`.

Automated tests use fixture credentials and simulated transports; they do not read the real `.env` or consume provider quota. File-based tests use isolated databases under `work/test-databases`. Browser tests start their own in-memory preview on port 4183; that port must be free. Microsoft Edge is required by the current browser configuration. Reports are under `work/ui-report` and `work/ui-test-results`.

A separately authorized [live Parking Lot check](outputs/gemini-recovery-check.md) returned HTTP 200, five validated assessments, and 1,826 reported total tokens: 1,056 input and 770 output. Completion was confirmed after reopening SQLite. Earlier provider errors and the corrected unsupported thinking setting are preserved in the [development history](outputs/ai-usage-history.md). This verifies one live sample, not broad feedback consistency or injection resistance. Guarded live-check scripts are excluded from normal test/startup execution and preserve their previous results when rerun.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| A startup message mentions the key | Set `GEMINI_API_KEY` in the project `.env` or environment. The preview works without credentials. |
| The port is in use | Use the existing instance or stop it before starting another. Set `PORT` or `PREVIEW_PORT` in the environment to choose another port. |
| The real interface is missing | Run `npm run build` before `npm start`. |
| Gemini is unavailable, rate-limited, or times out | The answer remains saved. Wait before choosing a manual retry; the preview is available for demonstrations. |
| A draft save conflicts | Copy any local edits you want to keep, then use the explicit reload action to obtain the stored revision. |
| Browser tests cannot launch | Confirm Microsoft Edge is installed. Restricted environments may require browser-launch permission. |
| Node prints a SQLite experimental warning | The project uses Node's built-in `node:sqlite`; the warning was present during successful checks. |

## Design and limitations

The modular monolith keeps the learner actions independent of provider and storage details. Attempt owns draft behaviour, Submission preserves accepted content, Evaluation owns run transitions, and Rubric validates feedback. Repository operations commit submission and queued work atomically; model calls run outside transactions. The [design note](outputs/design-note.md) explains these responsibilities and future variation points.

Current boundaries include one demo identity without login, a single process per database, sequential evaluation, explicit draft saving, and structured text only. There is no diagram editor, code execution, or side-by-side comparison. Repeated HTTP requests are rejected rather than replaying a prior success. Production evaluations store the provider ID but not a full model/prompt configuration snapshot.

Literal evidence matching cannot establish that a judgement is correct. Further evaluation of alternative-design fairness, consistency, injection resistance, and learning outcomes remains future work. Extra provider calls require a deliberate decision about quota use. External service availability can vary.

## Project map

```text
src/domain/                  Behaviour, lifecycle rules, and deterministic validation
src/content/                 Three versioned problem statements
src/application/             Learner actions, evaluation processor, and ports
src/http/                    Twelve API routes and response representations
src/infrastructure/sqlite/   Five tables, constraints, repository, and catalogue seeding
src/infrastructure/gemini/   Active evaluator and bounded provider request
src/infrastructure/groq/     Historical adapter; no automatic fallback
src/infrastructure/worker/   Sequential scheduling and restart recovery
src/runtime/                Configuration, startup, and shutdown
src/server.ts               Real application entry point
src/preview-server.ts       Simulated preview with separate data
web/                         React interface
scripts/                     Guarded historical live checks
outputs/                     Final notes, screenshots, and validation evidence
work/                        Intermediate files and isolated demonstration/test data
```

For details, see the [API contract](outputs/api-contract.md), [problem statements](outputs/practice-problems.md), [storage design](outputs/storage-design.md), and [evaluation design](outputs/evaluation-design.md). Earlier planning and milestone documents may describe the state at that stage; use the final research/design notes and this README for current scope. Generated dependencies, builds, local credentials, and databases are excluded through `.gitignore`.
