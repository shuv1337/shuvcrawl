import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerMapCommand(program: Command, engine: Engine) {
  program
    .command('map')
    .argument('<url>', 'URL to map from')
    .option('--include <pattern...>', 'URL patterns to include')
    .option('--exclude <pattern...>', 'URL patterns to exclude')
    .option('--source <source>', 'Discovery source: links|sitemap|both', 'links')
    .option('--no-fast-path', 'Disable fast path fetching')
    .option('--no-bpc', 'Disable bypass paywall extension')
    .option('--no-same-origin', 'Allow cross-origin links')
    .option('--wait <strategy>', 'Wait strategy: load|networkidle|selector|sleep', 'load')
    .option('--wait-for <selector>', 'CSS selector to wait for')
    .option('--wait-timeout <ms>', 'Timeout for wait strategy in ms', value => Number(value))
    .option('--sleep <ms>', 'Sleep duration in ms', value => Number(value))
    .option('--json', 'Output as JSON')
    .action(async (url, options) => {
      try {
        const response = await engine.map(url, {
          include: options.include,
          exclude: options.exclude,
          source: options.source,
          noFastPath: options.fastPath === false,
          noBpc: options.bpc === false,
          sameOriginOnly: options.sameOrigin !== false,
          wait: options.wait,
          waitFor: options.waitFor,
          waitTimeout: options.waitTimeout,
          sleep: options.sleep,
        });

        if (options.json) {
          printJson({ success: true, data: response.result });
        } else {
          for (const link of response.result.discovered) {
            process.stdout.write(`${link.url}\n`);
          }
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
