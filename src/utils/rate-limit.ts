// Domain-based rate limiter for polite crawling
// Ensures minimum delay between requests to the same domain

export class DomainRateLimiter {
  private lastRequestTimes: Map<string, number> = new Map();
  private pendingByDomain: Map<string, Promise<void>> = new Map();

  /**
   * Wait if needed to respect the delay between requests to the same domain.
   * Returns immediately for the first request to a domain.
   * Updates the timestamp after the optional delay.
   */
  async waitForDomain(hostname: string, delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return;
    }

    const previous = this.pendingByDomain.get(hostname) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const current = previous.then(() => gate);
    this.pendingByDomain.set(hostname, current);

    await previous;

    try {
      const now = Date.now();
      const lastRequest = this.lastRequestTimes.get(hostname);

      if (lastRequest !== undefined) {
        const elapsed = now - lastRequest;
        const remaining = delayMs - elapsed;

        if (remaining > 0) {
          await new Promise(resolve => setTimeout(resolve, remaining));
        }
      }

      this.lastRequestTimes.set(hostname, Date.now());
    } finally {
      release();
      if (this.pendingByDomain.get(hostname) === current) {
        this.pendingByDomain.delete(hostname);
      }
    }
  }

  /**
   * Get statistics for debugging/monitoring
   */
  getStats(): { trackedDomains: number } {
    return {
      trackedDomains: this.lastRequestTimes.size,
    };
  }

  /**
   * Reset all tracking (useful for testing)
   */
  reset(): void {
    this.lastRequestTimes.clear();
    this.pendingByDomain.clear();
  }
}
