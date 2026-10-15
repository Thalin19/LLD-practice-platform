# HTTP API contract

The candidate approved the original nine learner routes plus versioned problem details, rubric details, and health. All twelve are implemented in `src/http/app.ts`. The API delegates learner actions to `PracticeService` and uses the existing five-table storage design.

Run `npm start` from the project folder. The default origin is `http://127.0.0.1:3000`; an optional `PORT` environment variable changes it. The server binds to the local loopback interface. No authentication is implemented; every request acts as the configured `demo-learner`. Caller-supplied identity fields are rejected.

## Routes

| Method and route | Request | Success |
| --- | --- | --- |
| `GET /api/health` | None | 200: `{ "status": "ok" }` |
| `GET /api/problems` | None | 200: saved problem versions, including descriptions and requirements |
| `GET /api/problems/:id/versions/:version` | Exact problem ID and version | 200: that saved problem definition |
| `GET /api/rubrics/:version` | Exact rubric version | 200: version, criteria, and assessment labels |
| `POST /api/attempts` | `problemId`, `problemVersion` | 201: new draft |
| `GET /api/attempts` | Optional `?problemId=...` | 200: attempts with evaluation histories, newest attempts first |
| `GET /api/attempts/:id` | Attempt ID | 200: attempt and evaluation history |
| `PATCH /api/attempts/:id/draft` | `expectedRevision`, `patch` | 200: saved draft with its new revision |
| `POST /api/attempts/:id/submit` | `expectedRevision` | 202: `{ "attempt": ..., "evaluation": ... }` |
| `POST /api/attempts/:id/revisions` | No body or `{}` | 201: new prefilled draft |
| `GET /api/evaluations/:id` | Evaluation ID | 200: status, feedback or failure, and timestamps |
| `POST /api/evaluations/:id/retries` | No body or `{}` | 202: new queued evaluation |

All successful payloads use `{ "data": ... }`. Creation responses include a relative `Location` header for the created attempt. Submission and retry responses point to the evaluation status route. Status 202 means work has been queued, not that feedback has been generated.

## Request and response examples

After obtaining a real problem ID/version from the catalogue, start an attempt with:

```json
{ "problemId": "parking-lot", "problemVersion": "1" }
```

Use `Content-Type: application/json` for bodies. Draft updates accept any subset of the five section keys. Always send the last received revision number:

```json
{
  "expectedRevision": 0,
  "patch": {
    "requirements": "My requirements and assumptions...",
    "responsibilities": "My classes and responsibilities..."
  }
}
```

The remaining section keys are `interactions`, `edgeCases`, and `tradeOffs`. Saving an incomplete or over-budget draft is allowed. Submitting requires nonblank text in all five sections and a combined maximum of 6,000 Unicode code points, including spaces/newlines. An over-budget submission returns 400 with `error.issues.totalLength` and preserves the draft. Submit sends only `{ "expectedRevision": <last-received-revision> }` and uses the saved draft; save edits before submitting.

An attempt response includes `id`, `problem`, `status`, `draft`, `submission`, `previousAttemptId`, `revision`, `createdAt`, and `updatedAt`. Detail/history responses also include `evaluations`. A draft's `submission` is null. Submitted snapshots retain their IDs, learner, original problem/rubric versions, format information, and exact section text.

An evaluation response includes `id`, `submissionId`, `rubricVersion`, `evaluatorId`, `status`, `feedback`, `failure`, `previousEvaluationId`, `revision`, and creation/update/start/finish timestamps. `feedback` and `failure` are null until the corresponding terminal state. The API explicitly serializes domain getters so draft content, evaluation status, and feedback are included in JSON.

Rubric responses include criterion IDs/titles/descriptions and the mapping `strong` -> Strong, `needs_improvement` -> Needs improvement, and `insufficient_evidence` -> Insufficient evidence.

## Errors

Errors use `{ "error": { "code": "...", "message": "...", "issues": {} } }`. Submission validation populates `issues` with missing section keys so the interface can highlight them.

| Status | Meaning |
| --- | --- |
| 400 | Invalid JSON, request shape/types, section input, revision number, URL encoding, or history filter |
| 404 | Unknown route or resource, unknown problem/rubric version, or another learner's record |
| 409 | Stale revision, duplicate submission/retry, or an action invalid for the current lifecycle state |
| 413 | Request exceeds the JSON parser's default 100 KB transport limit |
| 415 | Unsupported body content type or encoding |
| 500 | Unexpected server/storage failure; response omits stack traces and internal details |

Unsupported body fields are rejected, including identity and evaluator overrides. A repeated submit does not create another evaluation. After a conflict, reload the attempt before deciding the next action. HTTP request deduplication that returns a prior successful response is not implemented yet.

The parser keeps Express's default 100 KB transport limit. The separate submission budget is 6,000 characters across all five sections, and the provider request caps output at 1,200 tokens. Responses use `Cache-Control: no-store`, including polling and errors.

## Current limits and validation

- Health checks whether the HTTP server responds; it does not certify database or provider availability.
- Startup initializes the agreed rubric and Parking Lot (`parking-lot`), Vending Machine (`vending-machine`), and Library Management (`library-management`). All three use problem version `1` and rubric version `1`. Repeated startup retains identical saved versions.
- The server queues work with evaluator ID `gemini` and runs one sequential background worker. Startup loads the Gemini key from the environment or project `.env`; queued work can then make real requests. Interrupted evaluations are marked failed during restart recovery. Failures remain saved until a learner explicitly requests a retry; there are no automatic provider retries.
- The compiled React interface is served at `/`; its browser routes use URL hashes. API paths keep their JSON errors, and only compiled `/assets` files are exposed. Draft deletion, authentication, problem administration, and pagination are not implemented.
- `npm run check` passes TypeScript and 146 tests. The 17 route tests and 13 worker/runtime tests cover API behaviour, submission limits, background completion, manual retry, shutdown, and restart recovery using isolated databases. Feedback is simulated locally; the tests spend no API quota.
- Nine additional browser tests pass through the actual React interface, API, SQLite repository, and simulated worker. The separate `npm run demo` preview is labelled as simulated and uses its own database.

Implementation references: [Express 5 API](https://expressjs.com/en/5x/api/) and [Express error handling](https://expressjs.com/en/guide/error-handling/).
