import { describe, expect, it } from 'bun:test';
import { normalizeUrl, slugFromUrl, slugFromUrlWithHash } from '../../src/utils/url.ts';

describe('normalizeUrl', () => {
  it('removes hash from URL', () => {
    const result = normalizeUrl('https://example.com/page#section');
    expect(result).toBe('https://example.com/page');
  });

  it('preserves query params', () => {
    const result = normalizeUrl('https://example.com/page?foo=bar');
    expect(result).toBe('https://example.com/page?foo=bar');
  });
});

describe('slugFromUrl', () => {
  it('converts root path to index', () => {
    const result = slugFromUrl('https://example.com/');
    expect(result).toBe('index');
  });

  it('converts path to slug', () => {
    const result = slugFromUrl('https://example.com/blog/article-1');
    expect(result).toBe('blog__article-1');
  });

  it('replaces special chars with dashes', () => {
    const result = slugFromUrl('https://example.com/blog/article_1?test=1');
    expect(result).toContain('blog__article_1');
  });

  it('truncates to 200 chars', () => {
    const longPath = '/a'.repeat(300);
    const result = slugFromUrl(`https://example.com${longPath}`);
    expect(result.length).toBe(200);
  });
});

describe('slugFromUrlWithHash', () => {
  it('converts root path to index', () => {
    const result = slugFromUrlWithHash('https://example.com/');
    expect(result).toBe('index');
  });

  it('converts path to slug', () => {
    const result = slugFromUrlWithHash('https://example.com/blog/article-1');
    expect(result).toBe('blog__article-1');
  });

  it('adds hash suffix for long URLs', () => {
    const longPath = '/a'.repeat(300);
    const result = slugFromUrlWithHash(`https://example.com${longPath}`);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toContain('-');
  });

  it('produces deterministic output', () => {
    const url = 'https://example.com/very/long/path/' + 'a'.repeat(500);
    const result1 = slugFromUrlWithHash(url);
    const result2 = slugFromUrlWithHash(url);
    expect(result1).toBe(result2);
  });
});
