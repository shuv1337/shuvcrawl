import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureRunArtifactDir(artifactsDir: string, runId: string): Promise<string> {
  const dir = path.join(artifactsDir, runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeJsonArtifact(dir: string, name: string, value: unknown): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return target;
}

export async function writeTextArtifact(dir: string, name: string, value: string): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, value, 'utf8');
  return target;
}
