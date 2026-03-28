import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService();
turndown.use(gfm);

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
