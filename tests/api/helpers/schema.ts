import type { APIRequestContext } from '@playwright/test';
import { Ajv, type AnySchema, type ErrorObject } from 'ajv';

/** Compiled once per worker. Each Playwright worker is its own process. */
let compiled: Promise<Ajv> | undefined;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asAjvSchema(value: Record<string, unknown>): AnySchema {
  return value as AnySchema;
}

async function loadOpenApi(request: APIRequestContext): Promise<Ajv> {
  const response = await request.get('/openapi.json');
  if (!response.ok()) {
    throw new Error(`GET /openapi.json failed with status ${response.status()}`);
  }

  const doc: unknown = await response.json();
  if (!isJsonObject(doc)) {
    throw new Error('GET /openapi.json did not return a JSON object');
  }

  // OpenAPI keywords such as example are not JSON Schema; strict mode would reject them.
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addSchema(asAjvSchema(doc), 'openapi');
  return ajv;
}

function openApiAjv(request: APIRequestContext): Promise<Ajv> {
  if (!compiled) {
    compiled = loadOpenApi(request).catch((error: unknown) => {
      compiled = undefined;
      throw error;
    });
  }
  return compiled;
}

function ajvErrorLines(errors: readonly ErrorObject[]): string {
  return errors
    .map((error) => {
      const path = error.instancePath === '' ? '/' : error.instancePath;
      return `${path} ${error.message ?? error.keyword}`;
    })
    .join('\n');
}

export async function expectSchema(
  request: APIRequestContext,
  body: unknown,
  name: string,
): Promise<void> {
  const ajv = await openApiAjv(request);
  const ref = `openapi#/components/schemas/${name}`;
  const validate = ajv.getSchema(ref);
  if (!validate) {
    throw new Error(`Schema "${name}" does not exist at ${ref}`);
  }

  const matches = validate(body);
  if (matches === true) {
    return;
  }
  if (matches !== false) {
    throw new Error(`Schema "${name}" did not validate synchronously`);
  }

  const details = ajvErrorLines(validate.errors ?? []);
  throw new Error(`Body does not match schema ${name}:\n${details}`);
}
