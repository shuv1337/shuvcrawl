import type { ShuvcrawlConfig } from '../config/schema.ts';

export type BpcStorageState = {
  sites_excluded: string[];
  optIn: boolean;
  customOptIn: boolean;
  optInUpdate: boolean;
  sites_updated?: Record<string, unknown>;
  sites_custom?: Record<string, unknown>;
};

export class BpcAdapter {
  constructor(private readonly config: ShuvcrawlConfig['bpc']) {}

  buildStorageState(): BpcStorageState {
    return {
      sites_excluded: Array.from(new Set(this.config.excludeDomains.map(domain => domain.replace(/^www\./, '').toLowerCase()))).sort(),
      optIn: this.config.mode === 'aggressive',
      customOptIn: this.config.enableCustomSites,
      optInUpdate: this.config.enableUpdatedSites,
      sites_updated: (this.config.storageOverrides.sites_updated as Record<string, unknown> | undefined) ?? {},
      sites_custom: (this.config.storageOverrides.sites_custom as Record<string, unknown> | undefined) ?? {},
    };
  }

  getExtensionFlags(extensionPath: string): string[] {
    return [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ];
  }
}
