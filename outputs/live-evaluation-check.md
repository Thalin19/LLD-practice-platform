# One-shot live evaluation check

The candidate authorized one live Parking Lot evaluation, using the current problem, rubric, prompt, strict response schema, and 1,200-output-token cap. The request used the existing Groq adapter and evaluation processor. The sample was stored in an isolated check database, separate from both the real application database and simulated preview data.

Result: **Groq returned HTTP 429.** The application saved the run as failed with code `PROVIDER_RATE_LIMIT`. No accepted feedback was produced and no automatic retry, repair, model fallback, or second request was made.

The provider returned no usage totals for this failed request. Prompt, completion, and total token usage are therefore unknown, not zero. The available result does not establish whether the limit was per minute, per day, or another provider quota, nor when it resets.

The request did not establish live prompt/schema compatibility or feedback quality. The previously passing offline and browser tests still cover simulated evaluation, safe failure handling, and manual retry behaviour.

The machine-readable result, sample sections, request count, and safe failure metadata are in `outputs/live-evaluation-check.json`. No credentials or raw provider error bodies are included. `scripts/live-evaluation-check.ts` is excluded from normal test/server execution and guarded against repeated requests: if a report or request marker exists, running it again does not send another request. Another live attempt requires separate authorization and a deliberate new check.

The implementation and submission documentation can continue offline while live evaluation remains unverified.
