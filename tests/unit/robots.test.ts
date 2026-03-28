import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { allowByRobots, clearRobotsCache, getRobotsCacheSize } from '../../src/utils/robots.ts';

describe('robots.txt parsing', () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  beforeEach(() => {
    clearRobotsCache();
    fetchCount = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearRobotsCache();
  });

  function mockRobots(body: string, status = 200) {
    globalThis.fetch = (async () => {
      fetchCount++;
      return new Response(body, { status });
    }) as unknown as typeof fetch;
  }

  it('allows all when respectRobots is false', async () => {
    const result = await allowByRobots('https://example.com/private', false);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('allows when robots.txt is missing (404)', async () => {
    mockRobots('', 404);

    const result = await allowByRobots('https://example.com/private', true);

    expect(result.allowed).toBe(true);
    expect(fetchCount).toBe(1);
  });

  it('applies matching disallow rules for the current user agent', async () => {
    mockRobots(`
      User-agent: shuvcrawl
      Disallow: /private
    `);

    const result = await allowByRobots('https://example.com/private/report', true);

    expect(result).toEqual({
      allowed: false,
      reason: 'robots.txt: Disallow /private',
    });
  });

  it('prefers the longest matching allow rule over a broader disallow', async () => {
    mockRobots(`
      User-agent: *
      Disallow: /
      Allow: /public/
    `);

    const result = await allowByRobots('https://example.com/public/article', true);

    expect(result.allowed).toBe(true);
  });

  it('caches robots.txt per origin', async () => {
    mockRobots(`
      User-agent: *
      Disallow: /admin
    `);

    await allowByRobots('https://example.com/admin', true);
    await allowByRobots('https://example.com/docs', true);

    expect(fetchCount).toBe(1);
    expect(getRobotsCacheSize()).toBe(1);
  });
});

describe('robots cache', () => {
  beforeEach(() => {
    clearRobotsCache();
  });

  it('cache starts empty', () => {
    expect(getRobotsCacheSize()).toBe(0);
  });

  it('clears cache', async () => {
    globalThis.fetch = (async () => new Response('User-agent: *\nDisallow: /private', { status: 200 })) as unknown as typeof fetch;
    await allowByRobots('https://example.com', true);
    clearRobotsCache();
    expect(getRobotsCacheSize()).toBe(0);
  });
});
