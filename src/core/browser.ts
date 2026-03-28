import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'patchright';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';
import { BpcAdapter } from './bpc.ts';
import { resolveProxy } from '../utils/proxy.ts';
import { expandHome } from '../utils/paths.ts';

declare const chrome: any;

export type BrowserSession = {
  context: BrowserContext;
  page: Page;
  extensionId: string;
  release: () => Promise<void>;
  profileDir: string;
};

export class BrowserPool {
  private activeSession?: BrowserSession;

  constructor(
    private readonly config: ShuvcrawlConfig,
    private readonly logger: Logger,
  ) {}

  async acquire(telemetry: TelemetryContext): Promise<BrowserSession> {
    if (this.activeSession) return this.activeSession;

    const profileRoot = expandHome(this.config.browser.profileRoot);
    const templateProfile = expandHome(this.config.browser.templateProfile);
    const runtimeProfileRoot = expandHome(this.config.browser.runtimeProfile);
    const runtimeProfile = this.buildRuntimeProfilePath(runtimeProfileRoot, telemetry.requestId);
    const extensionPath = path.resolve(this.config.bpc.path);
    const bpc = new BpcAdapter(this.config.bpc);

    await mkdir(profileRoot, { recursive: true });
    await mkdir(runtimeProfileRoot, { recursive: true });
    if (!existsSync(templateProfile) || this.config.browser.resetOnStart) {
      await rm(templateProfile, { recursive: true, force: true });
      await mkdir(templateProfile, { recursive: true });
      const seeded = await this.launchContext(templateProfile, extensionPath, telemetry, true);
      await seeded.context.close();
    }

    await rm(runtimeProfile, { recursive: true, force: true });
    await cp(templateProfile, runtimeProfile, { recursive: true, force: true });

    const launched = await this.launchContext(runtimeProfile, extensionPath, telemetry, false, resolveProxy(this.config));
    await this.seedBpcState(launched.context, bpc.buildStorageState(), telemetry);
    const page = await this.prepareSessionPage(launched.context, launched.page, telemetry);

    const session: BrowserSession = {
      context: launched.context,
      page,
      extensionId: launched.extensionId,
      profileDir: runtimeProfile,
      release: async () => {
        await launched.context.close();
        await rm(runtimeProfile, { recursive: true, force: true });
        this.activeSession = undefined;
      },
    };

    this.activeSession = session;
    return session;
  }

  private buildRuntimeProfilePath(runtimeProfileRoot: string, requestId: string): string {
    const safeRequestId = requestId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(runtimeProfileRoot, safeRequestId);
  }

  private async prepareSessionPage(context: BrowserContext, bootstrapPage: Page, telemetry: TelemetryContext): Promise<Page> {
    const page = await context.newPage();
    await page.goto('about:blank');
    try {
      if (!bootstrapPage.isClosed()) {
        await bootstrapPage.close();
      }
    } catch (error) {
      this.logger.warn('browser.bootstrap_page.close_failed', {
        ...telemetry,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
    }
    return page;
  }

  private async launchContext(
    userDataDir: string,
    extensionPath: string,
    telemetry: TelemetryContext,
    templateInit: boolean,
    proxy?: { server: string },
  ): Promise<{ context: BrowserContext; page: Page; extensionId: string }> {
    const bpc = new BpcAdapter(this.config.bpc);
    const args = [...this.config.browser.args, ...bpc.getExtensionFlags(extensionPath), '--no-first-run', '--no-default-browser-check'];
    const { result } = await measureStage(this.logger, 'browser.acquire', telemetry, async () => {
      this.logger.info('browser.launch.options', {
        ...telemetry,
        userDataDir,
        headless: this.config.browser.headless,
        executablePath: this.config.browser.executablePath,
        extensionPath,
        args,
        proxy,
      });
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: this.config.browser.headless,
        executablePath: this.config.browser.executablePath ?? undefined,
        args,
        viewport: this.config.browser.viewport,
        serviceWorkers: 'allow',
        ignoreHTTPSErrors: true,
        timeout: this.config.browser.defaultTimeout,
        proxy,
      });
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto('about:blank');
      let serviceWorker = context.serviceWorkers()[0];
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: this.config.browser.defaultTimeout });
      }
      const extensionId = serviceWorker.url().split('/')[2] ?? 'unknown';
      this.logger.info('browser.extension.ready', { ...telemetry, templateInit, extensionId, workerUrl: serviceWorker.url() });
      return { context, page, extensionId };
    });
    return result;
  }

  private async seedBpcState(context: BrowserContext, storageState: Record<string, unknown>, telemetry: TelemetryContext): Promise<void> {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: this.config.browser.defaultTimeout });
    }
    await measureStage(this.logger, 'bpc.seed', telemetry, async () => {
      await serviceWorker.evaluate(async (payload: Record<string, unknown>) => {
        await new Promise<void>(resolve => chrome.storage.local.set(payload, () => resolve()));
      }, storageState);
      const snapshot = await serviceWorker.evaluate(async () => {
        return await new Promise<Record<string, unknown>>(resolve => {
          chrome.storage.local.get({
            sites_excluded: [],
            optIn: false,
            customOptIn: false,
            optInUpdate: true,
          }, (items: Record<string, unknown>) => resolve(items));
        });
      });
      this.logger.info('bpc.seed.snapshot', { ...telemetry, snapshot });
    });
  }
}
