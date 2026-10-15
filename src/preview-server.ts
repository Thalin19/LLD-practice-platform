import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Evaluator } from './application/ports/evaluator.ts';
import { EvaluationError } from './application/evaluation-errors.ts';
import { SECTION_IDS } from './domain/design.ts';
import { SqlitePracticeRepository } from './infrastructure/sqlite/practice-repository.ts';
import { seedCatalogue } from './infrastructure/sqlite/seed-catalogue.ts';
import { startServer } from './runtime/start-server.ts';

// This entry point never imports Groq configuration or reads the real .env.
const rawPort = process.env.PREVIEW_PORT ?? '4173';
if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535)
  throw new Error('PREVIEW_PORT must be a valid local port.');
const repository = new SqlitePracticeRepository(
  process.env.PREVIEW_STORAGE === 'memory'
    ? ':memory:'
    : fileURLToPath(new URL('../work/preview/practice.sqlite', import.meta.url)),
);
seedCatalogue(repository);
const failedOnce = new Set<string>();
const evaluator: Evaluator = {
  id: 'groq',
  evaluate: async ({ submission, rubric }, signal) => {
    await delay(500, undefined, { signal });
    // Reserved fixture input for the browser failure/retry test, isolated to this simulated entry point.
    if (submission.sections.requirements.includes('[preview-failure]') && !failedOnce.has(submission.id)) {
      failedOnce.add(submission.id);
      throw new EvaluationError('PROVIDER_UNAVAILABLE');
    }
    return {
      assessments: rubric.criteria.map((criterion, index) => {
        const sectionId = SECTION_IDS[index]!;
        return {
          criterionId: criterion.id,
          label: index === 0 ? 'strong' : index === 4 ? 'insufficient_evidence' : 'needs_improvement',
          evidence:
            index === 4
              ? []
              : [
                  {
                    sectionId,
                    quote: Array.from(submission.sections[sectionId].trim()).slice(0, 90).join(''),
                  },
                ],
          explanation:
            'Simulated preview feedback illustrates how this criterion will be presented. It is not an AI assessment.',
          suggestion:
            'In a real evaluation, this space will contain a specific suggestion grounded in your design.',
        };
      }),
      priorityImprovements: [
        'Preview example: make the failure path explicit.',
        'Preview example: explain the responsibility boundary you chose.',
      ],
    };
  },
};
const runtime = await startServer({
  repository,
  evaluator,
  port: Number(rawPort),
  pollIntervalMs: 150,
  previewMode: true,
});
console.log(`Simulated preview ready at ${runtime.url}`);
console.log('Feedback is simulated. No credentials are loaded and no Groq requests are made.');
const stop = () => {
  void runtime.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
