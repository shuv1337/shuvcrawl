import { createHash } from 'node:crypto';

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  return url.toString();
}

export function slugFromUrl(input: string): string {
  const url = new URL(input);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'index';
  return path
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9-_/.]+/g, '-')
    .replace(/\//g, '__')
    .slice(0, 200);
}

export function slugFromUrlWithHash(input: string): string {
  const url = new URL(input);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 'index';

  let slug = path
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9-_/.]+/g, '-')
    .replace(/\//g, '__');

  // If slug exceeds 200 chars, truncate and add hash
  if (slug.length > 200) {
    const hash = createHash('sha256').update(path).digest('hex').slice(0, 7);
    slug = slug.slice(0, 192) + '-' + hash;
  }

  return slug;
}
