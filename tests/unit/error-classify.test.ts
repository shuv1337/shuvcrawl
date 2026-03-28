import { expect, test } from 'bun:test';
import { classifyError, ConfigError } from '../../src/errors/classify.ts';

test('classifyError maps config errors to exit code 2', () => {
  const classified = classifyError(new ConfigError('bad config'));
  expect(classified.code).toBe('CONFIG_ERROR');
  expect(classified.exitCode).toBe(2);
});

test('classifyError maps validation-ish errors to exit code 4', () => {
  const classified = classifyError(Object.assign(new Error('missing required argument'), { name: 'CommanderError' }));
  expect(classified.code).toBe('INVALID_REQUEST');
  expect(classified.exitCode).toBe(4);
});

test('classifyError maps robots errors to exit code 6', () => {
  const classified = classifyError(new Error('robots denied'));
  expect(classified.code).toBe('ROBOTS_DENIED');
  expect(classified.exitCode).toBe(6);
});

test('classifyError maps browser init errors to exit code 8', () => {
  const classified = classifyError(new Error('failed to launch browser processsingleton lock'));
  expect(classified.code).toBe('BROWSER_INIT_FAILED');
  expect(classified.exitCode).toBe(8);
});

test('classifyError maps network errors to exit code 3', () => {
  const classified = classifyError(new Error('ECONNREFUSED upstream'));
  expect(classified.code).toBe('NETWORK_ERROR');
  expect(classified.exitCode).toBe(3);
});
