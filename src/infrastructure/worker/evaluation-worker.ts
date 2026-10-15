import { setTimeout as delay } from 'node:timers/promises';
import { EvaluationError } from '../../application/evaluation-errors.ts';
import type { EvaluationProcessor } from '../../application/evaluation-processor.ts';
import type { PracticeRepository } from '../../application/ports/practice-repository.ts';

type WorkerStatus = 'idle' | 'running' | 'stopping' | 'stopped' | 'failed';
interface WorkerOptions {
  readonly pollIntervalMs?: number;
  readonly onFatalError?: () => void;
}

/** One sequential worker per application database; it never requeues failed runs. */
export class EvaluationWorker {
  readonly #repository: PracticeRepository;
  readonly #processor: EvaluationProcessor;
  readonly #interval: number;
  readonly #onFatalError: () => void;
  readonly #controller = new AbortController();
  #status: WorkerStatus = 'idle';
  #task: Promise<void> | null = null;

  constructor(repository: PracticeRepository, processor: EvaluationProcessor, options: WorkerOptions = {}) {
    this.#repository = repository;
    this.#processor = processor;
    this.#interval = options.pollIntervalMs ?? 1_000;
    this.#onFatalError = options.onFatalError ?? (() => {});
    if (!Number.isSafeInteger(this.#interval) || this.#interval < 1 || this.#interval > 2_147_483_647) {
      throw new Error('Worker polling interval must be a positive integer within the timer range.');
    }
  }

  get status(): WorkerStatus { return this.#status; }

  start(): number {
    if (this.#status !== 'idle') throw new Error('This worker has already started or stopped.');
    const failure = new EvaluationError('EVALUATION_INTERRUPTED');
    const recovered = this.#repository.failInterruptedEvaluations({ code: failure.code, message: failure.message });
    this.#status = 'running';
    this.#task = this.#run();
    return recovered;
  }

  async stop(): Promise<void> {
    if (this.#status === 'idle') { this.#status = 'stopped'; return; }
    if (this.#status === 'running') this.#status = 'stopping';
    this.#controller.abort();
    await this.#task;
  }

  async #run(): Promise<void> {
    const signal = this.#controller.signal;
    try {
      while (!signal.aborted) {
        await this.#processor.processNext(signal);
        if (signal.aborted) break;
        try { await delay(this.#interval, undefined, { signal }); }
        catch (error) { if (!signal.aborted) throw error; }
      }
    } catch {
      // A storage/coordinator failure is fatal; don't risk repeating a provider request.
      this.#status = 'failed';
      this.#onFatalError();
    } finally {
      if (this.#status !== 'failed') this.#status = 'stopped';
    }
  }
}
