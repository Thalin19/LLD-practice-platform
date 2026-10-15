import type { PracticeRepository } from '../../application/ports/practice-repository.ts';
import { PRACTICE_PROBLEMS } from '../../content/problems.ts';
import { DEFAULT_RUBRIC } from '../../domain/rubric.ts';

/** Existing identical versions are retained; conflicting published versions are rejected. */
export function seedCatalogue(repository: Pick<PracticeRepository, 'putRubric' | 'putProblem'>): void {
  repository.putRubric(DEFAULT_RUBRIC);
  for (const problem of PRACTICE_PROBLEMS) repository.putProblem(problem);
}
