import type { SpikeLogger } from './logger.ts';
import { writeJsonArtifact } from './artifacts.ts';

declare const chrome: any;

export const BPC_STORAGE_KEYS = [
  'sites',
  'sites_excluded',
  'sites_custom',
  'sites_updated',
  'optIn',
  'customOptIn',
  'optInUpdate',
] as const;

export type StorageSnapshot = Record<string, unknown>;

const BPC_STORAGE_DEFAULTS: StorageSnapshot = {
  sites: {},
  sites_excluded: [],
  sites_custom: {},
  sites_updated: {},
  optIn: false,
  customOptIn: false,
  optInUpdate: true,
};

export async function readStorageSnapshot(worker: any, logger: SpikeLogger, artifactDir: string, name: string): Promise<StorageSnapshot> {
  const snapshot = await worker.evaluate(async (defaults: Record<string, unknown>) => {
    return await new Promise<Record<string, unknown>>(resolve => {
      chrome.storage.local.get(defaults, (items: Record<string, unknown>) => resolve(items));
    });
  }, BPC_STORAGE_DEFAULTS);

  await logger.log('bpc.storage.snapshot', {
    name,
    keys: BPC_STORAGE_KEYS,
    presentKeys: Object.keys(snapshot),
  });
  await writeJsonArtifact(artifactDir, `${name}.json`, snapshot);
  return snapshot;
}

export async function writeStoragePatch(worker: any, patch: StorageSnapshot, logger: SpikeLogger): Promise<void> {
  const startedAt = Date.now();
  await logger.log('bpc.storage.write.start', { patchKeys: Object.keys(patch) });
  await worker.evaluate(async (value: StorageSnapshot) => {
    await new Promise<void>(resolve => {
      chrome.storage.local.set(value as Record<string, unknown>, () => resolve());
    });
  }, patch);
  await logger.log('bpc.storage.write.success', {
    patchKeys: Object.keys(patch),
    durationMs: Date.now() - startedAt,
  });
}

export async function runControlledMutation(worker: any, logger: SpikeLogger, artifactDir: string): Promise<{ before: StorageSnapshot; after: StorageSnapshot; restore: StorageSnapshot; patch: StorageSnapshot }> {
  const before = await readStorageSnapshot(worker, logger, artifactDir, 'storage-before');

  const beforeExcluded = Array.isArray(before.sites_excluded) ? [...before.sites_excluded as string[]] : [];
  const patch: StorageSnapshot = {
    sites_excluded: Array.from(new Set([...beforeExcluded, 'example.com'])).sort(),
    optIn: true,
    optInUpdate: before.optInUpdate ?? true,
  };

  await writeStoragePatch(worker, patch, logger);
  const after = await readStorageSnapshot(worker, logger, artifactDir, 'storage-after');

  const restore: StorageSnapshot = {
    sites_excluded: before.sites_excluded ?? [],
    optIn: before.optIn ?? false,
    optInUpdate: before.optInUpdate ?? true,
  };

  await writeStoragePatch(worker, restore, logger);
  await readStorageSnapshot(worker, logger, artifactDir, 'storage-restored');
  await writeJsonArtifact(artifactDir, 'storage-diff.json', {
    patch,
    before,
    after,
    restore,
  });

  return { before, after, restore, patch };
}
