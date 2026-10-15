# Demo walkthrough

Allow approximately 5-7 minutes for the main walkthrough. The simulated preview demonstrates the practice loop without API quota. Its feedback is explicitly labelled as simulated. The [saved live Gemini result](gemini-recovery-check.md) provides separate evidence that the real adapter and processor produced validated, persisted feedback.

## Start the preview

Open a terminal in the project root: the folder containing `package.json` and `README.md`. Use Node.js 24.12 or newer.

Install dependencies once for a fresh checkout:

```sh
npm ci
```

Then start the preview:

```sh
npm run demo
```

On Windows PowerShell, use `npm.cmd` in place of `npm` if script execution is restricted. Open [the preview](http://127.0.0.1:4173). If it is already running, use that instance. Stop it with Ctrl+C when finished.

## 1. Select a problem and explain the scope

Show the three problems: Parking Lot, Vending Machine, and Library Management. Choose **Start practice** on Parking Lot.

Point out the requirements, problem version, and **What your feedback covers** section. Explain that the learner supplies five sections of design reasoning. The rubric assesses the answer against this problem rather than requiring one reference implementation.

## 2. Demonstrate drafting and validation

Try **Submit for feedback** with an empty answer. Missing-section messages should appear and no evaluation should be queued.

Enter just the Requirements and assumptions sample below, then choose **Save draft**. Open **History**, filter by Parking Lot, and choose **Resume draft**. The saved text should remain. Fill the remaining fields with the sample answer.

The combined submission limit is 6,000 Unicode code points, including whitespace. Incomplete and over-budget drafts can be saved, but cannot be submitted. Saving is explicit.

## 3. Submit, review, and revise

Choose **Submit for feedback**. Any unsaved edits are saved first, then the accepted answer becomes read-only. The queued/evaluating state may pass quickly in preview mode.

Show all five assessments, their explanations and suggestions, the quotations, and **Where to go from here**. Explain that this preview feedback demonstrates the interface and state handling; it does not assess the sample's quality.

Choose **Revise design**. Confirm that a separate, editable attempt opens with the submitted text prefilled. Add a capacity-reporting or rate-change assumption, then save the draft. Use **View the original attempt** to show that the first answer and feedback remain unchanged.

## 4. Show durable history

Open **History** and show the original submission and revision draft. Review the original and resume the revision.

If time permits, stop the preview and run `npm run demo` again. History persists in `work/preview/practice.sqlite`; reopening the revision should retain its saved edits. This uses the normal file-backed preview, not the in-memory configuration reserved for browser tests.

## 5. Demonstrate a failed evaluation and manual retry

In the preview, start another Parking Lot attempt and fill all five fields. Append `[preview-failure]` to Requirements and assumptions, then submit.

The simulated evaluator fails the first run for that submission. Show that the submitted answer remains saved and read-only. Choose **Retry evaluation** once. The second run should complete, and the **Evaluation run** selector should retain both the failed and completed runs. Retrying evaluates the same answer; revising creates a new editable attempt.

This marker is a preview-only test fixture. Complete this failure/retry sequence before restarting the preview because its fail-once tracking resets on restart. It does not control real Gemini behaviour.

## Sample Parking Lot answer

This short sample was used in the successful live check. It is intentionally incomplete enough to invite useful coaching; it is not a reference solution or a promised set of assessment labels.

### Requirements and assumptions

```text
One lot with matching motorcycle/car spots. Reject full capacity, duplicate active vehicles, and invalid tickets. Round fees up to started hours with a one-hour minimum. Release the spot only after successful payment.
```

### Classes and responsibilities

```text
ParkingLot owns allocation. Spot owns occupancy and vehicle type. Ticket records vehicle, spot, entry time, and status. PricingPolicy computes fees. PaymentGateway charges. Clock supplies time.
```

### Relationships and interactions

```text
Entry locks allocation, finds a free matching spot, reserves it, and issues a ticket. Exit finds the active ticket, computes the fee, pays, then closes the ticket and releases the spot. Failed payment keeps the ticket and occupancy. Repeated exit returns an error without charging.
```

### Edge cases and testing

```text
Use fake clock and payment implementations. Test full or mismatched capacity, duplicate entry and exit, failed payment, 59/60/61-minute fee boundaries, and simultaneous allocations.
```

### Design trade-offs

```text
A single-process lock keeps allocation atomic. A pricing interface supports new rate policies. The lock does not coordinate multiple processes; persistent transactions would replace it if that scope were introduced.
```

## Optional live demonstration

Follow [the README's live setup](../README.md#run-with-live-gemini-feedback), then open [the real application](http://127.0.0.1:3000). It uses `data/practice.sqlite`, separate from preview and live-check data. Existing isolated check results will not appear in its History.

Use one fresh Parking Lot attempt and submit the sample once. Wait for feedback or a saved failure. Each explicit submission or evaluation retry can consume provider quota. Browsing, saving drafts, and polling status do not create provider requests. To demonstrate revision without a second model request, create and save a revision draft without submitting it.

Live feedback can vary. The previous successful check returned five validated assessments with 770 output tokens and 1,826 total reported tokens. A current request is not guaranteed to produce the same labels or usage. If Gemini is unavailable or rate-limited, demonstrate the saved failure and work preservation, then use the preview and [existing live evidence](gemini-recovery-check.md). Avoid repeated live retries during the demo.

## Explain the design and its limits

Use the [design note](design-note.md) to explain editable Attempt versus immutable Submission, separate Evaluation runs, the evaluator interface, and atomic submission storage. Local validation checks completeness and feedback structure; the LLM supplies design judgement. Literal quotations improve traceability but cannot prove a judgement is correct.

The prototype has one demo learner, explicit draft saves, one application process per database, and a sequential evaluation worker. It rejects duplicate/stale writes but does not replay an earlier success for repeated HTTP requests. A restart preserves terminal history, marks interrupted evaluations failed for manual retry, and allows queued work to proceed. These behaviours are covered by automated tests; the walkthrough does not require causing a real crash.

## Expected evidence

The demonstration should show a saved draft, a submitted answer and its feedback, a distinct revision with preserved original history, and a failed evaluation with a separate retry run. The preview supplies reliable interaction examples; the saved live report supplies one real provider result. See [the test commands and recorded validation](../README.md#validation) for the automated evidence.
