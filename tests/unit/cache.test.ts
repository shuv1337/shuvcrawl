import { expect, test } from 'bun:test';
import { buildCacheKey } from '../../src/storage/cache.ts';

test('buildCacheKey includes material dimensions', () => {
  const a = buildCacheKey({
    url: 'https://example.com/article',
    format: 'markdown',
    mobile: false,
    fastPath: true,
    bpc: true,
    selector: null,
    proxy: null,
  });
  const b = buildCacheKey({
    url: 'https://example.com/article',
    format: 'markdown',
    mobile: true,
    fastPath: true,
    bpc: true,
    selector: null,
    proxy: null,
  });

  expect(a).not.toEqual(b);
});
