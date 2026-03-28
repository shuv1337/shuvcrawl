import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { SpikeLogger } from './logger.ts';

const TRANSIENT_PROFILE_FILES = [
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'DevToolsActivePort',
];

export async function ensureProfileRoot(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function cleanTransientProfileFiles(dir: string): Promise<void> {
  for (const name of TRANSIENT_PROFILE_FILES) {
    const target = path.join(dir, name);
    if (existsSync(target)) {
      await rm(target, { force: true, recursive: true });
    }
  }
}

export async function initializeEmptyProfile(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

export async function copyProfile(sourceDir: string, targetDir: string): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
  await cleanTransientProfileFiles(targetDir);
}

export async function resetRuntimeProfile(templateDir: string, runtimeDir: string, logger: SpikeLogger): Promise<{ bytes: number }> {
  const startedAt = Date.now();
  await copyProfile(templateDir, runtimeDir);
  const bytes = await directorySize(runtimeDir);
  await logger.log('profile.runtime.reset', {
    templateDir,
    runtimeDir,
    durationMs: Date.now() - startedAt,
    bytes,
  });
  return { bytes };
}

export async function directorySize(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(target);
    } else if (entry.isFile()) {
      total += (await stat(target)).size;
    }
  }
  return total;
}
