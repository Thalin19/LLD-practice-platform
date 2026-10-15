import { fileURLToPath } from 'node:url';
import { GeminiEvaluator } from './infrastructure/gemini/evaluator.ts';
import { seedCatalogue } from './infrastructure/sqlite/seed-catalogue.ts';
import { SqlitePracticeRepository } from './infrastructure/sqlite/practice-repository.ts';
import { loadServerConfig } from './runtime/config.ts';
import { startServer } from './runtime/start-server.ts';

let repository: SqlitePracticeRepository | undefined;
try {
  const config = loadServerConfig();
  const evaluator = new GeminiEvaluator({ apiKey: config.apiKey });
  const filename = fileURLToPath(new URL('../data/practice.sqlite', import.meta.url));
  repository = new SqlitePracticeRepository(filename);
  seedCatalogue(repository);
  const runtime = await startServer({ repository, evaluator, port: config.port, onFatalError: () => {
    console.error('The background worker or API encountered a fatal error. Restart the server after resolving the problem.');
    process.exitCode = 1;
  } });
  console.log(`Practice API ready at ${runtime.url}/api/health`);
  console.log('Background evaluation is enabled. Each queued evaluation makes at most one Gemini request.');
  if (runtime.recoveredCount > 0) console.log(`${runtime.recoveredCount} interrupted evaluation(s) marked failed for manual retry.`);
  const stop = () => {
    void runtime.close().catch(() => {
      console.error('The server could not finish shutdown cleanly.');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  repository?.close();
  if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
    console.error('The API port is already in use. Stop the existing server before starting another.');
  } else {
    console.error('The API could not start. Check PORT, GEMINI_API_KEY, the project .env file, and database access.');
  }
  process.exitCode = 1;
}
