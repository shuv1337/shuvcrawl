import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
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

export type Viewport = { width: number; height: number };

export type BrowserSessionOptions = {
  viewport?: Viewport;
  extraHTTPHeaders?: Record<string, string>;
};

export type ConsoleLogEntry = {
  type: 'log' | 'error' | 'warning' | 'info' | 'debug';
  text: string;
  location?: string;
  timestamp: string;
};

export type BrowserSession = {
  context: BrowserContext;
  page: Page;
  extensionId: string;
  release: () => Promise<void>;
  profileDir: string;
  consoleLogs: ConsoleLogEntry[];
};

/** Shared interface for both Docker and Native browser pools */
export type BrowserPoolLike = {
  acquire(telemetry: TelemetryContext, options?: BrowserSessionOptions): Promise<BrowserSession>;
};

export class BrowserPool implements BrowserPoolLike {
  private activeSession?: BrowserSession;
  private pendingAcquire?: Promise<BrowserSession>;

  constructor(
    private readonly config: ShuvcrawlConfig,
    private readonly logger: Logger,
  ) {
    // Clean up stale runtime profiles on startup
    this.cleanupStaleProfiles();
  }

  /**
   * Clean up stale runtime profile directories from crashed sessions
   */
  private cleanupStaleProfiles(): void {
    try {
      const runtimeProfileRoot = expandHome(this.config.browser.runtimeProfile);
      if (!existsSync(runtimeProfileRoot)) return;

      const entries = readdirSync(runtimeProfileRoot);
      let cleaned = 0;
      let totalSize = 0;

      for (const entry of entries) {
        const entryPath = path.join(runtimeProfileRoot, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            totalSize += stats.size;
            rm(entryPath, { recursive: true, force: true }).catch(() => {});
            cleaned++;
          }
        } catch {
          // Skip if we can't stat
        }
      }

      if (cleaned > 0) {
        this.logger.warn('browser.stale_profiles.cleaned', {
          count: cleaned,
          totalSize,
          runtimeProfileRoot,
        });
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  async acquire(telemetry: TelemetryContext, options?: BrowserSessionOptions): Promise<BrowserSession> {
    if (this.activeSession) return this.activeSession;
    if (this.pendingAcquire) return await this.pendingAcquire;

    this.pendingAcquire = this.createSession(telemetry, options);

    try {
      const session = await this.pendingAcquire;
      this.activeSession = session;
      return session;
    } finally {
      this.pendingAcquire = undefined;
    }
  }

  private async createSession(telemetry: TelemetryContext, options?: BrowserSessionOptions): Promise<BrowserSession> {
    const profileRoot = expandHome(this.config.browser.profileRoot);
    const templateProfile = expandHome(this.config.browser.templateProfile);
    const runtimeProfileRoot = expandHome(this.config.browser.runtimeProfile);
    const runtimeProfile = this.buildRuntimeProfilePath(runtimeProfileRoot, telemetry.requestId);
    const extensionPath = path.resolve(expandHome(this.config.bpc.path));
    const bpc = new BpcAdapter(this.config.bpc);

    await mkdir(profileRoot, { recursive: true });
    await mkdir(runtimeProfileRoot, { recursive: true });
    if (!existsSync(templateProfile) || this.config.browser.resetOnStart) {
      await rm(templateProfile, { recursive: true, force: true });
      await mkdir(templateProfile, { recursive: true });
      const seeded = await this.launchContext(templateProfile, extensionPath, telemetry, true, undefined, options);
      await seeded.context.close();
    }

    await rm(runtimeProfile, { recursive: true, force: true });
    await cp(templateProfile, runtimeProfile, { recursive: true, force: true });

    const launched = await this.launchContext(runtimeProfile, extensionPath, telemetry, false, resolveProxy(this.config), options);
    await this.seedBpcState(launched.context, bpc.buildStorageState(), telemetry);

    const consoleLogs: ConsoleLogEntry[] = this.config.artifacts.includeConsole ? [] : [];
    const page = await this.prepareSessionPage(launched.context, launched.page, telemetry, options, consoleLogs);

    return {
      context: launched.context,
      page,
      extensionId: launched.extensionId,
      profileDir: runtimeProfile,
      consoleLogs,
      release: async () => {
        await launched.context.close();
        await rm(runtimeProfile, { recursive: true, force: true });
        this.activeSession = undefined;
      },
    };
  }

  private buildRuntimeProfilePath(runtimeProfileRoot: string, requestId: string): string {
    const safeRequestId = requestId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(runtimeProfileRoot, safeRequestId);
  }

  private async prepareSessionPage(
    context: BrowserContext,
    bootstrapPage: Page,
    telemetry: TelemetryContext,
    options?: BrowserSessionOptions,
    consoleLogs?: ConsoleLogEntry[],
  ): Promise<Page> {
    const page = await context.newPage();

    // Set up console log collection
    if (consoleLogs) {
      page.on('console', async (msg) => {
        const type = msg.type() as ConsoleLogEntry['type'];
        const text = msg.text();
        let location: string | undefined;
        try {
          const loc = await msg.location();
          location = loc.url;
        } catch {
          // Location may not always be available
        }

        consoleLogs.push({
          type: ['log', 'error', 'warning', 'info', 'debug'].includes(type) ? type : 'log',
          text,
          location,
          timestamp: new Date().toISOString(),
        });
      });

      page.on('pageerror', (error) => {
        consoleLogs.push({
          type: 'error',
          text: error.message,
          timestamp: new Date().toISOString(),
        });
      });
    }

    // Set viewport if provided
    if (options?.viewport) {
      await page.setViewportSize(options.viewport);
    }

    // Set extra HTTP headers if provided
    if (options?.extraHTTPHeaders && Object.keys(options.extraHTTPHeaders).length > 0) {
      await page.setExtraHTTPHeaders(options.extraHTTPHeaders);
    }

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
    options?: BrowserSessionOptions,
  ): Promise<{ context: BrowserContext; page: Page; extensionId: string }> {
    const bpc = new BpcAdapter(this.config.bpc);
    const args = [...this.config.browser.args, ...bpc.getExtensionFlags(extensionPath), '--no-first-run', '--no-default-browser-check'];

    const viewport = options?.viewport ?? this.config.browser.viewport;

    const { result: browserResult } = await measureStage(this.logger, 'browser.acquire', telemetry, async () => {
      this.logger.info('browser.launch.options', {
        ...telemetry,
        userDataDir,
        headless: this.config.browser.headless,
        executablePath: this.config.browser.executablePath,
        extensionPath,
        args,
        proxy,
        viewport,
      });
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: this.config.browser.headless,
        executablePath: this.config.browser.executablePath ?? undefined,
        args,
        viewport,
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
    return browserResult;
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
