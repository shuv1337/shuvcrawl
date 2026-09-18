import type { Page } from 'patchright';

export type GotoWait = 'load' | 'networkidle';

export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || /timeout/i.test(error.message);
}

/**
 * Navigate with Playwright waitUntil. `networkidle` rarely settles on
 * ad-heavy pages, so a timeout there falls back to `load` on the same
 * navigation instead of failing the whole scrape.
 */
export async function gotoPage(
  page: Page,
  url: string,
  wait: GotoWait,
  timeout: number,
): Promise<{ wait: GotoWait; fellBack: boolean }> {
  try {
    await page.goto(url, { waitUntil: wait, timeout });
    return { wait, fellBack: false };
  } catch (error) {
    if (wait === 'networkidle' && isTimeoutError(error)) {
      await page.waitForLoadState('load', { timeout });
      return { wait: 'load', fellBack: true };
    }
    throw error;
  }
}
