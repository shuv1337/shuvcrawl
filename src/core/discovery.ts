import { JSDOM } from 'jsdom';

export type LinkSource = 'page';

export type DiscoveredUrl = {
  url: string;
  source: LinkSource;
  text: string | null;
  rel: string | null;
};

export function discoverPageLinks(html: string, baseUrl: string): DiscoveredUrl[] {
  const dom = new JSDOM(html, { url: baseUrl });
  const document = dom.window.document;
  const seen = new Set<string>();
  const results: DiscoveredUrl[] = [];

  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href');
    if (!href) continue;

    try {
      const resolved = new URL(href, baseUrl);
      resolved.hash = '';
      const normalized = normalizeDiscoveredUrl(resolved.toString());
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      results.push({
        url: normalized,
        source: 'page',
        text: anchor.textContent?.trim() || null,
        rel: anchor.getAttribute('rel'),
      });
    } catch {
      continue;
    }
  }

  return results;
}

export function normalizeDiscoveredUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function defaultMapInclude(seedUrl: string): string {
  const seed = new URL(seedUrl);
  return `${seed.protocol}//${seed.host}/**`;
}

export function isSameOrigin(seedUrl: string, candidateUrl: string): boolean {
  return new URL(seedUrl).origin === new URL(candidateUrl).origin;
}

export function matchesGlob(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^\\s]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function shouldIncludeUrl(
  url: string,
  options: { include?: string[]; exclude?: string[]; sameOriginSeed?: string },
): { included: boolean; reason?: 'filtered-include' | 'filtered-exclude' | 'cross-origin' } {
  if (options.sameOriginSeed && !isSameOrigin(options.sameOriginSeed, url)) {
    return { included: false, reason: 'cross-origin' };
  }

  if (options.include?.length && !options.include.some(pattern => matchesGlob(pattern, url))) {
    return { included: false, reason: 'filtered-include' };
  }

  if (options.exclude?.length && options.exclude.some(pattern => matchesGlob(pattern, url))) {
    return { included: false, reason: 'filtered-exclude' };
  }

  return { included: true };
}
