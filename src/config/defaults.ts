import type { ShuvcrawlConfig } from './schema.ts';
import { ShuvcrawlConfigSchema } from './schema.ts';
import { detectBrowserExecutable } from '../utils/browser-detect.ts';

export const defaultConfig: ShuvcrawlConfig = ShuvcrawlConfigSchema.parse({
  output: {},
  browser: {
    executablePath: detectBrowserExecutable(),
  },
  bpc: {},
  fastPath: {},
  extraction: {},
  artifacts: {},
  proxy: {},
  api: {},
  cache: {},
  crawl: {},
  telemetry: {},
  storage: {},
});
