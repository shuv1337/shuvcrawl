import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { ShuvcrawlConfig } from '../config/schema.ts';

export type ExtractedDocument = {
  title: string;
  html: string;
  textContent: string;
  extractionMethod: 'readability' | 'selector' | 'fullbody';
  extractionConfidence: number;
};

export function extractDocument(html: string, url: string, config: ShuvcrawlConfig, selectorOverride?: string): ExtractedDocument {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document as Document;

  for (const selector of config.extraction.stripSelectors) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }

  if (selectorOverride) {
    const selected = document.querySelector(selectorOverride);
    if (selected) {
      return {
        title: document.title || 'Untitled',
        html: selected.innerHTML,
        textContent: selected.textContent?.trim() ?? '',
        extractionMethod: 'selector',
        extractionConfidence: 0.9,
      };
    }
  }

  const reader = new Readability(document).parse();
  if (reader?.content && (reader.textContent?.length ?? 0) > 0) {
    return {
      title: reader.title || document.title || 'Untitled',
      html: reader.content,
      textContent: reader.textContent ?? '',
      extractionMethod: 'readability',
      extractionConfidence: 0.8,
    };
  }

  return {
    title: document.title || 'Untitled',
    html: document.body?.innerHTML ?? html,
    textContent: document.body?.textContent?.trim() ?? '',
    extractionMethod: 'fullbody',
    extractionConfidence: 0.4,
  };
}
