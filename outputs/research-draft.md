# Research note: evidence-backed LLD practice

Initial desk-research draft, 13 October 2026. Public product pages and documentation were reviewed; this is not a hands-on evaluation of paid features or a user study. The product direction below is a hypothesis to validate through a working prototype.

## Learner problem

Low-level design practice asks learners to reason about responsibilities, object interactions, interfaces, and change. Multiple designs can meet the same requirements. A working implementation alone does not explain whether responsibilities are cohesive, whether dependencies are appropriate, or how a design responds to new requirements.

Our target learner knows basic object-oriented programming and wants to practise an interview-sized design. The useful outcome is an explanation of what to retain, what to improve, and why. A submission therefore needs more evidence than a class-name list: assumptions, responsibilities, one interaction, edge cases, and trade-offs.

## Existing approaches

| Approach | Publicly documented behaviour | Implication for our MVP |
| --- | --- | --- |
| Hello Interview LLD Guided Practice | A problem catalogue with step-by-step practice and personalised feedback; some entries expose Start and History actions. | Problem selection, guided thinking, feedback, and history are already an established product direction. Our prototype should demonstrate a focused implementation, without claiming this loop is novel. [1] |
| Educative's Grokking LLD course | The public course overview describes OOP/design principles, real-world case studies, diagrams, and mock interviews. | Reference examples and structured learning are useful context. Our MVP focuses on applying and revising the learner's own design. The public page alone does not establish every feedback capability of the course. [2] |
| Exercism feedback | Automated feedback accompanies submitted iterations; volunteer mentors can give targeted feedback and discussion, with a wait that can reach hours or days. Exercism is general coding practice rather than a dedicated LLD platform. | Separate checks that can run deterministically from judgement-heavy review, and preserve iterations so feedback leads to another attempt. [3] |

Exercism's mentoring guidance recommends explaining why a change helps and prioritising one to three improvements per iteration. This supports a concise feedback screen that helps the learner decide what to change next. [4]

## Opportunity and limits of the evidence

These sources do not prove that existing products lack evidence-backed feedback or attempt comparison. Instead, they suggest useful principles for a small prototype: structured submissions, visible history, actionable explanations, and a clear separation between automatic checks and design judgement.

The specific hypothesis is that learners benefit when feedback cites their submitted reasoning and the next attempt opens with a short improvement checklist. A simple demo can show this interaction; actual learning gains would require user research and repeated use.

## Product direction

Build a narrow practice loop with three LLD problems and one structured text format. Ask learners to provide requirements/assumptions, classes/responsibilities, relationships/interactions, edge cases/tests, and trade-offs. Accept pseudocode as supporting evidence without compiling or running it.

For evaluation, deterministic validation checks whether the submission is complete enough to review. A rubric-based evaluator then considers the design's reasoning. Where an LLM is used, require evidence for concerns, a concrete suggestion, and a confidence or insufficient-evidence signal. A valid alternative design should not lose credit simply because it differs from a reference solution.

The feedback view should show strengths and no more than three priority improvements alongside criterion details. For example, if the learner assigns parking allocation, pricing, and payment processing to one class, feedback should cite that statement, explain how it affects change or testing, and suggest a smaller responsibility boundary. This is an illustrative feedback example, not an observation about a researched product.

Preserve each submission and its evaluation. Let the learner create a new draft from an earlier attempt, then review the two versions and their feedback. Any score change should be described cautiously because model variability and rubric changes can affect comparisons.

## Questions to validate

- Can a learner express a meaningful design using the structured fields without needing a diagram editor?
- Can they explain why each priority suggestion applies to their design?
- Does the evaluator accept two different, defensible solutions to the same problem?
- Does the retry flow preserve work and make the next step obvious after a provider failure?

Before final submission, test the prototype with contrasting example designs and, if possible, ask a learner to complete one practice/revision cycle. Report this honestly as prototype validation rather than a formal study.

## Sources

1. [Hello Interview: Low-Level Design Guided Practice](https://www.hellointerview.com/practice/low-level-design). Public catalogue reviewed 13 October 2026.
2. [Educative: Grokking the Low Level Design Interview Using OOD Principles](https://www.educative.io/courses/grokking-the-low-level-design-interview-using-ood-principles). Public course description reviewed 13 October 2026.
3. [Exercism: Getting Feedback](https://exercism.org/docs/using/feedback). Documentation reviewed 13 October 2026.
4. [Exercism: How to give great feedback](https://exercism.org/docs/mentoring/how-to-give-great-feedback). Documentation reviewed 13 October 2026.
