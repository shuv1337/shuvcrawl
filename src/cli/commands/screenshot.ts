import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerScreenshotCommand(program: Command, engine: Engine) {
  program
    .command('screenshot')
    .argument('<url>', 'URL to capture')
    .option('--full-page', 'Capture full page', true)
    .option('--no-full-page', 'Capture viewport only')
    .option('--json')
    .action(async (url, options) => {
      try {
        const response = await engine.screenshot(url, {
          fullPage: options.fullPage,
        });

        if (options.json) {
          printJson({ success: true, data: response.result, meta: { requestId: response.result.requestId, elapsed: response.result.elapsed, bypassMethod: response.result.bypassMethod } });
        } else {
          process.stdout.write(`${response.result.path}\n`);
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
