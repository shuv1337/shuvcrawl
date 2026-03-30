import { expect, test } from 'bun:test';
import { withApiTrace } from './helpers.ts';

const category = 'service-config-auth';

test('GET /health returns service summary', async () => {
  await withApiTrace(category, 'health endpoint summary', async ({ request, trace, env }) => {
    const { response, body } = await request('/health');
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe('shuvcrawl');
    expect(body.config.api.hasToken).toBe(true);
    expect(body.config.api.token).toBe('[redacted]');
    expect(body.telemetry.otlpEnabled).toBe(env.verifyOtlp);
    await trace.note('Health endpoint verified.');
  });
});

test('GET /config returns redacted config', async () => {
  await withApiTrace(category, 'config redaction', async ({ request, env }) => {
    const { response, body } = await request('/config');
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.api.hasToken).toBe(true);
    expect(body.data.api.token).toBe('[redacted]');
    expect(body.data.telemetry.hasOtlpHttpEndpoint).toBe(env.verifyOtlp);
    expect(body.data.telemetry.otlpHttpEndpoint).toBe(env.verifyOtlp ? '[redacted]' : null);
  });
});

test('auth rejects missing bearer token', async () => {
  await withApiTrace(category, 'auth missing token', async ({ request }) => {
    const { response, body } = await request('/config', { auth: 'none' });
    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

test('auth rejects invalid bearer token', async () => {
  await withApiTrace(category, 'auth invalid token', async ({ request }) => {
    const { response, body } = await request('/config', { auth: 'invalid' });
    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
