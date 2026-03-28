import { expect, test } from 'bun:test';
import { redactConfig } from '../../src/config/redact.ts';
import { defaultConfig } from '../../src/config/defaults.ts';

test('redactConfig hides sensitive values', () => {
  const redacted = redactConfig({
    ...defaultConfig,
    api: { ...defaultConfig.api, token: 'secret-token' },
    proxy: { ...defaultConfig.proxy, url: 'http://user:pass@example.com:8080' },
    telemetry: { ...defaultConfig.telemetry, otlpHttpEndpoint: 'http://localhost:3474/v1/traces' },
  });

  expect((redacted.api as any).token).toBe('[redacted]');
  expect((redacted.proxy as any).url).toBe('[redacted]');
  expect((redacted.telemetry as any).otlpHttpEndpoint).toBe('[redacted]');
});
