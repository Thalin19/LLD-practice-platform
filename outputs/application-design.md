# Application actions

Status: approved and implemented in `src/application/practice-service.ts`. These actions connect the existing domain model to the repository. Express routes expose them, the background worker processes queued evaluations, and the React interface presents the learner flow. Nine separate browser tests exercise that flow with simulated feedback.

`PracticeService` receives the repository, the configured demo learner ID, the evaluator ID for new submissions, and an ID-generation function. Tests supply deterministic IDs. The API entry point supplies UUID-based IDs, `demo-learner`, and evaluator ID `gemini`. The service does not open a database, load credentials, or call a provider itself.

| Action | Inputs | Result and behaviour |
| --- | --- | --- |
| Start attempt | Problem ID and explicit version | Stores an empty draft for the configured learner. |
| Save draft | Attempt ID, expected revision, partial section changes | Preserves untouched sections and returns the updated revision. |
| Submit | Attempt ID and expected revision | Validates all five sections and atomically saves the immutable submission with a queued evaluation. |
| Retry evaluation | Failed evaluation ID | Queues a new run for the same saved submission, rubric, and evaluator, preserving the failed run. |
| Revise attempt | Submitted attempt ID | Stores a separate prefilled draft linked to the original attempt. |
| View history | Optional problem ID | Returns saved drafts/submissions and their evaluation histories, newest attempts first. |

Additional reads list saved problem versions, retrieve one exact problem or rubric version, show one attempt with its evaluation history, and retrieve an evaluation for status polling. Problem versions remain explicit; the service does not choose a latest version on the learner's behalf.

Each action reloads its saved records. Draft saves and submissions require the revision last seen by the caller. Invalid revisions produce a domain input error; stale revisions produce a storage conflict. The repository checks the revision again within the write transaction. After a failed transaction, another service call loads the persisted state rather than reusing a transitioned in-memory attempt.

Submitted answers remain immutable. Editing requires a revision. Retrying requires a failed run; uniqueness constraints reject a second direct retry from the same failure. A repeated submission is rejected and creates no extra evaluation. Returning a prior success for repeated HTTP requests remains future work.

The configured learner scopes reads and writes. Missing records and records belonging to another learner both report not found. This is an ownership boundary for the application, not a login implementation; the prototype still uses one demo learner.

The application layer preserves original problem/rubric versions when revising. A new submission uses the currently configured evaluator ID. A retry retains the evaluator ID of its failed parent.

## Validation

`npm run check` passes TypeScript checks and all 146 tests: 33 original domain, 23 storage, 17 application integration, 17 HTTP integration, 25 evaluation/limit, 13 worker/runtime, and 18 Gemini adapter/integration tests. Application tests use isolated SQLite files inside this project and cover:

- Starting, saving, submitting, reopening storage, reading simulated feedback, revising, and resubmitting.
- Missing sections, invalid patches, stale writes from separate connections, and duplicate submissions.
- Failed evaluation retries, repeated failures, original versions, and preserved history.
- History filters, unknown resources, ownership checks, and submission rollback followed by a successful retry.

Evaluation completion/failure is simulated through the repository in these application tests. Separate evaluation and worker tests exercise the processor, adapter, scheduling loop, and API lifecycle using simulated responses. The real `.env` is not read and no LLM request is made. The catalogue seeding step initializes the three selected practice problems for the running API; application tests continue to use isolated fixtures.
