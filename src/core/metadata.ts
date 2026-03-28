import { JSDOM } from 'jsdom';

export type ScrapeMetadata = {
  requestId: string;
  url: string;
  originalUrl: string;
  finalUrl: string;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  description: string | null;
  siteName: string | null;
  language: string | null;
  wordCount: number;
  extractionMethod: 'readability' | 'selector' | 'fullbody';
  extractionConfidence: number | null;
  bypassMethod: 'fast-path' | 'bpc-extension' | 'direct';
  waitStrategy: 'load' | 'networkidle' | 'selector' | 'sleep';
  browserUsed: boolean;
  scrapedAt: string;
  elapsed: number;
  status: 'success' | 'partial' | 'failed' | 'blocked' | 'robots-denied';
  openGraph: Record<string, string> | null;
  twitterCards: Record<string, string> | null;
  ldJson: object[] | null;
};

export function buildMetadata(params: {
  requestId: string;
  url: string;
  originalUrl: string;
  finalUrl: string;
  html: string;
  title: string;
  wordCount: number;
  extractionMethod: 'readability' | 'selector' | 'fullbody';
  extractionConfidence: number;
  bypassMethod: 'fast-path' | 'bpc-extension' | 'direct';
  browserUsed: boolean;
  elapsed: number;
}): ScrapeMetadata {
  const dom = new JSDOM(params.html, { url: params.finalUrl });
  const document = dom.window.document;
  const og = Object.fromEntries(
    Array.from(document.querySelectorAll('meta[property^="og:"]'))
      .map(node => {
        const meta = node as HTMLMetaElement;
        return [meta.getAttribute('property') ?? '', meta.getAttribute('content') ?? ''] as const;
      })
      .filter(([key]) => key),
  );
  const twitter = Object.fromEntries(
    Array.from(document.querySelectorAll('meta[name^="twitter:"]'))
      .map(node => {
        const meta = node as HTMLMetaElement;
        return [meta.getAttribute('name') ?? '', meta.getAttribute('content') ?? ''] as const;
      })
      .filter(([key]) => key),
  );
  const ldJson = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap(node => {
    const script = node as HTMLScriptElement;
    try {
      return [JSON.parse(script.textContent ?? '{}')];
    } catch {
      return [];
    }
  });
  return {
    requestId: params.requestId,
    url: params.url,
    originalUrl: params.originalUrl,
    finalUrl: params.finalUrl,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    title: params.title,
    author: document.querySelector('meta[name="author"]')?.getAttribute('content') ?? null,
    publishedAt: document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ?? null,
    modifiedAt: document.querySelector('meta[property="article:modified_time"]')?.getAttribute('content') ?? null,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    siteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? null,
    language: document.documentElement.lang || null,
    wordCount: params.wordCount,
    extractionMethod: params.extractionMethod,
    extractionConfidence: params.extractionConfidence,
    bypassMethod: params.bypassMethod,
    waitStrategy: 'load',
    browserUsed: params.browserUsed,
    scrapedAt: new Date().toISOString(),
    elapsed: params.elapsed,
    status: params.wordCount > 0 ? 'success' : 'partial',
    openGraph: Object.keys(og).length ? og : null,
    twitterCards: Object.keys(twitter).length ? twitter : null,
    ldJson: ldJson.length ? ldJson : null,
  };
}
