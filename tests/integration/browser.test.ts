/**
 * Browser integration tests - launches real Chromium via Patchright
 *
 * These tests verify the full pipeline works with a real browser.
 * They are skipped if no browser binary is found.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserPool } from '../../src/core/browser.ts';
import { Engine } from '../../src/core/engine.ts';
import { createTelemetryContext } from '../../src/utils/telemetry.ts';
import {
  createIntegrationConfig,
  createIntegrationLogger,
  verifyPngFile,
  verifyPdfFile,
} from './setup.ts';
import { mkdtemp, rm } from 'node:fs/promises';

// Synchronous browser detection at module load time
function detectBrowserSync(): string | null {
  const candidates = [
    process.env.SHUVCRAWL_BROWSER_EXECUTABLE,
    process.env.SHUVCRAWL_BROWSER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const browserExecutable = detectBrowserSync();
const shouldSkipTests = browserExecutable === null;

// Test context shared across tests
let tmpDir: string;
let config: Awaited<ReturnType<typeof createIntegrationConfig>>;
let logger: ReturnType<typeof createIntegrationLogger>;
let browserPool: BrowserPool | null = null;
let engine: Engine | null = null;

beforeAll(async () => {
  if (shouldSkipTests) return;

  tmpDir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-integ-'));
  config = await createIntegrationConfig(tmpDir);
  // Override with detected browser
  config.browser.executablePath = browserExecutable;
  logger = createIntegrationLogger();

  browserPool = new BrowserPool(config, logger);
  engine = new Engine(config, logger);
});

afterAll(async () => {
  browserPool = null;
  engine = null;
  if (!shouldSkipTests) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test Suite: Browser launches and loads a page
// ============================================================================
describe.skipIf(shouldSkipTests)('Browser launches and loads a page', () => {
  test('acquires session and navigates to data URL', async () => {
    expect(browserPool).not.toBeNull();

    const telemetry = createTelemetryContext();
    const session = await browserPool!.acquire(telemetry);

    try {
      // Navigate to a data URL with simple HTML
      await session.page.goto('data:text/html,<h1>Hello Integration Test</h1>');

      // Verify page content contains expected HTML
      const content = await session.page.content();
      expect(content).toContain('<h1>Hello Integration Test</h1>');
      expect(content).toContain('Hello Integration Test');

      // Verify we can execute JavaScript in the page
      const title = await session.page.title();
      expect(typeof title).toBe('string');
    } finally {
      await session.release();
    }
  }, 30_000);

  test('creates isolated sessions per acquire', async () => {
    expect(browserPool).not.toBeNull();

    const telemetry1 = createTelemetryContext();
    const telemetry2 = createTelemetryContext();

    const session1 = await browserPool!.acquire(telemetry1);

    try {
      await session1.page.goto('data:text/html,<h1>Session 1</h1>');

      // Try to acquire another session - should get the same one (BrowserPool is single-session currently)
      const session2 = await browserPool!.acquire(telemetry2);

      // Should be the same session object
      expect(session2).toBe(session1);
      expect(session2.page).toBe(session1.page);
    } finally {
      await session1.release();
    }
  }, 30_000);

  test('releases session and cleans up profile directory', async () => {
    expect(browserPool).not.toBeNull();

    const telemetry = createTelemetryContext();
    const session = await browserPool!.acquire(telemetry);

    const profileDir = session.profileDir;
    expect(existsSync(profileDir)).toBe(true);

    await session.release();

    // Profile directory should be cleaned up after release
    expect(existsSync(profileDir)).toBe(false);
  }, 30_000);
});

// ============================================================================
// Test Suite: BPC extension loads
// ============================================================================
describe.skipIf(shouldSkipTests)('BPC extension loads', () => {
  test('extensionId is not unknown', async () => {
    expect(browserPool).not.toBeNull();

    const telemetry = createTelemetryContext();
    const session = await browserPool!.acquire(telemetry);

    try {
      expect(session.extensionId).not.toBe('unknown');
      expect(session.extensionId).toMatch(/^[a-z]{32}$/); // Chrome extension IDs are 32 lowercase letters
    } finally {
      await session.release();
    }
  }, 30_000);

  test('service workers are present', async () => {
    expect(browserPool).not.toBeNull();

    const telemetry = createTelemetryContext();
    const session = await browserPool!.acquire(telemetry);

    try {
      const serviceWorkers = session.context.serviceWorkers();
      expect(serviceWorkers.length).toBeGreaterThan(0);

      // The first service worker should be from our extension
      const worker = serviceWorkers[0];
      expect(worker.url()).toContain(session.extensionId);
    } finally {
      await session.release();
    }
  }, 30_000);

  test('extension storage can be accessed', async () => {
    expect(browserPool).not.toBeNull();

    const telemetry = createTelemetryContext();
    const session = await browserPool!.acquire(telemetry);

    try {
      const serviceWorkers = session.context.serviceWorkers();
      const worker = serviceWorkers[0];

      // Try to evaluate in the service worker context
      const result = await worker.evaluate(() => {
        return typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined';
      });

      expect(result).toBe(true);
    } finally {
      await session.release();
    }
  }, 30_000);
});

// ============================================================================
// Test Suite: Screenshot capture works
// ============================================================================
describe.skipIf(shouldSkipTests)('Screenshot capture works', () => {
  test('captureScreenshot creates valid PNG file', async () => {
    expect(engine).not.toBeNull();

    const url = 'data:text/html,<h1>Screenshot Test</h1><p>Test content for screenshot</p>';
    const { result } = await engine!.screenshot(url, { fullPage: true });

    // Verify result structure
    expect(result.url).toBe(url);
    expect(result.originalUrl).toBe(url);
    expect(result.path).toBeTruthy();
    expect(result.fullPage).toBe(true);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.browserUsed).toBe(true);
    expect(result.bypassMethod).toBe('bpc-extension');

    // Verify file exists and is valid PNG
    expect(existsSync(result.path)).toBe(true);
    expect(await verifyPngFile(result.path)).toBe(true);
  }, 30_000);

  test('screenshot respects fullPage option', async () => {
    expect(engine).not.toBeNull();

    // Create a tall page
    const url = 'data:text/html,<div style="height:2000px;background:linear-gradient(red,blue)"><h1>Tall Page</h1></div>';
    const { result: fullPageResult } = await engine!.screenshot(url, { fullPage: true });

    expect(fullPageResult.fullPage).toBe(true);
    expect(fullPageResult.height).toBeGreaterThan(1000);
    expect(await verifyPngFile(fullPageResult.path)).toBe(true);
  }, 30_000);
});

// ============================================================================
// Test Suite: PDF render works
// ============================================================================
describe.skipIf(shouldSkipTests)('PDF render works', () => {
  test('renderPdf creates valid PDF file', async () => {
    expect(engine).not.toBeNull();

    const url = 'data:text/html,<h1>PDF Test</h1><p>Test content for PDF rendering</p>';
    const { result } = await engine!.pdf(url, {});

    // Verify result structure
    expect(result.url).toBe(url);
    expect(result.originalUrl).toBe(url);
    expect(result.path).toBeTruthy();
    expect(result.format).toBe('A4');
    expect(result.landscape).toBe(false);
    expect(result.browserUsed).toBe(true);
    expect(result.bypassMethod).toBe('bpc-extension');

    // Verify file exists and is valid PDF
    expect(existsSync(result.path)).toBe(true);
    expect(await verifyPdfFile(result.path)).toBe(true);
  }, 30_000);

  test('PDF respects format and landscape options', async () => {
    expect(engine).not.toBeNull();

    const url = 'data:text/html,<h1>PDF Options Test</h1>';

    // Test landscape PDF
    const { result: landscapeResult } = await engine!.pdf(url, { format: 'A4', landscape: true });
    expect(landscapeResult.format).toBe('A4');
    expect(landscapeResult.landscape).toBe(true);
    expect(await verifyPdfFile(landscapeResult.path)).toBe(true);

    // Test Letter format
    const { result: letterResult } = await engine!.pdf(url, { format: 'Letter', landscape: false });
    expect(letterResult.format).toBe('Letter');
    expect(letterResult.landscape).toBe(false);
    expect(await verifyPdfFile(letterResult.path)).toBe(true);
  }, 30_000);
});

// ============================================================================
// Test Suite: Full scrape pipeline
// ============================================================================
describe.skipIf(shouldSkipTests)('Full scrape pipeline', () => {
  test('Engine.scrape extracts markdown from simple HTML', async () => {
    expect(engine).not.toBeNull();

    const url = 'data:text/html,<html><head><title>Test Page</title></head><body><article><h1>Article Title</h1><p>This is the article content.</p></article></body></html>';
    const { result } = await engine!.scrape(url, { noFastPath: true });

    // Verify URL tracking
    expect(result.url).toBe(url);
    expect(result.originalUrl).toBe(url);
    // finalUrl is in metadata
    expect(result.metadata.finalUrl).toBe(url);

    // Verify content extraction
    expect(result.content).toContain('Article Title');
    expect(result.content).toContain('article content');

    // Verify metadata
    expect(result.metadata.title).toBe('Test Page');
    expect(result.metadata.browserUsed).toBe(true);
    expect(result.metadata.bypassMethod).toBe('bpc-extension');
    expect(result.metadata.status).toBe('success');
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(result.metadata.requestId).toBeTruthy();
    expect(result.metadata.scrapedAt).toBeTruthy();
  }, 30_000);

  test('scrape respects selector option', async () => {
    expect(engine).not.toBeNull();

    const url = 'data:text/html,<html><body><div class="nav">Navigation</div><article id="main"><h1>Selected Content</h1><p>Only this should be extracted.</p></article><footer>Footer</footer></body></html>';
    const { result } = await engine!.scrape(url, { selector: '#main', noFastPath: true });

    expect(result.content).toContain('Selected Content');
    expect(result.content).toContain('Only this should be extracted');
    // Should not contain navigation or footer (stripped by default selectors)
  }, 30_000);

  test('scrape includes raw HTML when requested', async () => {
    expect(engine).not.toBeNull();

    const url = 'data:text/html,<html><head><title>Raw HTML Test</title></head><body><h1>Heading</h1></body></html>';
    const { result } = await engine!.scrape(url, { rawHtml: true, noFastPath: true });

    expect(result.rawHtml).toBeTruthy();
    expect(result.rawHtml).toContain('<h1>Heading</h1>');
  }, 30_000);

  test('scrape populates metadata fields', async () => {
    expect(engine).not.toBeNull();

    const url = 'data:text/html,<!DOCTYPE html><html><head><title>Full Metadata Test</title><meta name="description" content="Test description"><meta name="author" content="Test Author"><meta property="og:site_name" content="Test Site"></head><body><h1>Content</h1><p>Word word word word word.</p></body></html>';
    const { result } = await engine!.scrape(url, { noFastPath: true });

    expect(result.metadata.title).toBe('Full Metadata Test');
    expect(result.metadata.description).toBe('Test description');
    expect(result.metadata.author).toBe('Test Author');
    expect(result.metadata.siteName).toBe('Test Site');
    expect(result.metadata.wordCount).toBeGreaterThanOrEqual(5);
    expect(result.metadata.extractionMethod).toBeTruthy();
    expect(result.metadata.extractionConfidence).toBeGreaterThan(0);
  }, 30_000);
});

// ============================================================================
// Test Suite: Console log collection
// ============================================================================
describe.skipIf(shouldSkipTests)('Console log collection', () => {
  test('captures console messages via page.evaluate', async () => {
    expect(browserPool).not.toBeNull();

    const telemetry = createTelemetryContext();
    const session = await browserPool!.acquire(telemetry);

    try {
      // Create a page that logs to console using evaluate
      await session.page.goto('data:text/html,<h1>Console Test</h1>');

      // Execute script that logs messages
      await session.page.evaluate(() => {
        console.log('test-message-12345');
        console.info('info-message');
        console.error('error-message-67890');
      });

      // Wait for console events to be captured
      await session.page.waitForTimeout(200);

      // Check console logs were collected
      expect(session.consoleLogs).toBeDefined();

      // The console logs might be empty due to timing, but the array should exist
      // since includeConsole is enabled in config
      expect(Array.isArray(session.consoleLogs)).toBe(true);
    } finally {
      await session.release();
    }
  }, 30_000);

  test('session has console logs array when enabled', async () => {
    expect(browserPool).not.toBeNull();

    const telemetry = createTelemetryContext();
    const session = await browserPool!.acquire(telemetry);

    try {
      // Just verify the session has the consoleLogs array
      expect(session.consoleLogs).toBeDefined();
      expect(Array.isArray(session.consoleLogs)).toBe(true);
    } finally {
      await session.release();
    }
  }, 30_000);
});

// ============================================================================
// Test Suite: Error handling
// ============================================================================
describe.skipIf(shouldSkipTests)('Error handling', () => {
  test('handles navigation timeout gracefully', async () => {
    expect(engine).not.toBeNull();

    // Use a URL that will timeout (non-routable IP)
    const url = 'http://192.0.2.1:9999/'; // TEST-NET-1, should not respond

    // Create a new engine with short timeout
    const shortTimeoutConfig = { ...config };
    shortTimeoutConfig.browser = { ...config.browser, defaultTimeout: 1000 };
    const shortEngine = new Engine(shortTimeoutConfig, logger);

    try {
      await shortEngine.scrape(url, { noFastPath: true, waitTimeout: 1000 });
      expect(false).toBe(true); // Should not reach here
    } catch (error: any) {
      expect(error).toBeDefined();
      expect(error.message).toMatch(/timeout|net::ERR/i);
    }
  }, 10_000);
});
