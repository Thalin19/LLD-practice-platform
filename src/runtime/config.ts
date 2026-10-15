import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  readonly port: number;
  readonly apiKey: string;
}

/** Load only the credential we need; existing environment values take precedence. */
export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  envFile = fileURLToPath(new URL('../../.env', import.meta.url)),
): ServerConfig {
  const rawPort = environment.PORT ?? '3000';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return Object.freeze({ port, apiKey: loadCredential('GEMINI_API_KEY', environment, envFile) });
}

/** The historical Groq check must explicitly request its own provider credential. */
export function loadCredential(
  name: 'GEMINI_API_KEY' | 'GROQ_API_KEY',
  environment: NodeJS.ProcessEnv = process.env,
  envFile = fileURLToPath(new URL('../../.env', import.meta.url)),
): string {
  let apiKey = environment[name];
  if (apiKey === undefined) {
    try { apiKey = parseEnv(readFileSync(envFile, 'utf8'))[name]; }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw new Error('The project .env file could not be read.');
      }
    }
  }
  if (!apiKey?.trim()) throw new Error(`Set ${name} in the project .env file or environment before starting the server.`);
  return apiKey.trim();
}
