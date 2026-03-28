import type { Page } from 'patchright';
import type { SpikeConfig } from './config.ts';
import type { SpikeLogger } from './logger.ts';
import { withStage } from './telemetry.ts';

export type NavigationResult = {
  finalUrl: string;
  title: string;
  screenshotPath?: string;
};

export async function navigateAfterReadiness(
  page: Page,
  config: SpikeConfig,
  logger: SpikeLogger,
  artifactDir: string,
): Promise<NavigationResult> {
  const { result } = await withStage(logger, 'navigation', async () => {
    await logger.log('navigation.start', { targetUrl: config.targetUrl });
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutNavigationMs });
    const title = await page.title();
    const screenshotPath = `${artifactDir}/navigation.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await logger.log('navigation.success', { targetUrl: config.targetUrl, finalUrl: page.url(), title, screenshotPath });
    return {
      finalUrl: page.url(),
      title,
      screenshotPath,
    };
  });

  return result;
}
