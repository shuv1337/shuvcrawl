import { describe, expect, test } from 'bun:test';
import { htmlToMarkdown } from '../../src/core/converter.ts';

describe('htmlToMarkdown', () => {
  test('drops obvious html boilerplate and keeps readable markdown', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>.hidden { display:none }</style>
        </head>
        <body>
          <article>
            <h1>Hello</h1>
            <p>World</p>
            <script>alert('x')</script>
          </article>
        </body>
      </html>
    `;

    const markdown = htmlToMarkdown(html);

    expect(markdown).toContain('# Hello');
    expect(markdown).toContain('World');
    expect(markdown).not.toContain('alert(');
    expect(markdown).not.toContain('<style>');
    expect(markdown).not.toContain('<meta');
  });
});