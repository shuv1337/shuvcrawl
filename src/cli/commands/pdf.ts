import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerPdfCommand(program: Command, engine: Engine) {
  program
    .command('pdf')
    .argument('<url>', 'URL to render as PDF')
    .option('--format <format>', 'PDF format', 'A4')
    .option('--landscape', 'Landscape orientation')
    .option('--json')
    .action(async (url, options) => {
      try {
        const response = await engine.pdf(url, {
          format: options.format,
          landscape: Boolean(options.landscape),
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
