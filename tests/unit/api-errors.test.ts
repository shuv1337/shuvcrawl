import { expect, test } from 'bun:test';
import { mapError } from '../../src/api/errors.ts';

test('mapError maps timeout to TIMEOUT', () => {
  const error = new Error('operation timeout exceeded');
  const mapped = mapError(error);
  expect(mapped.status).toBe(504);
  expect(mapped.body.error.code).toBe('TIMEOUT');
});

test('mapError maps browser init failure', () => {
  const error = new Error('serviceworker not available in browser');
  const mapped = mapError(error);
  expect(mapped.status).toBe(502);
  expect(mapped.body.error.code).toBe('BROWSER_INIT_FAILED');
});

test('mapError maps robots denial', () => {
  const error = new Error('robots denied by policy');
  const mapped = mapError(error);
  expect(mapped.status).toBe(403);
  expect(mapped.body.error.code).toBe('ROBOTS_DENIED');
});

test('mapError maps unauthorized errors', () => {
  const error = new Error('unauthorized');
  const mapped = mapError(error);
  expect(mapped.status).toBe(401);
  expect(mapped.body.error.code).toBe('UNAUTHORIZED');
});

test('mapError maps network errors', () => {
  const error = new Error('fetch failed: certificate verify failed');
  const mapped = mapError(error);
  expect(mapped.status).toBe(502);
  expect(mapped.body.error.code).toBe('NETWORK_ERROR');
});
