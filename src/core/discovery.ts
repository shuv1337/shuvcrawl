import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import type { Logger } from '../utils/logger.ts';

export type LinkSource = 'page' | 'sitemap';

export type BlockRole =
  | 'main_content'
  | 'related_content'
  | 'nav'
  | 'footer'
  | 'share'
  | 'social'
  | 'auth'
  | 'legal'
  | 'promo'
  | 'catalog'
  | 'unknown';

export type DiscoveredUrl = {
  url: string;
  source: LinkSource;
  text: string | null;
  rel: string | null;
  context?: string | null;
  domPath?: string | null;
  blockSignature?: string | null;
  blockRole?: BlockRole | null;
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

      const domPath = computeDomPath(anchor);
      const blockRoot = findBlockRoot(anchor, document.body ?? document.documentElement);
      const blockRole = inferBlockRole(anchor, blockRoot);
      const blockSignature = computeBlockSignature(baseUrl, blockRoot, blockRole);
      results.push({
        url: normalized,
        source: 'page',
        text: anchor.textContent?.trim() || null,
        rel: anchor.getAttribute('rel'),
        context: extractAnchorContext(anchor, blockRoot),
        domPath,
        blockSignature,
        blockRole,
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

const BLOCK_TAGS = new Set(['main', 'article', 'nav', 'footer', 'header', 'aside', 'section', 'div', 'ul', 'ol']);

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function computeDomPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.tagName.toLowerCase() !== 'html' && parts.length < 8) {
    const tag = current.tagName.toLowerCase();
    const id = current.id ? `#${current.id}` : '';
    const classes = [...current.classList].slice(0, 2).join('.');
    const classPart = classes ? `.${classes}` : '';
    parts.push(`${tag}${id}${classPart}`);
    current = current.parentElement;
  }

  return parts.reverse().join('/');
}

function findBlockRoot(anchor: Element, fallback: Element): Element {
  let current: Element | null = anchor;
  while (current && current !== fallback) {
    if (BLOCK_TAGS.has(current.tagName.toLowerCase())) {
      return current;
    }
    current = current.parentElement;
  }
  return fallback;
}

function collectTokens(anchor: Element, blockRoot: Element): string[] {
  const tokens = new Set<string>();
  let current: Element | null = anchor;
  let depth = 0;

  while (current && depth < 6) {
    tokens.add(current.tagName.toLowerCase());
    if (current.id) tokens.add(current.id.toLowerCase());
    for (const cls of current.classList) tokens.add(cls.toLowerCase());
    if (current === blockRoot) break;
    current = current.parentElement;
    depth += 1;
  }

  return [...tokens.values()];
}

function inferBlockRole(anchor: Element, blockRoot: Element): BlockRole {
  const tokens = collectTokens(anchor, blockRoot);
  const joined = tokens.join(' ');
  const href = anchor.getAttribute('href')?.toLowerCase() ?? '';
  const linkCount = blockRoot.querySelectorAll('a[href]').length;

  if (/(share|sharing|facebook|twitter|linkedin|mastodon|bluesky|reddit|hacker-news|whatsapp|telegram)/.test(joined) || /(?:facebook|twitter|linkedin|bsky|reddit|whatsapp|telegram)\.com|^https?:\/\/x\.com\//.test(href)) {
    return joined.includes('social') ? 'social' : 'share';
  }

  if (/(login|sign-?in|signin|sign-?up|signup|register|account|session|auth|oauth)/.test(joined) || /(login|signin|signup|register|account|session|auth)/.test(href)) {
    return 'auth';
  }

  if (/(footer|copyright|privacy|terms|cookie|legal)/.test(joined)) {
    return joined.includes('footer') ? 'footer' : 'legal';
  }

  if (/(nav|menu|navbar|breadcrumb|breadcrumbs|sidebar|masthead|header)/.test(joined)) {
    return 'nav';
  }

  if (/(promo|sponsor|banner|advert|advertisement|marketing|cta|hero)/.test(joined)) {
    return 'promo';
  }

  if (/(related|recommended|read-next|more-stories|next-post|similar)/.test(joined)) {
    return 'related_content';
  }

  if (blockRoot.tagName.toLowerCase() === 'main' || blockRoot.tagName.toLowerCase() === 'article') {
    return 'main_content';
  }

  if (linkCount >= 24) {
    return 'catalog';
  }

  return 'unknown';
}

function computeBlockSignature(baseUrl: string, blockRoot: Element, blockRole: BlockRole): string {
  const host = new URL(baseUrl).host.toLowerCase();
  const blockPath = computeDomPath(blockRoot);
  const blockShape = [
    blockRoot.tagName.toLowerCase(),
    blockRoot.id || '',
    [...blockRoot.classList].slice(0, 4).join('.'),
    String(blockRoot.querySelectorAll('a[href]').length),
  ].join('|');
  const hash = createHash('sha1').update(`${blockPath}|${blockShape}|${blockRole}`).digest('hex').slice(0, 12);
  return `host:${host}:block:${hash}`;
}

function extractAnchorContext(anchor: Element, blockRoot: Element): string | null {
  const direct = compactWhitespace(anchor.parentElement?.textContent ?? '');
  if (direct) return truncate(direct, 240);

  const block = compactWhitespace(blockRoot.textContent ?? '');
  return block ? truncate(block, 240) : null;
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
