import { chromium, type BrowserContext, type Page } from 'patchright';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';
import type { BrowserPoolLike, BrowserSession, BrowserSessionOptions, ConsoleLogEntry } from './browser.ts';

/**
 * NativeBrowserPool connects to a Patchright browser server running natively
 * on the host machine via WebSocket. This avoids Docker's Linux VM fingerprint
 * and allows the browser to use the host's real GPU, network stack, and OS
 * fingerprint — critical for bypassing advanced bot detection (e.g. DataDome).
 *
 * The host runs `native-browser-server.ts` which exposes a WS endpoint.
 * This pool connects to it, creates a new context per request, and tears
 * it down on release.
 */
export class NativeBrowserPool implements BrowserPoolLike {
  private activeSession?: BrowserSession;
  private pendingAcquire?: Promise<BrowserSession>;

  constructor(
    private readonly config: ShuvcrawlConfig,
    private readonly logger: Logger,
  ) {}

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
    const wsEndpoint = this.config.browser.native.wsEndpoint;
    const viewport = options?.viewport ?? this.config.browser.viewport;

    const { result } = await measureStage(this.logger, 'native_browser.acquire', telemetry, async () => {
      this.logger.info('native_browser.connect', {
        ...telemetry,
        wsEndpoint,
        viewport,
      });

      // Connect to the native browser via Playwright protocol.
      // The native-browser-server runs launchServer() which exposes
      // a Playwright-native WS endpoint. Both sides must use the same
      // patchright version (currently pinned to 1.58.2).
      this.logger.info('native_browser.pw_connect', { ...telemetry, wsEndpoint });

      const browser = await chromium.connect(wsEndpoint, {
        timeout: this.config.browser.defaultTimeout,
      });

      // Create a fresh browser context per request
      const context = await browser.newContext({
        viewport,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ignoreHTTPSErrors: true,
      });

      const page = await context.newPage();

      // Set extra HTTP headers if provided
      if (options?.extraHTTPHeaders && Object.keys(options.extraHTTPHeaders).length > 0) {
        await page.setExtraHTTPHeaders(options.extraHTTPHeaders);
      }

      return { browser, context, page };
    });

    const consoleLogs: ConsoleLogEntry[] = [];

    // Set up console log collection
    if (this.config.artifacts.includeConsole) {
      result.page.on('console', async (msg) => {
        const type = msg.type() as ConsoleLogEntry['type'];
        const text = msg.text();
        consoleLogs.push({
          type: ['log', 'error', 'warning', 'info', 'debug'].includes(type) ? type : 'log',
          text,
          timestamp: new Date().toISOString(),
        });
      });

      result.page.on('pageerror', (error) => {
        consoleLogs.push({
          type: 'error',
          text: error.message,
          timestamp: new Date().toISOString(),
        });
      });
    }

    return {
      context: result.context,
      page: result.page,
      extensionId: 'native',
      profileDir: 'native',
      consoleLogs,
      release: async () => {
        try {
          await result.context.close();
        } catch (error) {
          this.logger.warn('native_browser.context.close_failed', {
            ...telemetry,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          });
        }
        // Don't close the browser — it's shared via the server
        this.activeSession = undefined;
      },
    };
  }
}
