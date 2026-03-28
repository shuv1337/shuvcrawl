import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerMapCommand(program: Command, engine: Engine) {
  program
    .command('map')
    .argument('<url>', 'URL to discover links from')
    .option('--include <pattern...>')
    .option('--exclude <pattern...>')
    .option('--no-fast-path')
    .option('--no-bpc')
    .option('--no-same-origin-only', 'Allow cross-origin discovery results')
    .option('--json')
    .action(async (url, options) => {
      try {
        const response = await engine.map(url, {
          include: options.include,
          exclude: options.exclude,
          noFastPath: options.fastPath === false,
          noBpc: options.bpc === false,
          sameOriginOnly: options.sameOriginOnly,
        });

        if (options.json) {
          printJson({ success: true, data: response.result, meta: { requestId: response.result.requestId, elapsed: response.result.summary.elapsed, bypassMethod: response.result.summary.bypassMethod } });
        } else {
          for (const item of response.result.discovered) {
            process.stdout.write(`${item.url}\n`);
          }
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
