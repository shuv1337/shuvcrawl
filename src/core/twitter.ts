// src/core/twitter.ts
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';

// Match twitter.com and x.com tweet URLs
const TWEET_URL_RE = /^https?:\/\/(?:(?:www\.|mobile\.)?(?:twitter\.com|x\.com))\/(\w+)\/status\/(\d+)/i;

export function isTweetUrl(url: string): boolean {
  return TWEET_URL_RE.test(url);
}

export function parseTweetUrl(url: string): { username: string; tweetId: string } | null {
  const match = url.match(TWEET_URL_RE);
  if (!match) return null;
  return { username: match[1], tweetId: match[2] };
}

interface FxAuthor {
  name: string;
  screen_name: string;
  description?: string;
  followers?: number;
  avatar_url?: string;
  url?: string;
  verification?: { verified?: boolean; type?: string };
}

interface FxMedia {
  url: string;
  thumbnail_url?: string;
  type: string;
  width?: number;
  height?: number;
  duration?: number;
  alt_text?: string;
}

interface FxTweet {
  url: string;
  id: string;
  text: string;
  raw_text?: { text: string };
  author: FxAuthor;
  replies: number;
  retweets: number;
  likes: number;
  bookmarks: number;
  quotes: number;
  views: number;
  created_at: string;
  created_timestamp: number;
  is_note_tweet?: boolean;
  lang?: string;
  source?: string;
  quote?: FxTweet;
  replying_to?: string;
  replying_to_status?: string;
  media?: {
    all?: FxMedia[];
    photos?: FxMedia[];
    videos?: FxMedia[];
  };
  community_note?: { text: string } | null;
}

interface FxResponse {
  code: number;
  message: string;
  tweet?: FxTweet;
}

export interface TwitterResult {
  content: string;       // markdown
  html: string;          // generated HTML
  title: string;
  author: string;
  wordCount: number;
  tweetData: FxTweet;    // raw data for consumers who want it
}

function formatEngagement(tweet: FxTweet): string {
  const parts: string[] = [];
  if (tweet.replies) parts.push(`${tweet.replies.toLocaleString()} replies`);
  if (tweet.retweets) parts.push(`${tweet.retweets.toLocaleString()} retweets`);
  if (tweet.likes) parts.push(`${tweet.likes.toLocaleString()} likes`);
  if (tweet.bookmarks) parts.push(`${tweet.bookmarks.toLocaleString()} bookmarks`);
  if (tweet.views) parts.push(`${tweet.views.toLocaleString()} views`);
  return parts.join(' · ');
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function tweetToMarkdown(tweet: FxTweet): string {
  const lines: string[] = [];
  
  // Author header
  const verified = tweet.author.verification?.verified ? ' ✓' : '';
  lines.push(`# ${tweet.author.name}${verified} (@${tweet.author.screen_name})`);
  lines.push('');
  
  // Date and source
  lines.push(`*${formatDate(tweet.created_timestamp)}${tweet.source ? ` · ${tweet.source}` : ''}*`);
  lines.push('');
  
  // Replying to
  if (tweet.replying_to) {
    lines.push(`> Replying to @${tweet.replying_to}`);
    lines.push('');
  }
  
  // Tweet text
  lines.push(tweet.text);
  lines.push('');
  
  // Media
  if (tweet.media?.all?.length) {
    for (const m of tweet.media.all) {
      if (m.type === 'photo') {
        lines.push(`![Image](${m.url})`);
      } else if (m.type === 'video' || m.type === 'gif') {
        const thumb = m.thumbnail_url ? `![Video thumbnail](${m.thumbnail_url})` : '';
        const duration = m.duration ? ` (${Math.round(m.duration)}s)` : '';
        lines.push(`🎥 [Video${duration}](${m.url})`);
        if (thumb) lines.push(thumb);
      }
    }
    lines.push('');
  }
  
  // Community note
  if (tweet.community_note?.text) {
    lines.push('> **Community Note:** ' + tweet.community_note.text);
    lines.push('');
  }
  
  // Quoted tweet
  if (tweet.quote) {
    lines.push('---');
    lines.push('');
    const qv = tweet.quote.author.verification?.verified ? ' ✓' : '';
    lines.push(`> **${tweet.quote.author.name}${qv}** (@${tweet.quote.author.screen_name})`);
    lines.push('>');
    // Indent quoted text
    for (const line of tweet.quote.text.split('\n')) {
      lines.push(`> ${line}`);
    }
    lines.push('>');
    lines.push(`> ${formatEngagement(tweet.quote)}`);
    
    // Quoted media
    if (tweet.quote.media?.all?.length) {
      lines.push('>');
      for (const m of tweet.quote.media.all) {
        if (m.type === 'photo') {
          lines.push(`> ![Image](${m.url})`);
        } else if (m.type === 'video' || m.type === 'gif') {
          lines.push(`> 🎥 [Video](${m.url})`);
        }
      }
    }
    lines.push('');
  }
  
  // Engagement
  lines.push('---');
  lines.push('');
  lines.push(formatEngagement(tweet));
  lines.push('');
  
  return lines.join('\n');
}

function tweetToHtml(tweet: FxTweet): string {
  const verified = tweet.author.verification?.verified ? ' <span class="verified">✓</span>' : '';
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nl2br = (s: string) => escape(s).replace(/\n/g, '<br>');
  
  let html = `<article class="tweet">
<header>
  <strong>${escape(tweet.author.name)}${verified}</strong> <span class="handle">@${escape(tweet.author.screen_name)}</span>
  <time datetime="${new Date(tweet.created_timestamp * 1000).toISOString()}">${formatDate(tweet.created_timestamp)}</time>
</header>
<div class="tweet-text">${nl2br(tweet.text)}</div>`;

  if (tweet.media?.all?.length) {
    html += '\n<div class="tweet-media">';
    for (const m of tweet.media.all) {
      if (m.type === 'photo') {
        html += `\n  <img src="${escape(m.url)}" alt="Tweet image" />`;
      } else if (m.type === 'video' || m.type === 'gif') {
        html += `\n  <a href="${escape(m.url)}">Video</a>`;
      }
    }
    html += '\n</div>';
  }

  if (tweet.quote) {
    html += `\n<blockquote class="quoted-tweet">
  <strong>${escape(tweet.quote.author.name)}</strong> @${escape(tweet.quote.author.screen_name)}<br>
  ${nl2br(tweet.quote.text)}
</blockquote>`;
  }

  html += `\n<footer class="engagement">${escape(formatEngagement(tweet))}</footer>
</article>`;
  
  return html;
}

const FXTWITTER_API = 'https://api.fxtwitter.com';
const VXTWITTER_API = 'https://api.vxtwitter.com';

export async function fetchTweet(
  url: string,
  logger: Logger,
  telemetry: TelemetryContext,
): Promise<TwitterResult> {
  const parsed = parseTweetUrl(url);
  if (!parsed) {
    throw new Error(`Not a valid tweet URL: ${url}`);
  }

  const { username, tweetId } = parsed;
  let lastError: Error | null = null;

  // Try FxTwitter first, then VxTwitter as fallback
  for (const apiBase of [FXTWITTER_API, VXTWITTER_API]) {
    const apiUrl = `${apiBase}/${username}/status/${tweetId}`;
    try {
      const stage = await measureStage(logger, 'twitter.fetch', telemetry, async () => {
        const response = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'shuvcrawl/1.0',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          throw new Error(`${apiBase} returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as FxResponse;
        if (data.code !== 200 || !data.tweet) {
          throw new Error(`${apiBase} error: ${data.message || 'No tweet data'}`);
        }

        return data.tweet;
      });

      const tweet = stage.result;
      const markdown = tweetToMarkdown(tweet);
      const html = tweetToHtml(tweet);
      const wordCount = tweet.text.split(/\s+/).filter(Boolean).length;

      logger.info('twitter.fetched', {
        ...telemetry,
        tweetId,
        author: tweet.author.screen_name,
        api: apiBase,
        wordCount,
        elapsed: stage.elapsed,
      });

      return {
        content: markdown,
        html,
        title: `${tweet.author.name} on X: "${tweet.text.slice(0, 80)}${tweet.text.length > 80 ? '...' : ''}"`,
        author: `${tweet.author.name} (@${tweet.author.screen_name})`,
        wordCount,
        tweetData: tweet,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn('twitter.fetch.failed', {
        ...telemetry,
        api: apiBase,
        error: lastError.message,
      });
    }
  }

  throw lastError ?? new Error('Failed to fetch tweet from all providers');
}
