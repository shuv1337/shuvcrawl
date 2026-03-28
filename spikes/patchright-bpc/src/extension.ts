import type { BrowserContext } from 'patchright';
import type { SpikeLogger } from './logger.ts';
import { writeJsonArtifact } from './artifacts.ts';

declare const chrome: any;

export type ExtensionWorkerInfo = {
  worker: any;
  extensionId: string;
  workerUrl: string;
  manifest?: Record<string, unknown>;
  readyDurationMs: number;
};

function selectExtensionWorker(context: BrowserContext): any | undefined {
  return context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://'));
}

export async function waitForExtensionWorker(
  context: BrowserContext,
  timeoutMs: number,
  logger: SpikeLogger,
  artifactDir: string,
): Promise<ExtensionWorkerInfo> {
  const startedAt = Date.now();
  await logger.log('extension.worker.wait.start', { timeoutMs });

  while (Date.now() - startedAt < timeoutMs) {
    const worker = selectExtensionWorker(context);
    if (worker) {
      const workerUrl = worker.url();
      const extensionId = workerUrl.split('/')[2] ?? 'unknown';
      const manifest = await worker.evaluate(async () => chrome.runtime.getManifest());
      const readyDurationMs = Date.now() - startedAt;
      await logger.log('extension.worker.ready', { extensionId, workerUrl, readyDurationMs, manifestVersion: manifest?.manifest_version });
      return {
        worker,
        extensionId,
        workerUrl,
        manifest,
        readyDurationMs,
      };
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  const currentWorkers = context.serviceWorkers().map(worker => worker.url());
  await writeJsonArtifact(artifactDir, 'worker-timeout.json', {
    timeoutMs,
    currentWorkers,
  });
  await logger.log('extension.worker.timeout', { timeoutMs, currentWorkers });
  throw new Error(`Timed out waiting ${timeoutMs}ms for extension service worker`);
}
