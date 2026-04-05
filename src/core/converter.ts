import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});
turndown.use(gfm);
turndown.remove(['script', 'style', 'meta', 'link', 'noscript', 'iframe', 'object', 'embed', 'svg']);

export function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(
      String(html || '')
        .replace(/<!--[\s\S]*?-->/g, '\n')
        .replace(/<(script|style|noscript|iframe|object|embed|svg)[^>]*>[\s\S]*?<\/\1>/gi, '\n'),
    )
    .replace(/^\s*<\/?(?:div|span|section|article|main|header|footer|nav|aside|figure|figcaption|form|button|picture|source|template)[^>]*>\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
