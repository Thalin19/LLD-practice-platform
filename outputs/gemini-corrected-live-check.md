# Corrected Gemini live verification

On 15 October 2026 (Australia/Sydney), the candidate authorized one live verification after the thinking setting was corrected from unsupported MINIMAL to LOW. The check used the production Gemini evaluator and evaluation processor, the same 1,087-character Parking Lot sample, prompt/problem/rubric version 1, and the existing 1,200-output-token cap. Data was kept in an isolated database under `work/gemini-live-evaluation/corrected/`.

Result: **HTTP 503**, provider status `UNAVAILABLE`. Google reported:

> This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.

The application persisted a failed evaluation with safe code `PROVIDER_UNAVAILABLE`. Exactly one request was made, with zero automatic retries, repairs, or fallback requests. No feedback or token usage was reported. Unknown usage is not proof of zero consumption. This response identifies current provider unavailability; it does not verify complete request compatibility or feedback quality.

The sanitized evidence is saved in `outputs/gemini-corrected-live-check.json`. Credentials and raw error bodies are excluded. The new check has its own exclusive request marker and report guard; prior check evidence and guards remain intact. Rerunning the script will not send again. Three Gemini calls have been authorized and sent across the initial check, the diagnostic, and this corrected verification.

The LOW correction passed all 146 offline tests, TypeScript checks, and the build before this live verification. No additional implementation change was made in response to the service's high-demand error. Further live attempts require separate authorization.
