import { existsSync } from 'node:fs';

export function detectBrowserExecutable(): string | null {
  const candidates = [
    process.env.SHUVCRAWL_BROWSER_EXECUTABLEPATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}
