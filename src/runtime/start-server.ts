import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { EvaluationProcessor } from '../application/evaluation-processor.ts';
import { PracticeService } from '../application/practice-service.ts';
import type { Evaluator } from '../application/ports/evaluator.ts';
import type { PracticeRepository } from '../application/ports/practice-repository.ts';
import { createApp } from '../http/app.ts';
import { EvaluationWorker } from '../infrastructure/worker/evaluation-worker.ts';

interface StartServerOptions {
  readonly repository: PracticeRepository;
  readonly evaluator: Evaluator;
  readonly port: number;
  readonly pollIntervalMs?: number;
  readonly onFatalError?: () => void;
  readonly webDirectory?: string;
  readonly previewMode?: boolean;
}

/** Owns the supplied repository until close; starts recovery only after the port is acquired. */
export async function startServer(options: StartServerOptions) {
  const { repository, evaluator } = options;
  const service = new PracticeService(repository, {
    learnerId: 'demo-learner',
    evaluatorId: evaluator.id,
    createId: (kind) => `${kind}-${randomUUID()}`,
  });
  const server = createServer(
    createApp(service, {
      webDirectory: options.webDirectory ?? fileURLToPath(new URL('../../dist/', import.meta.url)),
      previewMode: options.previewMode ?? false,
    }),
  );
  let closePromise: Promise<void> | undefined;
  const worker = new EvaluationWorker(repository, new EvaluationProcessor(repository, evaluator), {
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    onFatalError: () => {
      options.onFatalError?.();
      void close().catch(() => {
        /* Caller is already notified of the fatal state. */
      });
    },
  });

  function close(): Promise<void> {
    closePromise ??= (async () => {
      const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      const forceClose = setTimeout(() => server.closeAllConnections(), 5_000);
      forceClose.unref();
      try {
        await Promise.all([worker.stop(), httpClosed]);
      } finally {
        clearTimeout(forceClose);
        repository.close();
      }
    })();
    return closePromise;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      server.once('error', fail);
      server.listen(options.port, '127.0.0.1', () => {
        server.off('error', fail);
        resolve();
      });
    });
    server.on('error', () => {
      options.onFatalError?.();
      void close().catch(() => {});
    });
    const recoveredCount = worker.start();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The API did not acquire a local port.');
    return Object.freeze({ url: `http://127.0.0.1:${address.port}`, worker, recoveredCount, close });
  } catch (error) {
    await close();
    throw error;
  }
}
