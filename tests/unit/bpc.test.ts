import { expect, test } from 'bun:test';
import { BpcAdapter } from '../../src/core/bpc.ts';

test('BpcAdapter maps config into extension storage state', () => {
  const adapter = new BpcAdapter({
    enabled: true,
    sourceMode: 'bundled',
    path: './bpc-chrome',
    source: null,
    mode: 'aggressive',
    enableUpdatedSites: true,
    enableCustomSites: true,
    excludeDomains: ['www.wsj.com', 'example.com'],
    storageOverrides: {
      sites_custom: { Example: { domain: 'example.com' } },
      sites_updated: { Example: { domain: 'example.com' } },
    },
  });

  expect(adapter.buildStorageState()).toEqual({
    sites_excluded: ['example.com', 'wsj.com'],
    optIn: true,
    customOptIn: true,
    optInUpdate: true,
    sites_updated: { Example: { domain: 'example.com' } },
    sites_custom: { Example: { domain: 'example.com' } },
  });
});
