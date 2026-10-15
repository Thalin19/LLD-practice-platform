# AI usage

AI assisted research, design discussions, implementation, tests, and documentation. The candidate required permission for work and retained architectural decisions. The reasons below reflect rationales discussed during those decisions; they do not claim independent research or user studies by the candidate. The [complete development record](outputs/ai-usage-history.md) preserves the earlier chronological notes, including intermediate failures and validation limits.

## 1. Structured text and a focused practice flow

**Suggestion:** Compare text, code, diagrams, and combinations; capture design reasoning in five sections and support problem selection, practice, and history.

**Decision and reason:** The candidate chose structured text and approved all five required sections, the three screens, revisions, and manual retries. The proposed rationale was to retain assumptions, responsibilities, interactions, edge cases, and trade-offs while keeping implementation manageable. AI implemented the approved interface; browser tests exercise the practice flow with labelled simulated feedback.

## 2. Assessment labels with deterministic rules and an LLM

**Suggestion:** Compare feedback styles and separate completeness checks from design judgement, using a fixed rubric and evidence from the submitted answer.

**Decision and reason:** The candidate selected Strong, Needs improvement, and Insufficient evidence; rules plus an LLM; and the five rubric criteria. Labels avoid implying numerical precision, while explanations and quotations help learners interpret a judgement. Local validation checks criterion coverage, labels, literal evidence, and priority limits. It cannot prove that a model's reasoning is correct; broader quality and injection-resistance checks remain pending.

## 3. Modular monolith and explicit domain behaviour

**Suggestion:** Use React/TypeScript, Node/Express, and SQLite, with Problem, Attempt, Submission, Evaluation, and Rubric objects behind repository and evaluator interfaces.

**Decision and reason:** The candidate approved this architecture, five tables, JSON answer/feedback fields, and atomic submission storage. Editable attempts, immutable submissions, and evaluation runs give revision and retry distinct meanings. The boundaries allow provider changes and isolated tests while keeping deployment simple. AI implemented the approved model and tests for lifecycle rules, rollback, immutable history, and stale writes.

## 4. Save before background evaluation; keep retries explicit

**Suggestion:** Persist submitted work before evaluation, expose its status, preserve failures, and distinguish evaluating the same answer again from revising it.

**Decision and reason:** The candidate accepted these behaviours, chose one demo learner after discussing authentication scope, and approved the background worker and restart recovery. The aim was to focus on the practice loop and protect answers when evaluation is slow or fails. Interrupted runs require manual retry because a crash cannot establish whether the provider already processed the request. AI implemented sequential processing, polling, cancellation, and recovery with offline integration tests.

## 5. Zero-spending provider choice and bounded usage

**Suggestion:** Research free-tier providers, initially use Groq, and limit evaluation input, output, and retries.

**Decision and reason:** The candidate explicitly rejected spending, chose Groq initially, then requested and approved Gemini 3.8 Flash after a Groq quota failure. The candidate created keys privately and approved a 6,000-character submission cap, one request per run, a 1,200-output-token cap, and manual retries only. Free Tier projects with billing disabled are the intended setup; the app cannot verify billing status.

AI initially configured unsupported MINIMAL thinking. An authorized diagnostic identified the error; it was corrected to LOW. A later provider-overload failure was preserved. A separately authorized live check then succeeded with five validated, persisted assessments and 770 output tokens. These mistakes and results are retained in the full record. No automatic retry or fallback was added.

The latest completed checks passed 146 offline backend tests, TypeScript checks, and the build; nine browser tests previously passed with simulated feedback. One successful live example supports integration, not broad claims about feedback quality. The candidate should review this record and the implementation before submission.
