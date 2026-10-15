import express, { type ErrorRequestHandler, type Request } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PracticeService } from '../application/practice-service.ts';
import { StorageError } from '../application/ports/practice-repository.ts';
import { DomainError, isRecord, requireText } from '../domain/errors.ts';
import { ASSESSMENT_LABELS } from '../domain/rubric.ts';
import { attemptDetailsResponse, attemptResponse, evaluationResponse } from './representations.ts';

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function bodyFields(request: Request, fields: readonly string[], optional = false): Record<string, unknown> {
  const hasBody =
    request.headers['transfer-encoding'] !== undefined ||
    (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0');
  if (optional && !hasBody) return {};
  if (!request.is('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.');
  }
  const body: unknown = request.body;
  if (!isRecord(body)) throw new DomainError('INVALID_INPUT', 'The request body must be a JSON object.');
  if (Object.keys(body).some((key) => !fields.includes(key))) {
    throw new DomainError('INVALID_INPUT', 'The request contains unsupported fields.');
  }
  for (const field of fields) {
    if (!Object.hasOwn(body, field)) throw new DomainError('INVALID_INPUT', `The request requires ${field}.`);
  }
  return body;
}

function expectedRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new DomainError('INVALID_INPUT', 'Expected revision must be a non-negative safe integer.');
  }
  return value;
}

function parameter(request: Request, name: string): string {
  return requireText(request.params[name], name);
}

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'The server could not complete this request.';
  let issues: Readonly<Record<string, string>> = {};
  if (error instanceof HttpError) {
    ({ status, code, message } = error);
  } else if (
    error instanceof DomainError &&
    (error.code === 'INVALID_INPUT' || error.code === 'INVALID_TRANSITION')
  ) {
    status = error.code === 'INVALID_INPUT' ? 400 : 409;
    ({ code, message, issues } = error);
  } else if (error instanceof StorageError && (error.code === 'NOT_FOUND' || error.code === 'CONFLICT')) {
    status = error.code === 'NOT_FOUND' ? 404 : 409;
    ({ code, message } = error);
  } else if (isRecord(error)) {
    if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'The request body is too large.';
    } else if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
      status = 415;
      code = 'UNSUPPORTED_MEDIA_TYPE';
      message = 'The request encoding is unsupported.';
    } else if (
      error.type === 'entity.parse.failed' ||
      error.type === 'request.aborted' ||
      error.type === 'request.size.invalid' ||
      error instanceof URIError
    ) {
      status = 400;
      code = 'INVALID_INPUT';
      message = 'The request could not be parsed.';
    }
  }
  response.status(status).json({ error: { code, message, issues } });
};

interface AppOptions {
  readonly webDirectory?: string;
  readonly previewMode?: boolean;
}

export function createApp(service: PracticeService, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('query parser', 'simple');
  app.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  // This transport limit is separate from the domain's 6,000-character submission cap.
  app.use(express.json({ strict: false }));

  app.get('/api/health', (_request, response) => {
    response.json({ data: { status: 'ok' } });
  });
  app.get('/api/problems', (_request, response) => {
    response.json({ data: service.listProblems() });
  });
  app.get('/api/problems/:id/versions/:version', (request, response) => {
    response.json({ data: service.getProblem(parameter(request, 'id'), parameter(request, 'version')) });
  });
  app.get('/api/rubrics/:version', (request, response) => {
    const rubric = service.getRubric(parameter(request, 'version'));
    response.json({
      data: { version: rubric.version, criteria: rubric.criteria, labels: ASSESSMENT_LABELS },
    });
  });
  app.post('/api/attempts', (request, response) => {
    const body = bodyFields(request, ['problemId', 'problemVersion']);
    const saved = service.startAttempt(
      requireText(body.problemId, 'Problem ID'),
      requireText(body.problemVersion, 'Problem version'),
    );
    response
      .location(`/api/attempts/${encodeURIComponent(saved.value.id)}`)
      .status(201)
      .json({ data: attemptResponse(saved) });
  });
  app.get('/api/attempts', (request, response) => {
    if (Object.keys(request.query).some((key) => key !== 'problemId')) {
      throw new DomainError('INVALID_INPUT', 'Only the problemId history filter is supported.');
    }
    const filter =
      request.query.problemId === undefined ? undefined : requireText(request.query.problemId, 'Problem ID');
    response.json({ data: service.listHistory(filter).map(attemptDetailsResponse) });
  });
  app.get('/api/attempts/:id', (request, response) => {
    response.json({ data: attemptDetailsResponse(service.getAttempt(parameter(request, 'id'))) });
  });
  app.patch('/api/attempts/:id/draft', (request, response) => {
    const body = bodyFields(request, ['expectedRevision', 'patch']);
    const saved = service.saveDraft({
      attemptId: parameter(request, 'id'),
      expectedRevision: expectedRevision(body.expectedRevision),
      patch: body.patch,
    });
    response.json({ data: attemptResponse(saved) });
  });
  app.post('/api/attempts/:id/submit', (request, response) => {
    const body = bodyFields(request, ['expectedRevision']);
    const saved = service.submitAttempt({
      attemptId: parameter(request, 'id'),
      expectedRevision: expectedRevision(body.expectedRevision),
    });
    response
      .location(`/api/evaluations/${encodeURIComponent(saved.evaluation.value.id)}`)
      .status(202)
      .json({
        data: { attempt: attemptResponse(saved.attempt), evaluation: evaluationResponse(saved.evaluation) },
      });
  });
  app.post('/api/attempts/:id/revisions', (request, response) => {
    bodyFields(request, [], true);
    const saved = service.reviseAttempt(parameter(request, 'id'));
    response
      .location(`/api/attempts/${encodeURIComponent(saved.value.id)}`)
      .status(201)
      .json({ data: attemptResponse(saved) });
  });
  app.get('/api/evaluations/:id', (request, response) => {
    response.json({ data: evaluationResponse(service.getEvaluation(parameter(request, 'id'))) });
  });
  app.post('/api/evaluations/:id/retries', (request, response) => {
    bodyFields(request, [], true);
    const saved = service.retryEvaluation(parameter(request, 'id'));
    response
      .location(`/api/evaluations/${encodeURIComponent(saved.value.id)}`)
      .status(202)
      .json({ data: evaluationResponse(saved) });
  });
  if (options.webDirectory) {
    const indexFile = join(options.webDirectory, 'index.html');
    app.use(
      '/assets',
      express.static(join(options.webDirectory, 'assets'), { dotfiles: 'deny', index: false }),
    );
    app.get('/', (_request, response) => {
      if (!existsSync(indexFile)) {
        response
          .status(503)
          .type('text')
          .send('Build the interface with npm run build, then reload this page.');
        return;
      }
      const html = readFileSync(indexFile, 'utf8');
      response
        .type('html')
        .send(
          options.previewMode
            ? html.replace('name="practice-mode" content="live"', 'name="practice-mode" content="simulated"')
            : html,
        );
    });
  }
  app.use((_request, response) => {
    response
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'The requested route does not exist.', issues: {} } });
  });
  app.use(errorHandler);
  return app;
}
