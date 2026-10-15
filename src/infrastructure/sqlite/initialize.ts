import { fileURLToPath } from 'node:url';
import { seedCatalogue } from './seed-catalogue.ts';
import { SqlitePracticeRepository } from './practice-repository.ts';

const filename = fileURLToPath(new URL('../../../data/practice.sqlite', import.meta.url));
const repository = new SqlitePracticeRepository(filename);
try {
  seedCatalogue(repository);
  console.log(`Database ready: ${filename}`);
  console.log('Five tables, the agreed rubric, and three practice problems are ready. No learner attempts have been seeded.');
} finally {
  repository.close();
}
