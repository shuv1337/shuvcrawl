import { JSDOM } from 'jsdom';
import type { Logger } from '../utils/logger.ts';

export type LinkSource = 'page' | 'sitemap';

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

// Sitemap parsing functions

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

function parseSitemapXml(xml: string, baseUrl: string): SitemapUrl[] {
  try {
    const dom = new JSDOM(xml, { contentType: 'application/xml' });
    const document = dom.window.document;
    const urls: SitemapUrl[] = [];

    for (const urlNode of Array.from(document.querySelectorAll('url'))) {
      const loc = urlNode.querySelector('loc')?.textContent;
      if (!loc) continue;

      try {
        const normalized = normalizeDiscoveredUrl(new URL(loc, baseUrl).toString());
        if (normalized) {
          urls.push({
            loc: normalized,
            lastmod: urlNode.querySelector('lastmod')?.textContent ?? undefined,
            changefreq: urlNode.querySelector('changefreq')?.textContent ?? undefined,
            priority: urlNode.querySelector('priority')?.textContent ?? undefined,
          });
        }
      } catch {
        // Skip invalid URLs
      }
    }

    return urls;
  } catch {
    return [];
  }
}

function parseSitemapIndex(xml: string, baseUrl: string): string[] {
  try {
    const dom = new JSDOM(xml, { contentType: 'application/xml' });
    const document = dom.window.document;
    const sitemaps: string[] = [];

    for (const sitemapNode of Array.from(document.querySelectorAll('sitemap'))) {
      const loc = sitemapNode.querySelector('loc')?.textContent;
      if (loc) {
        try {
          const resolved = new URL(loc, baseUrl).toString();
          sitemaps.push(resolved);
        } catch {
          // Skip invalid URLs
        }
      }
    }

    return sitemaps;
  } catch {
    return [];
  }
}

export async function discoverSitemapUrls(
  origin: string,
  logger?: Logger,
  timeout: number = 10000,
): Promise<DiscoveredUrl[]> {
  const discovered: DiscoveredUrl[] = [];
  const seenUrls = new Set<string>();

  const sitemapUrl = `${origin}/sitemap.xml`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(sitemapUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'shuvcrawl/1.0 (+https://github.com/shuv/shuvcrawl)',
        'Accept': 'application/xml, text/xml, */*',
      },
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      logger?.debug('sitemap.fetch.failed', { origin, status: response.status });
      return [];
    }

    const xml = await response.text();

    // Check if it's a sitemap index
    const isIndex = xml.includes('<sitemapindex');

    if (isIndex) {
      const sitemaps = parseSitemapIndex(xml, origin);
      logger?.debug('sitemap.index.found', { origin, sitemaps: sitemaps.length });

      // Fetch each child sitemap (one level deep)
      for (const childSitemap of sitemaps.slice(0, 5)) { // Limit to 5 child sitemaps
        try {
          const childController = new AbortController();
          const childTimeout = setTimeout(() => childController.abort(), timeout);

          const childResponse = await fetch(childSitemap, {
            signal: childController.signal,
            headers: {
              'User-Agent': 'shuvcrawl/1.0 (+https://github.com/shuv/shuvcrawl)',
              'Accept': 'application/xml, text/xml, */*',
            },
          }).finally(() => clearTimeout(childTimeout));

          if (childResponse.ok) {
            const childXml = await childResponse.text();
            const urls = parseSitemapXml(childXml, origin);

            for (const url of urls) {
              if (!seenUrls.has(url.loc)) {
                seenUrls.add(url.loc);
                discovered.push({
                  url: url.loc,
                  source: 'sitemap',
                  text: null,
                  rel: null,
                });
              }
            }
          }
        } catch (error) {
          logger?.debug('sitemap.child.fetch.failed', { childSitemap, error: String(error) });
        }
      }
    } else {
      // Regular sitemap
      const urls = parseSitemapXml(xml, origin);
      logger?.debug('sitemap.found', { origin, urls: urls.length });

      for (const url of urls) {
        if (!seenUrls.has(url.loc)) {
          seenUrls.add(url.loc);
          discovered.push({
            url: url.loc,
            source: 'sitemap',
            text: null,
            rel: null,
          });
        }
      }
    }
  } catch (error) {
    logger?.debug('sitemap.discovery.failed', { origin, error: String(error) });
  }

  return discovered;
}
