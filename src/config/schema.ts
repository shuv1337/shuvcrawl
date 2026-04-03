import { z } from 'zod';

export const NativeBrowserConfigSchema = z.object({
  enabled: z.boolean().default(false),
  wsEndpoint: z.string().default('ws://host.docker.internal:9224'),
});

export const BrowserConfigSchema = z.object({
  headless: z.boolean().default(false),
  executablePath: z.string().nullable().default(null),
  args: z.array(z.string()).default([]),
  defaultTimeout: z.number().int().positive().default(30_000),
  viewport: z.object({
    width: z.number().int().positive().default(1920),
    height: z.number().int().positive().default(1080),
  }).default({ width: 1920, height: 1080 }),
  profileRoot: z.string().default('~/.shuvcrawl/browser'),
  templateProfile: z.string().default('~/.shuvcrawl/browser/template'),
  runtimeProfile: z.string().default('~/.shuvcrawl/browser/runtime'),
  resetOnStart: z.boolean().default(false),
  native: NativeBrowserConfigSchema.default({ enabled: false }),
});

export const BpcConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sourceMode: z.enum(['bundled', 'managed', 'custom']).default('bundled'),
  path: z.string().default('./bpc-chrome'),
  source: z.string().nullable().default(null),
  mode: z.enum(['conservative', 'aggressive']).default('conservative'),
  enableUpdatedSites: z.boolean().default(true),
  enableCustomSites: z.boolean().default(false),
  excludeDomains: z.array(z.string()).default([]),
  storageOverrides: z.record(z.string(), z.any()).default({}),
});

export const FastPathTlsConfigSchema = z.object({
  rejectUnauthorized: z.boolean().default(true),
  caBundlePath: z.string().nullable().default(null),
});

export const FastPathConfigSchema = z.object({
  enabled: z.boolean().default(true),
  userAgent: z.string().default('Googlebot/2.1 (+http://www.google.com/bot.html)'),
  referer: z.string().default('https://www.google.com/'),
  minContentLength: z.number().int().nonnegative().default(500),
  tls: FastPathTlsConfigSchema.default({ rejectUnauthorized: true, caBundlePath: null }),
});

export const ExtractionConfigSchema = z.object({
  selectorOverrides: z.record(z.string(), z.string()).default({}),
  stripSelectors: z.array(z.string()).default([
    'nav',
    'footer',
    'header',
    '.advertisement',
    '.ad-container',
    '[data-ad]',
    '.social-share',
    '.related-articles',
    '.newsletter-signup',
  ]),
  minConfidence: z.number().min(0).max(1).default(0.5),
});

export const ArtifactsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dir: z.string().default('./output/_artifacts'),
  onFailure: z.boolean().default(true),
  includeRawHtml: z.boolean().default(false),
  includeCleanHtml: z.boolean().default(true),
  includeScreenshot: z.boolean().default(true),
  includeConsole: z.boolean().default(true),
});

export const ProxyConfigSchema = z.object({
  url: z.string().nullable().default(null),
  rotatePerRequest: z.boolean().default(false),
});

export const ApiConfigSchema = z.object({
  port: z.number().int().positive().default(3777),
  host: z.string().default('0.0.0.0'),
  token: z.string().nullable().default(null),
  rateLimit: z.number().int().nonnegative().default(0),
});

export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ttl: z.number().int().nonnegative().default(3600),
  dir: z.string().default('~/.shuvcrawl/cache'),
  cacheFailures: z.boolean().default(false),
  staleOnError: z.boolean().default(false),
});

export const CrawlConfigSchema = z.object({
  defaultDepth: z.number().int().positive().default(3),
  defaultLimit: z.number().int().positive().default(50),
  delay: z.number().int().nonnegative().default(1000),
  respectRobots: z.boolean().default(true),
});

export const TelemetryConfigSchema = z.object({
  logs: z.boolean().default(true),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  otlpHttpEndpoint: z.string().nullable().default(null),
  serviceName: z.string().default('shuvcrawl'),
  exporter: z.enum(['otlp-http', 'none']).default('otlp-http'),
});

export const StorageConfigSchema = z.object({
  jobDbPath: z.string().default('~/.shuvcrawl/data/jobs.db'),
});

export const OutputConfigSchema = z.object({
  dir: z.string().default('./output'),
  format: z.enum(['markdown', 'json']).default('markdown'),
  includeMetadata: z.boolean().default(true),
  metaLog: z.boolean().default(true),
  writeArtifactsOnFailure: z.boolean().default(true),
});

export const ShuvcrawlConfigSchema = z.object({
  output: OutputConfigSchema,
  browser: BrowserConfigSchema,
  bpc: BpcConfigSchema,
  fastPath: FastPathConfigSchema,
  extraction: ExtractionConfigSchema,
  artifacts: ArtifactsConfigSchema,
  proxy: ProxyConfigSchema,
  api: ApiConfigSchema,
  cache: CacheConfigSchema,
  crawl: CrawlConfigSchema,
  telemetry: TelemetryConfigSchema,
  storage: StorageConfigSchema,
});

export type ShuvcrawlConfig = z.infer<typeof ShuvcrawlConfigSchema>;
