import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type SpikePaths = {
  repoRoot: string;
  spikeRoot: string;
  outputRoot: string;
  logsDir: string;
  artifactsDir: string;
  reportsDir: string;
  profilesRoot: string;
  templateProfileDir: string;
  runtimeProfileDir: string;
  bpcPath: string;
};

export function resolveProjectRoots(outputRootOverride?: string, bpcPathOverride?: string): SpikePaths {
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const spikeRoot = path.resolve(srcDir, '..');
  const repoRoot = path.resolve(spikeRoot, '..', '..');
  const outputRoot = outputRootOverride ? path.resolve(outputRootOverride) : path.join(spikeRoot, 'output');
  const profilesRoot = path.join(outputRoot, 'profiles');
  const bpcPath = path.resolve(bpcPathOverride ?? path.join(repoRoot, 'bpc-chrome'));

  return {
    repoRoot,
    spikeRoot,
    outputRoot,
    logsDir: path.join(outputRoot, 'logs'),
    artifactsDir: path.join(outputRoot, 'artifacts'),
    reportsDir: path.join(outputRoot, 'reports'),
    profilesRoot,
    templateProfileDir: path.join(profilesRoot, 'template'),
    runtimeProfileDir: path.join(profilesRoot, 'runtime'),
    bpcPath,
  };
}

export async function ensureBaseDirectories(paths: SpikePaths): Promise<void> {
  await Promise.all([
    mkdir(paths.outputRoot, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.reportsDir, { recursive: true }),
    mkdir(paths.profilesRoot, { recursive: true }),
  ]);
}

export function assertPathExists(targetPath: string, label: string): void {
  if (!existsSync(targetPath)) {
    throw new Error(`${label} not found at ${targetPath}`);
  }
}
