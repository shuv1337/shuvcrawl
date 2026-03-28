import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerPdfCommand(program: Command, engine: Engine) {
  program
    .command('pdf')
    .argument('<url>', 'URL to render as PDF')
    .option('--format <format>', 'Paper format: A4, Letter, etc.', 'A4')
    .option('--landscape', 'Landscape orientation', false)
    .option('--wait <strategy>', 'Wait strategy: load|networkidle|selector|sleep', 'load')
    .option('--wait-for <selector>', 'CSS selector to wait for')
    .option('--wait-timeout <ms>', 'Timeout for wait strategy in ms', value => Number(value))
    .option('--sleep <ms>', 'Sleep duration in ms', value => Number(value))
    .option('--json', 'Output as JSON')
    .action(async (url, options) => {
      try {
        const response = await engine.pdf(url, {
          format: options.format,
          landscape: options.landscape,
          wait: options.wait,
          waitFor: options.waitFor,
          waitTimeout: options.waitTimeout,
          sleep: options.sleep,
        });

        if (options.json) {
          printJson({ success: true, data: response.result });
        } else {
          process.stdout.write(`PDF saved: ${response.result.path}\n`);
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
