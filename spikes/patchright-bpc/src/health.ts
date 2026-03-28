import type { SpikeLogger } from './logger.ts';
import type { StorageSnapshot } from './storage.ts';

export type HealthResult = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: unknown }>;
};

export async function runHealthCheck(
  workerInfo: { extensionId: string; workerUrl: string },
  snapshot: StorageSnapshot,
  logger: SpikeLogger,
): Promise<HealthResult> {
  const checks = [
    { name: 'service-worker-present', ok: Boolean(workerInfo.workerUrl), detail: workerInfo.workerUrl },
    { name: 'extension-id-present', ok: Boolean(workerInfo.extensionId), detail: workerInfo.extensionId },
    { name: 'storage-readable-sites', ok: typeof snapshot.sites === 'object', detail: snapshot.sites ? 'present' : 'missing' },
    { name: 'storage-readable-sites_excluded', ok: Array.isArray(snapshot.sites_excluded), detail: snapshot.sites_excluded },
    { name: 'storage-readable-optInUpdate', ok: typeof snapshot.optInUpdate === 'boolean', detail: snapshot.optInUpdate },
  ];

  const ok = checks.every(check => check.ok);
  await logger.log(ok ? 'bpc.healthcheck.pass' : 'bpc.healthcheck.fail', { checks });
  return { ok, checks };
}
