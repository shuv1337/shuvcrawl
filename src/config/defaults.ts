import type { ShuvcrawlConfig } from './schema.ts';
import { ShuvcrawlConfigSchema } from './schema.ts';
export const defaultConfig: ShuvcrawlConfig = ShuvcrawlConfigSchema.parse({
  output: {},
  browser: {},
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
