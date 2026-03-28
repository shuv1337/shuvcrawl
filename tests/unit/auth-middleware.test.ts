import { expect, test } from 'bun:test';
import { buildApi } from '../../src/api/routes.ts';
import { defaultConfig } from '../../src/config/defaults.ts';
import { createLogger } from '../../src/utils/logger.ts';
import { Engine } from '../../src/core/engine.ts';

function createTestApp(token: string | null) {
  const config = {
    ...defaultConfig,
    api: {
      ...defaultConfig.api,
      token,
    },
    telemetry: {
      ...defaultConfig.telemetry,
      logLevel: 'error' as const,
    },
  };
  const logger = createLogger('error', { service: 'test' });
  const engine = new Engine(config, logger);
  return buildApi(engine, config);
}

test('auth middleware rejects missing bearer token when configured', async () => {
  const app = createTestApp('secret-token');
  const res = await app.request('http://localhost/config');
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('UNAUTHORIZED');
});

test('auth middleware rejects wrong bearer token when configured', async () => {
  const app = createTestApp('secret-token');
  const res = await app.request('http://localhost/config', {
    headers: { authorization: 'Bearer wrong-token' },
  });
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe('UNAUTHORIZED');
});

test('auth middleware allows request with correct bearer token', async () => {
  const app = createTestApp('secret-token');
  const res = await app.request('http://localhost/config', {
    headers: { authorization: 'Bearer secret-token' },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.api.hasToken).toBe(true);
  expect(body.data.api.token).toBe('[redacted]');
});

test('auth middleware allows request when token is not configured', async () => {
  const app = createTestApp(null);
  const res = await app.request('http://localhost/config');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
});
