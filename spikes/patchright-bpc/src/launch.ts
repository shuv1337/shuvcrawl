import type { BrowserContext, Page } from 'patchright';
import { chromium } from 'patchright';
import type { SpikeConfig } from './config.ts';
import type { SpikeLogger } from './logger.ts';
import { withStage } from './telemetry.ts';

export type LaunchResult = {
  context: BrowserContext;
  page: Page;
  browserVersion?: string;
  launchArgs: string[];
};

export async function launchPersistentContext(
  config: SpikeConfig,
  logger: SpikeLogger,
  userDataDir: string,
): Promise<LaunchResult> {
  const launchArgs = [
    `--disable-extensions-except=${config.paths.bpcPath}`,
    `--load-extension=${config.paths.bpcPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  const { result } = await withStage(logger, 'browser.launch', async () => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: config.headless,
      channel: config.browserChannel,
      executablePath: config.browserExecutablePath,
      args: launchArgs,
      viewport: { width: 1440, height: 960 },
      serviceWorkers: 'allow',
      ignoreHTTPSErrors: true,
      timeout: config.timeoutBrowserMs,
    });

    const page = context.pages()[0] ?? await context.newPage();
    await page.goto('about:blank');

    return {
      context,
      page,
      browserVersion: context.browser()?.version(),
      launchArgs,
    };
  }, {
    headless: config.headless,
    executablePath: config.browserExecutablePath,
    browserChannel: config.browserChannel,
    userDataDir,
    launchArgs,
  });

  await logger.log('browser.launch.success', {
    userDataDir,
    browserVersion: result.browserVersion,
    launchArgs: result.launchArgs,
    executablePath: config.browserExecutablePath,
    browserChannel: config.browserChannel,
  });

  return result;
}
