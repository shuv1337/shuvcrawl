/**
 * Integration test setup - shared helpers for real browser tests
 */
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ShuvcrawlConfig } from '../../src/config/schema.ts';
import type { Logger } from '../../src/utils/logger.ts';

export type IntegrationContext = {
  tmpDir: string;
  config: ShuvcrawlConfig;
  logger: Logger;
  cleanup: () => Promise<void>;
};

/**
 * Create a real logger that writes structured JSON to stderr
 */
export function createIntegrationLogger(): Logger {
  function emit(level: string, event: string, fields?: Record<string, unknown>) {
    const payload = {
      ts: new Date().toISOString(),
      level,
      event: `test.${event}`,
      ...fields,
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

/**
 * Detect browser executable for tests - checks multiple sources
 */
function detectBrowserForTests(): string | null {
  // Check environment variables first
  const envPaths = [
    process.env.SHUVCRAWL_BROWSER_EXECUTABLE,
    process.env.SHUVCRAWL_BROWSER_EXECUTABLE_PATH,
    process.env.SHUVCRAWL_BROWSER_EXECUTABLEPATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  ].filter(Boolean) as string[];

  for (const candidate of envPaths) {
    if (existsSync(candidate)) return candidate;
  }

  // Check common system locations
  const systemPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  for (const candidate of systemPaths) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Create a real config pointing to temp directories
 */
export async function createIntegrationConfig(tmpDir: string): Promise<ShuvcrawlConfig> {
  const browserDir = path.join(tmpDir, 'browser');
  const cacheDir = path.join(tmpDir, 'cache');
  const artifactsDir = path.join(tmpDir, 'artifacts');
  const outputDir = path.join(tmpDir, 'output');

  // Create all necessary directories
  await mkdir(browserDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  // Detect browser executable
  const executablePath = detectBrowserForTests();

  return {
    output: {
      dir: outputDir,
      format: 'markdown',
      includeMetadata: true,
      metaLog: true,
      writeArtifactsOnFailure: true,
    },
    browser: {
      headless: true,
      executablePath,
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
      ],
      defaultTimeout: 30_000,
      viewport: { width: 1920, height: 1080 },
      profileRoot: path.join(browserDir, 'profiles'),
      templateProfile: path.join(browserDir, 'template'),
      runtimeProfile: path.join(browserDir, 'runtime'),
      resetOnStart: true,
    },
    bpc: {
      enabled: true,
      sourceMode: 'bundled',
      path: './bpc-chrome',
      source: null,
      mode: 'conservative',
      enableUpdatedSites: true,
      enableCustomSites: false,
      excludeDomains: [],
      storageOverrides: {},
    },
    fastPath: {
      enabled: false, // Disable fast path for integration tests
      userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      referer: 'https://www.google.com/',
      minContentLength: 500,
      tls: {
        rejectUnauthorized: true,
        caBundlePath: null,
      },
    },
    extraction: {
      selectorOverrides: {},
      stripSelectors: ['nav', 'footer', 'header', '.advertisement'],
      minConfidence: 0.5,
    },
    artifacts: {
      enabled: true,
      dir: artifactsDir,
      onFailure: true,
      includeRawHtml: true,
      includeCleanHtml: true,
      includeScreenshot: true,
      includeConsole: true,
    },
    proxy: {
      url: null,
      rotatePerRequest: false,
    },
    api: {
      port: 3777,
      host: '0.0.0.0',
      token: null,
      rateLimit: 0,
    },
    cache: {
      enabled: false, // Disable cache for integration tests
      ttl: 3600,
      dir: cacheDir,
      cacheFailures: false,
      staleOnError: false,
    },
    crawl: {
      defaultDepth: 3,
      defaultLimit: 50,
      delay: 0, // No delay for tests
      respectRobots: false, // Don't check robots.txt in tests
    },
    telemetry: {
      logs: true,
      logLevel: 'info',
      otlpHttpEndpoint: null,
      serviceName: 'shuvcrawl-test',
      exporter: 'none',
    },
    storage: {
      jobDbPath: path.join(tmpDir, 'jobs.db'),
    },
  };
}

/**
 * Check if browser binary is available
 */
export function isBrowserAvailable(config: ShuvcrawlConfig): boolean {
  return config.browser.executablePath !== null && existsSync(config.browser.executablePath);
}

/**
 * Create a complete test context with temp directories and config
 */
export async function createTestContext(): Promise<IntegrationContext> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-integ-'));
  const config = await createIntegrationConfig(tmpDir);
  const logger = createIntegrationLogger();

  const cleanup = async () => {
    await rm(tmpDir, { recursive: true, force: true });
  };

  return { tmpDir, config, logger, cleanup };
}

/**
 * Verify PNG file by checking magic bytes
 */
export async function verifyPngFile(filePath: string): Promise<boolean> {
  const data = await readFile(filePath);
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  return data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4E &&
    data[3] === 0x47;
}

/**
 * Verify PDF file by checking header
 */
export async function verifyPdfFile(filePath: string): Promise<boolean> {
  const data = await readFile(filePath, { encoding: 'utf8', flag: 'r' });
  return data.startsWith('%PDF');
}
