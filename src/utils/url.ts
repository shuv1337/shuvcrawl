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
