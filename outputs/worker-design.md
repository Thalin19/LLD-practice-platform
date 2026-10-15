# Background worker and restart recovery

The background worker connects the approved persisted-queue flow to the existing single-run evaluation processor. It runs inside the API application process and uses the same SQLite repository. There is no separate queue service or additional application table.

## Startup and processing

`src/server.ts` loads `GEMINI_API_KEY` from the environment or the project's `.env`, initializes the catalogue, constructs the Gemini adapter, and starts the runtime. Explicit environment credentials take precedence; the real key is never logged. `.env.example` is provided for new checkouts. Missing credentials prevent startup.

`src/runtime/start-server.ts` acquires the local HTTP port before recovering evaluations. If another server already owns that port, startup exits without touching its active evaluation state. Once listening, it starts one `EvaluationWorker` with a one-second polling interval. Each iteration processes at most one queued run and waits before the next check; provider requests never overlap within this worker.

Submissions and manual retries enter the persisted queue through the existing API. The worker claims a job atomically, runs the evaluator outside the transaction, and saves validated feedback or a safe failure. API polling reads that persisted result. An empty queue makes no provider request.

Starting the real server enables real Gemini requests for queued work. The implemented tests use injected evaluators/transports and do not start the production entry point with the user's credentials.

## Restart policy

| Saved state at restart | Action |
| --- | --- |
| `queued` | Eligible for processing; it has not yet been claimed. |
| `evaluating` | Mark failed with `EVALUATION_INTERRUPTED`; require a manual retry. |
| `completed` | Preserve its feedback and history. |
| `failed` | Preserve its failure and history; do not retry automatically. |

Recovery runs once at startup before the worker claims jobs. All interrupted-state updates occur in one transaction. Start timestamps remain intact; finish timestamps and revision numbers are updated through the existing domain transitions. If any update fails, the recovery batch rolls back and startup fails.

A process might stop after Gemini processed a request but before its result was saved. Recovery therefore does not resend interrupted requests. An explicitly requested retry creates a new run against the same submission and preserves the failed original. There is also a conservative window between claiming a job and sending the provider request: a crash there still requires manual retry because the saved state cannot establish whether the request was sent.

This policy assumes one application server per database. The normal shared-port check prevents accidental duplicate startup on that port. Running multiple API instances on different ports against the same database is unsupported: there is no distributed ownership/lease mechanism to distinguish their in-flight jobs.

## Shutdown and fatal errors

Ctrl+C or termination stops new HTTP connections, aborts the worker's wait or active provider request, and waits for the processor to save a cancellation failure before closing SQLite. Queued jobs stay queued. HTTP connections that obstruct shutdown are force-closed after five seconds. The provider adapter retains its timeout and cancellation handling.

An abrupt process kill may prevent cancellation from being saved; the next startup then applies interrupted-run recovery. A fatal worker storage/coordinator error stops the worker and closes the API rather than continuing to accept work behind a stopped processor. There is no automatic provider retry after a result-persistence error.

## Validation

All 146 tests and TypeScript checks pass, including 13 worker/runtime tests covering:

- Sequential processing, polling for newly submitted work, and prevention of a second loop on the same worker.
- Database reopening after interruption, preserved terminal history, manual retries, and recovery rollback on write failure.
- Active-request cancellation, preservation of later queued work, and prompt cancellation of an idle timer.
- Halting after persistence failure without making another provider request.
- HTTP submission through background completion and polling, plus failure followed by an HTTP manual retry.
- Port conflicts, shutdown persistence, and configuration loaded only from fixture credentials.

No real `.env` or Gemini API was used during these tests. Live prompt/schema compatibility, feedback quality, and injection resistance remain to be verified with user-approved minimal calls. The React interface is implemented, with nine additional browser tests exercising the practice flow through the simulated worker.
