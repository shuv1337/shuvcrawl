import { expect, test } from 'bun:test';
import { defaultMapInclude, discoverPageLinks, shouldIncludeUrl } from '../../src/core/discovery.ts';

test('discoverPageLinks resolves and deduplicates links', () => {
  const html = `
    <a href="/docs/start">Start</a>
    <a href="https://example.com/docs/start#intro">Duplicate</a>
    <a href="https://other.example.com/out">Out</a>
    <a href="mailto:test@example.com">Email</a>
  `;

  const links = discoverPageLinks(html, 'https://example.com/base');
  expect(links.map(link => link.url)).toEqual([
    'https://example.com/docs/start',
    'https://other.example.com/out',
  ]);
});

test('defaultMapInclude uses seed origin wildcard', () => {
  expect(defaultMapInclude('https://docs.example.com/start')).toBe('https://docs.example.com/**');
});

test('shouldIncludeUrl enforces same-origin by default', () => {
  expect(shouldIncludeUrl('https://docs.example.com/a', { sameOriginSeed: 'https://docs.example.com/root' }).included).toBe(true);
  expect(shouldIncludeUrl('https://other.example.com/a', { sameOriginSeed: 'https://docs.example.com/root' })).toEqual({ included: false, reason: 'cross-origin' });
});

test('shouldIncludeUrl respects include and exclude globs', () => {
  expect(shouldIncludeUrl('https://docs.example.com/guides/intro', {
    include: ['https://docs.example.com/**'],
    exclude: ['**/private/**'],
  }).included).toBe(true);

  expect(shouldIncludeUrl('https://docs.example.com/private/secret', {
    include: ['https://docs.example.com/**'],
    exclude: ['**/private/**'],
  })).toEqual({ included: false, reason: 'filtered-exclude' });
});
