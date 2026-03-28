import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerConfigCommand(program: Command, engine: Engine) {
  program
    .command('config')
    .description('Show active configuration summary')
    .option('--json')
    .action(async options => {
      try {
        const config = engine.getConfig();
        if (options.json) {
          printJson({ success: true, data: config });
        } else {
          printJson(config);
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
