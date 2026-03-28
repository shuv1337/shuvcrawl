import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerScrapeCommand(program: Command, engine: Engine) {
  program
    .command('scrape')
    .argument('<url>', 'URL to scrape')
    .option('--selector <selector>', 'CSS selector to extract')
    .option('--no-fast-path', 'Disable fast path fetching')
    .option('--no-bpc', 'Disable bypass paywall extension')
    .option('--no-cache', 'Bypass cache for this request')
    .option('--mobile', 'Use mobile viewport')
    .option('--headers <json>', 'Custom headers as JSON string')
    .option('--raw-html', 'Include raw HTML in output')
    .option('--only-main-content', 'Extract only main content (default)', true)
    .option('--no-only-main-content', 'Use full body instead of main content extraction')
    .option('--wait <strategy>', 'Wait strategy: load|networkidle|selector|sleep', 'load')
    .option('--wait-for <selector>', 'CSS selector to wait for (with --wait selector)')
    .option('--wait-timeout <ms>', 'Timeout for wait strategy in ms', value => Number(value))
    .option('--sleep <ms>', 'Sleep duration in ms (with --wait sleep)', value => Number(value))
    .option('--debug-artifacts')
    .option('--json', 'Output as JSON')
    .action(async (url, options) => {
      try {
        // Parse headers if provided
        let headers: Record<string, string> | undefined;
        if (options.headers) {
          try {
            const parsed = JSON.parse(options.headers);
            headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
          } catch {
            throw new Error('Invalid JSON in --headers');
          }
        }

        const response = await engine.scrape(url, {
          selector: options.selector,
          noFastPath: options.fastPath === false,
          noBpc: options.bpc === false,
          noCache: options.cache === false,
          mobile: options.mobile,
          headers,
          rawHtml: options.rawHtml,
          onlyMainContent: options.onlyMainContent,
          wait: options.wait,
          waitFor: options.waitFor,
          waitTimeout: options.waitTimeout,
          sleep: options.sleep,
          debugArtifacts: options.debugArtifacts,
        });

        if (options.json) {
          printJson({ success: true, data: response.result, output: response.output });
        } else {
          process.stdout.write(`${response.result.content}\n`);
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
