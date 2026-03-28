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
    .option('--include <pattern...>')
    .option('--exclude <pattern...>')
    .option('--delay <ms>', 'Delay between pages in milliseconds', value => Number(value))
    .option('--source <source>', 'Discovery source: links|sitemap|both', 'links')
    .option('--resume', 'Resume from saved state', false)
    .option('--no-fast-path')
    .option('--no-bpc')
    .option('--debug-artifacts')
    .option('--json')
    .action(async (url, options) => {
      try {
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
          debugArtifacts: options.debugArtifacts,
        });

        if (options.json) {
          printJson({ success: true, data: response.result, job: { jobId: response.result.jobId, status: response.result.status } });
        } else {
          process.stdout.write(`jobId=${response.result.jobId} status=${response.result.status} visited=${response.result.summary.visited} state=${response.result.statePath}\n`);
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
