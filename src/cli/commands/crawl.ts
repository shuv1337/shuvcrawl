import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerCrawlCommand(program: Command, engine: Engine) {
  program
    .command('crawl')
    .argument('<url>', 'URL to crawl from')
    .option('--depth <n>', 'Maximum crawl depth', value => Number(value))
    .option('--limit <n>', 'Maximum pages to crawl', value => Number(value))
    .option('--include <pattern...>', 'URL patterns to include')
    .option('--exclude <pattern...>', 'URL patterns to exclude')
    .option('--delay <ms>', 'Delay between pages in milliseconds', value => Number(value))
    .option('--source <source>', 'Discovery source: links|sitemap|both', 'links')
    .option('--resume', 'Resume from saved state', false)
    .option('--no-fast-path', 'Disable fast path fetching')
    .option('--no-bpc', 'Disable bypass paywall extension')
    .option('--no-cache', 'Bypass cache for this request')
    .option('--wait <strategy>', 'Wait strategy: load|networkidle|selector|sleep', 'load')
    .option('--wait-for <selector>', 'CSS selector to wait for')
    .option('--wait-timeout <ms>', 'Timeout for wait strategy in ms', value => Number(value))
    .option('--sleep <ms>', 'Sleep duration in ms', value => Number(value))
    .option('--debug-artifacts')
    .option('--json', 'Output as JSON')
    .action(async (url, options) => {
      try {
        const startTime = Date.now();

        // Progress callback for non-JSON mode
        const onProgress = options.json
          ? undefined
          : (page: { url: string; depth: number; status: string; elapsed?: number }) => {
              const elapsed = Date.now() - startTime;
              process.stderr.write(`[${page.depth}] ${page.status} ${page.url} +${elapsed}ms\n`);
            };

        const response = await engine.crawl(url, {
          depth: options.depth,
          limit: options.limit,
          include: options.include,
          exclude: options.exclude,
          delay: options.delay,
          source: options.source,
          resume: options.resume,
          noFastPath: options.fastPath === false,
          noBpc: options.bpc === false,
          noCache: options.cache === false,
          wait: options.wait,
          waitFor: options.waitFor,
          waitTimeout: options.waitTimeout,
          sleep: options.sleep,
          debugArtifacts: options.debugArtifacts,
        }, onProgress);

        if (options.json) {
          printJson({
            success: true,
            data: response.result,
            job: { jobId: response.result.jobId, status: response.result.status },
          });
        } else {
          // Final summary line
          const summary = response.result.summary;
          process.stdout.write(
            `completed: visited=${summary.visited} succeeded=${summary.succeeded} failed=${summary.failed} skipped=${summary.skipped} statePath=${response.result.statePath}\n`,
          );
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
