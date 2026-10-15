# Successful live Gemini evaluation

On 15 October 2026 (Australia/Sydney), the candidate asked to resolve the failure and authorized another controlled check. The existing Gemini 3.8 Flash adapter, LOW thinking setting, rubric version 1, and 1,200-output-token cap were used without further runtime changes.

The request completed successfully: HTTP 200, finish reason STOP. The production evaluation processor validated all five criterion assessments, their literal evidence quotes, and the three priority improvements, then persisted a completed evaluation. Reopening the isolated SQLite database confirmed the saved completed run. Exactly one request was sent, with zero automatic retries.

Reported usage: 1,056 input tokens, 770 output tokens, 1,826 total tokens. No separate thinking-token count was reported. The output was below the 1,200-token cap.

## Feedback review

The result gave Strong for class responsibilities and edge cases/testability, and Needs improvement for requirements coverage, relationships/interfaces, and extensibility/trade-offs. Its recommendations about capacity by vehicle type, rate-change assumptions, and adding a vehicle type correspond to explicit parts of the Parking Lot statement. Its advice to define concrete method signatures is a coaching suggestion that should be reviewed for strictness in a structured-text exercise. Literal quote validation confirms grounding, not correctness of every judgement. This one example is a successful integration and feedback sanity check, not a broad evaluation of consistency or prompt-injection resistance.

## Failure explanation

The first failure was an unsupported MINIMAL thinking setting, corrected to LOW. The next live request returned HTTP 503 with an explicit high-demand message. This successful run used the same corrected configuration as the 503 run, consistent with that later failure being temporary provider overload. Availability can still vary.

The machine-readable result and complete feedback are in `outputs/gemini-recovery-check.json`. The test database is under `work/gemini-live-evaluation/recovery/`, separate from application and preview data. The guarded recovery script preserves its report and request marker, preventing an accidental second request when rerun. Earlier failure records are retained. No real application server was started as part of this check.
