import type { Command } from 'commander';
import pkg from '../../../package.json';
import { printJson } from '../output.ts';

export function registerVersionCommand(program: Command) {
  program
    .command('version')
    .description('Show version info')
    .option('--json')
    .action(options => {
      const data = {
        name: pkg.name,
        version: pkg.version ?? '0.0.0-dev',
        runtime: {
          bun: Bun.version,
          platform: process.platform,
          arch: process.arch,
        },
      };

      if (options.json) {
        printJson({ success: true, data });
      } else {
        process.stdout.write(`${data.name} ${data.version}\n`);
      }
    });
}
