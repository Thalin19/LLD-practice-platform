# Gemini request rejection diagnosis

On 15 October 2026 (Australia/Sydney), the candidate explicitly authorized one diagnostic request after the initial HTTP 400 result. The diagnostic repeated the same bounded Parking Lot evaluation request, inspected the error privately, and saved only sanitized diagnostic fields. It made one request and no retries. Both historical check guards remain intact.

Google returned HTTP 400, provider status `INVALID_ARGUMENT`, and the message:

> Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.

The confirmed cause is the adapter's unsupported `thinkingLevel: MINIMAL` setting. This response identifies a request-configuration error; it does not establish a quota, billing, or key problem. Google's [thinking model table](https://ai.google.dev/gemini-api/docs/thinking) lists low, medium, and high for Gemini 3.8 Flash. The earlier generic Gemini 3 guidance was insufficiently specific for this model.

The adapter is corrected to `LOW`, the lowest documented supported level. The existing 1,200-output-token cap, one candidate, no thought summaries, local feedback validation, and manual-retry-only policy are retained. No provider or model change was made. Offline checks verify the corrected request. The corrected request has not yet been tested live; this diagnosis does not establish that all other parameters will be accepted or that live feedback quality is adequate. No further live request was made.

The sanitized machine-readable evidence is in `outputs/gemini-diagnostic-check.json`. It excludes credentials and raw error bodies. The diagnostic script is excluded from normal test/startup execution and uses its own exclusive marker to prevent accidental resends. Two Gemini calls have been authorized and sent across the initial check and this diagnostic.

A subsequent separately authorized verification with LOW returned HTTP 503 and an explicit provider high-demand message. No feedback or usage was reported and no retry was made. See `outputs/gemini-corrected-live-check.md`.
