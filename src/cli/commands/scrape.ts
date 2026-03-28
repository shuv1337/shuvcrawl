import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerScrapeCommand(program: Command, engine: Engine) {
  program
    .command('scrape')
    .argument('<url>', 'URL to scrape')
    .option('--selector <selector>')
    .option('--no-fast-path')
    .option('--no-bpc')
    .option('--debug-artifacts')
    .option('--json')
    .action(async (url, options) => {
      try {
        const response = await engine.scrape(url, {
          selector: options.selector,
          noFastPath: options.fastPath === false,
          noBpc: options.bpc === false,
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
