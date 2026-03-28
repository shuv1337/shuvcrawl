import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureArtifactDir(root: string, requestId: string): Promise<string> {
  const dir = path.join(root, requestId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeArtifact(dir: string, name: string, content: string): Promise<string> {
  const target = path.join(dir, name);
  await writeFile(target, content, 'utf8');
  return target;
}
