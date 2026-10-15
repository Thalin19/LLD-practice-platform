# One-shot Gemini live evaluation check

On 15 October 2026 (Australia/Sydney), the candidate authorized exactly one live evaluation using Gemini 3.8 Flash. The check submitted a 1,087-character Parking Lot design with all five required sections, the saved problem/rubric versions, prompt version 1, and the 1,200-output-token cap. It used an isolated check database, separate from application and preview data.

Result: **HTTP 400**, saved as failed with code `PROVIDER_REJECTED`. No accepted feedback was saved. Exactly one request was made, with no automatic retry, repair, continuation, or model fallback.

No token usage was reported. Usage is unknown, not confirmed zero. HTTP 400 does not establish a quota failure; the earlier Groq check returned HTTP 429. Google's [troubleshooting guide](https://ai.google.dev/gemini-api/docs/troubleshooting) recommends investigating client errors instead of blindly retrying.

The adapter discards provider error bodies to keep private data out of saved failures. Consequently, this report cannot determine whether the rejection concerned request parameters, credentials, or project configuration. Reviewing the documented request format offline did not establish an exact cause. A future diagnostic must safely inspect the provider error, excluding credentials and submitted text, before deciding on a correction. No further live call was made.

The machine-readable result is in `outputs/gemini-live-evaluation-check.json`. The exclusive request marker and saved report prevent the check script from sending another request if rerun. No guard was reset. Live compatibility and feedback quality remain unverified. All 146 offline tests, TypeScript checks, and the build passed before this check.

A separately authorized later diagnostic identified the cause as unsupported MINIMAL thinking. The adapter was corrected to LOW without another live call. See `outputs/gemini-diagnostic-check.md`; the initial JSON evidence is unchanged.
