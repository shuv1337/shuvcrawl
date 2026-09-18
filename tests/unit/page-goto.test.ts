import { expect, test } from 'bun:test';
import { gotoPage, isTimeoutError } from '../../src/core/page-goto.ts';

function timeoutError(message: string) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

test('isTimeoutError matches Playwright TimeoutError', () => {
  expect(isTimeoutError(timeoutError('goto: Timeout 30000ms exceeded'))).toBe(true);
  expect(isTimeoutError(new Error('boom'))).toBe(false);
});

test('gotoPage uses the requested waitUntil', async () => {
  const calls: Array<{ url: string; waitUntil: string; timeout: number }> = [];
  const page = {
    goto: async (url: string, options: { waitUntil: string; timeout: number }) => {
      calls.push({ url, waitUntil: options.waitUntil, timeout: options.timeout });
    },
    waitForLoadState: async () => {
      throw new Error('should not fall back');
    },
  };

  const result = await gotoPage(page as any, 'https://example.com/article', 'load', 5000);
  expect(result).toEqual({ wait: 'load', fellBack: false });
  expect(calls).toEqual([{ url: 'https://example.com/article', waitUntil: 'load', timeout: 5000 }]);
});

test('gotoPage falls back to load when networkidle times out', async () => {
  const states: string[] = [];
  const page = {
    goto: async (_url: string, options: { waitUntil: string }) => {
      if (options.waitUntil === 'networkidle') {
        throw timeoutError('goto: Timeout 30000ms exceeded.\nwaiting until "networkidle"');
      }
    },
    waitForLoadState: async (state: string) => {
      states.push(state);
    },
  };

  const result = await gotoPage(page as any, 'https://example.com/article', 'networkidle', 30000);
  expect(result).toEqual({ wait: 'load', fellBack: true });
  expect(states).toEqual(['load']);
});

test('gotoPage does not swallow non-timeout failures', async () => {
  const page = {
    goto: async () => {
      throw new Error('net::ERR_NAME_NOT_RESOLVED');
    },
    waitForLoadState: async () => {
      throw new Error('should not fall back');
    },
  };

  await expect(gotoPage(page as any, 'https://example.com/article', 'networkidle', 30000)).rejects.toThrow('ERR_NAME_NOT_RESOLVED');
});
