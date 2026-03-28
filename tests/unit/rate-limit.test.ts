import { describe, expect, it, beforeEach } from 'bun:test';
import { DomainRateLimiter } from '../../src/utils/rate-limit.ts';

describe('DomainRateLimiter', () => {
  let limiter: DomainRateLimiter;

  beforeEach(() => {
    limiter = new DomainRateLimiter();
  });

  it('allows first request immediately', async () => {
    const start = Date.now();
    await limiter.waitForDomain('example.com', 100);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // Should be nearly instant
  });

  it('enforces delay between requests to same domain', async () => {
    await limiter.waitForDomain('example.com', 50);
    const start = Date.now();
    await limiter.waitForDomain('example.com', 50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small timing variance
  });

  it('allows parallel requests to different domains', async () => {
    const start = Date.now();
    await Promise.all([
      limiter.waitForDomain('a.com', 100),
      limiter.waitForDomain('b.com', 100),
      limiter.waitForDomain('c.com', 100),
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // All should be parallel
  });

  it('serializes concurrent requests to the same domain', async () => {
    const start = Date.now();
    await Promise.all([
      limiter.waitForDomain('example.com', 50),
      limiter.waitForDomain('example.com', 50),
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  it('returns immediately when delay is 0', async () => {
    const start = Date.now();
    await limiter.waitForDomain('example.com', 0);
    await limiter.waitForDomain('example.com', 0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  it('tracks multiple domains', async () => {
    await limiter.waitForDomain('a.com', 100);
    await limiter.waitForDomain('b.com', 100);
    const stats = limiter.getStats();
    expect(stats.trackedDomains).toBe(2);
  });

  it('reset clears tracking', async () => {
    await limiter.waitForDomain('example.com', 100);
    limiter.reset();
    const stats = limiter.getStats();
    expect(stats.trackedDomains).toBe(0);
  });

  it('no delay needed if enough time passed', async () => {
    await limiter.waitForDomain('example.com', 50);
    await new Promise(r => setTimeout(r, 60)); // Wait longer than the delay
    const start = Date.now();
    await limiter.waitForDomain('example.com', 50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });
});
