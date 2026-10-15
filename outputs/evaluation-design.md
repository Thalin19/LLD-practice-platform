# Evaluation prompt and usage policy

The candidate approved these rules before implementation: require all five sections locally, cap total submitted text at 6,000 characters, make one provider request per evaluation, request at most 1,200 output tokens, ground feedback in quotations, treat submitted instructions as data, and retry only on a learner's explicit request.

## Input validation

`src/domain/design.ts` enforces completeness and the character limit before creating a submission. Characters are Unicode code points, including spaces and newlines; the count is combined across all five sections. Drafts can remain incomplete or exceed the cap while editing. Submission errors preserve saved draft text and identify an over-budget answer through `issues.totalLength`.

The evaluation request builder rechecks those rules before any provider request and verifies that the problem ID/version and rubric version match the saved submission. It sends that historical context, not a newer catalogue version. The 6,000-character cap applies only to answer text. Problem instructions, rubric, prompt, and output schema also consume input tokens; characters are not an exact token measurement.

## Prompt and output

The canonical prompt, currently version 1, is `EVALUATION_SYSTEM_PROMPT` in `src/application/evaluation-prompt.ts`. The system message supplies the coaching instructions and trusted problem/rubric context. A separate user message contains JSON-encoded submitted sections. Learner IDs, prior attempts, and prior feedback are omitted.

The prompt asks the model to assess each of the five criteria exactly once with the agreed labels. Strong and Needs improvement require a short exact quotation and its section ID. Insufficient evidence may have no quotation but must explain the missing detail. Each assessment includes a concise explanation and actionable suggestion, followed by at most three priority improvements overall. It asks for no scores, replacement solution, or extra commentary and does not prescribe particular patterns or class names.

Instructions inside the learner's answer are explicitly designated as untrusted data. JSON encoding preserves that text without creating additional message roles. This helps define the trust boundary, but offline tests cannot establish that a live model will always resist prompt injection.

The active adapter uses `gemini-3.8-flash` with `candidateCount: 1`, `maxOutputTokens: 1200`, and `thinkingLevel: "LOW"`. Thinking text is not requested and is ignored if returned. LOW is the lowest documented supported level for this model; thinking is not disabled. The request sends trusted instructions through `systemInstruction`, answer JSON through one user content message, and the shared JSON schema through `generationConfig.responseFormat.text`. Criterion coverage, valid labels, literal evidence, and priority limits are checked locally even when the provider returns schema-constrained JSON.

Request and response fields follow Google's [generateContent API reference](https://ai.google.dev/api/generate-content), [structured output guide](https://ai.google.dev/gemini-api/docs/structured-output), and [thinking settings](https://ai.google.dev/gemini-api/docs/gemini-3). Gemini 3.8 Flash currently offers [free-tier input/output pricing](https://ai.google.dev/gemini-api/docs/pricing); the candidate must use a Free Tier project with billing disabled. The application cannot infer that billing status from the key. Per-project [quotas](https://ai.google.dev/gemini-api/docs/rate-limits) may still produce HTTP 429.

The earlier Groq adapter and authorized HTTP 429 check are retained as historical records, with no fallback to Groq. See `outputs/live-evaluation-check.md`. One authorized Gemini evaluation returned HTTP 400, saved as PROVIDER_REJECTED with no feedback or reported token usage. A separately approved diagnostic request identified unsupported MINIMAL thinking as the cause. LOW is now configured and offline-tested. A separately authorized corrected live verification returned HTTP 503, with the provider explicitly reporting high demand. It saved PROVIDER_UNAVAILABLE with no feedback or reported usage; see `outputs/gemini-corrected-live-check.md`. A later authorized recovery check succeeded with HTTP 200 and five validated assessments, persisted by the production processor; see `outputs/gemini-recovery-check.md`. Neither check automatically retried. See `outputs/gemini-diagnostic-check.md`. See `outputs/gemini-live-evaluation-check.md`; the request/schema worked for the successful sample, while broader judgement quality remains unevaluated.

## Request and failure handling

`GeminiEvaluator` takes its API key explicitly and accepts an injected transport for tests. It makes one fetch request to the fixed Gemini generateContent endpoint, with the key in the x-goog-api-key header rather than the URL. It does not load `.env`, use an SDK retry policy, follow redirects, request output repair, or fall back to another model.

Requests have a 30-second default timeout and support cancellation. Provider authentication failures, quota/rate limits, unavailable service, refused requests, malformed feedback, and output truncation become safe typed failures. A candidate with MAX_TOKENS or CONTINUATION is rejected even if its content parses; the adapter never sends a continuation request. Prompt blocks and safety/refusal finish reasons become refusal failures. Exactly one completed candidate is required; visible text parts are joined and non-text payloads are rejected. Provider error bodies and raw exceptions are not included in saved failure messages.

`EvaluationProcessor.processNext` atomically claims one queued run, loads its saved submission/problem/rubric, invokes the configured evaluator once, and saves validated feedback or a failure. Its persistence write retains revision checks, so a late result cannot overwrite a failure saved by another coordinator. Provider calls run outside database transactions.

Calling the processor again does not rerun a failed or completed evaluation. A learner must use the existing retry action to create a new queued run linked to the failed run and original submission. No automatic retry, repair, or background requeue is implemented. A failed request may already have consumed provider quota; retrying is a new request, not a reversal of the earlier one.

## Validation and remaining work

All 146 tests and TypeScript checks pass. The 25 evaluation/limit tests cover boundary lengths, Unicode counting, request structure, instruction/data separation, zero-call rejection of invalid inputs, simulated provider failures, timeout/cancellation, truncated or invalid feedback, manual retries, competing processors, original versions, and late writes. An HTTP test verifies that an over-budget draft can be saved, rejected on submit, shortened, and submitted successfully. The 13 worker/runtime tests additionally cover sequential processing, persistence across restart, atomic recovery, shutdown, API integration, and fixture-only credential loading.

The 18 Gemini tests add provider request/header checks, thought-part parsing, blocked prompts, continuation rejection, configuration without Groq fallback, and an HTTP submission/manual-retry round trip through the worker.

Every provider test injects fake responses and an offline placeholder key. No real key is read and no provider quota is consumed. Prompt construction and application behaviour have been tested; actual model judgment and injection resistance remain untested.

The API server now connects this processor to a sequential worker and loads the key during startup. It automatically processes never-started queued work and marks interrupted runs failed for manual retry. See `outputs/worker-design.md` for the lifecycle. Feedback integration has been tested with simulated responses and one successful live Gemini request through the production processor. Earlier live checks exercised safe failures. The successful sample used 1,056 input and 770 output tokens, 1,826 total, and its completed state was confirmed after reopening SQLite. This does not establish broad feedback quality or prompt-injection resistance.
