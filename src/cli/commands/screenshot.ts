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
    .option('--wait <strategy>', 'Wait strategy: load|networkidle|selector|sleep', 'load')
    .option('--wait-for <selector>', 'CSS selector to wait for')
    .option('--wait-timeout <ms>', 'Timeout for wait strategy in ms', value => Number(value))
    .option('--sleep <ms>', 'Sleep duration in ms', value => Number(value))
    .option('--json', 'Output as JSON')
    .action(async (url, options) => {
      try {
        const response = await engine.screenshot(url, {
          fullPage: options.fullPage !== false,
          wait: options.wait,
          waitFor: options.waitFor,
          waitTimeout: options.waitTimeout,
          sleep: options.sleep,
        });

        if (options.json) {
          printJson({ success: true, data: response.result });
        } else {
          process.stdout.write(`Screenshot saved: ${response.result.path}\n`);
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
