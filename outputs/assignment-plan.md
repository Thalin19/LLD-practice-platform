# LLD Practice Platform: initial project plan

Status: proposed implementation direction, before coding.

## Assignment requirements

The assignment is a two-day engineering exercise. Build a focused experience in which a learner chooses an LLD problem, works on a solution, submits it, receives explainable feedback, reviews past attempts, and tries again. The platform's own domain behaviour must have clear classes, interfaces, and responsibilities.

Required deliverables:

- A 1-2 page research note covering learner problems, existing approaches, gaps, and product direction.
- A concise design note covering the MVP, user flow, domain model, evaluation approach, and trade-offs.
- A working end-to-end prototype with attempt history.
- Tests covering important behaviour and failure/edge cases.
- A README explaining setup, decisions, and limitations.
- AI_USAGE.md documenting 3-5 meaningful AI-assisted decisions, including what was accepted or rejected and why. Record decisions as they happen; do not invent candidate judgements after the fact.

Evaluation weights: research 15%, product thinking 15%, domain design 25%, feedback/evaluation 15%, extensibility/judgement 10%, implementation 10%, testing/reliability 5%, AI usage 5%.

The first three PDF pages contain the assignment. Pages 4-6 are an explicitly optional helping guide. Suggestions such as 3-5 problems, particular class names, text submissions, and a particular feedback shape are examples, not mandatory implementations. The assignment permits a simple monolith and does not prescribe a programming language. AI-assisted development is encouraged; AI-powered product feedback is optional.

The PDF describes a two-day time budget, not an explicit calendar deadline. Its submission form is a destination for the candidate's completed work, not an instruction to submit anything during planning.

## Proposed learner problem

A learner can describe a design but struggles to identify which decisions are defensible and what to change next. The product should preserve their reasoning, connect feedback to evidence, and make the next attempt easy.

## Proposed MVP

Use three problems: Parking Lot, Vending Machine, and Elevator. Each has explicit requirements, scope exclusions, and a small change scenario.

Use one structured text submission format:

1. Requirements and assumptions.
2. Classes/interfaces and their responsibilities.
3. Relationships and an example interaction.
4. Edge cases and testing approach.
5. Trade-offs and response to the change scenario.

Allow pseudocode inside these fields without executing it. This gives evidence of design reasoning while keeping the prototype manageable.

Flow: browse problems -> open requirements -> draft a design -> submit -> view evaluation status -> inspect feedback -> create a new attempt from the previous submission -> compare attempts.

The feedback screen should present strengths, evidence-backed concerns, and up to three priority improvements. A category score is a rough coaching signal, not an objective judgement of design quality. Do not treat one reference design or one named pattern as the only valid answer.

Exclude login, payments, leaderboards, collaborative editing, uploaded diagrams, and execution of candidate code from this MVP. A local demonstration can use one learner identity; describe that boundary in the README.

## Proposed stack

- React with TypeScript for the browser interface.
- Node.js with TypeScript for the backend and domain behaviour.
- SQLite for durable problems, submissions, evaluations, and attempt history.
- One application deployment, with evaluation work processed by the same backend process.

This keeps one language across the application while supporting explicit interfaces and domain objects. SQLite keeps setup small. Check supported package/runtime versions when implementation starts.

## Proposed responsibilities

| Component | Responsibility |
| --- | --- |
| Problem | Own the prompt, requirements, change scenario, and rubric version. |
| Attempt | Own a learner's draft and enforce its lifecycle. |
| Submission | Preserve an immutable snapshot of the submitted design and format version. |
| Evaluation | Track a particular evaluation run, result, provider, and failure information. |
| Rubric | Define criteria and scoring anchors independently of the provider. |
| PracticeService | Coordinate starting, saving, submitting, and retrying attempts. |
| SubmissionValidator | Validate the selected submission format before it is accepted. |
| Evaluator | Accept a problem, submission, and rubric; return a typed evaluation result. |
| Repository interfaces | Separate domain operations from SQLite storage. Add only interfaces needed by actual behaviour. |

Use a format discriminator and a format-specific validator for future diagram support. Keep the lifecycle independent of text field details. A later human or alternative automated evaluator can implement the evaluator boundary without replacing the practice flow; asynchronous human review may need a different work dispatcher.

## Evaluation approach

Deterministic checks establish whether a submission is valid: required fields, size limits, supported format, allowed state changes, and duplicate requests. They must not claim to prove design quality through keyword counts.

An optional LLM evaluator can analyse requirements coverage, responsibilities, relationships/coupling, encapsulation, extensibility, and edge cases/testability. Use fixed scoring anchors and structured results containing criterion, score, evidence, concern, suggestion, and confidence. Include an insufficient-evidence outcome.

Validate provider output before storing successful feedback, including criterion coverage, score bounds, and evidence references. Treat candidate text as untrusted data, not model instructions. Store submission, problem/rubric versions, and evaluator metadata so past feedback remains interpretable.

Without an API key, deterministic completeness feedback should remain usable and clearly labelled. Any fixture used to demonstrate richer feedback must be labelled as demo data, rather than presented as a live assessment.

## Reliability behaviour to implement

- Save the immutable submission and queued evaluation in one transaction before invoking an evaluator.
- Return the saved attempt and status promptly; let the browser poll while evaluation runs.
- Enforce transitions such as draft -> submitted -> evaluating -> completed/failed.
- Persist a submission request key; an identical duplicate returns the existing result, while the same key with different content is rejected.
- Atomically claim evaluation work, apply a timeout, and ignore late results from superseded runs.
- Preserve the submitted design when evaluation fails. Retry evaluation without silently creating another learner attempt.
- On process restart, recover queued work and handle abandoned in-progress work explicitly.
- Start another learning attempt by copying the previous submission into a new draft, preserving the original history.

## Validation and demo checklist

- Complete one successful practice flow and see it again after restarting the backend.
- Reject blank, oversized, malformed, or unsupported submissions.
- Verify duplicate/concurrent submission handling and illegal state changes.
- Simulate provider failure, timeout, malformed output, and retry.
- Verify that stale work cannot overwrite a newer evaluation result.
- Verify that a second evaluator implementation can be substituted without changing the practice service.
- Demonstrate editing a new attempt while preserving the prior submission and feedback.

## Two-day sequence

Day 1: finish the small research note, choose the rubric and submission fields, implement domain behaviour with tests, add persistence and backend endpoints, and connect a minimal practice interface.

Day 2: connect evaluation, verify failures and recovery, add history/retry/comparison, polish the interface, finish the design note and README, record AI decisions, and rehearse the demo.

The immediate next implementation milestone is one complete Parking Lot attempt saved to SQLite, using a test evaluator. Expand to all three problems and real evaluation only after that loop works.
