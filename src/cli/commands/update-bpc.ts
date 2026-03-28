import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import type { ShuvcrawlConfig } from '../../config/schema.ts';
import { readBpcManifest } from '../../core/capture.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerUpdateBpcCommand(program: Command, config: ShuvcrawlConfig) {
  program
    .command('update-bpc')
    .description('Check BPC (Bypass Paywall Clean) extension status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const manifest = await readBpcManifest(config);

        let status: string;
        let message: string;

        switch (config.bpc.sourceMode) {
          case 'bundled':
            status = 'bundled';
            message = `BPC extension version ${manifest.version ?? 'unknown'} (bundled with repository)`;
            break;
          case 'managed':
            status = 'managed';
            message = 'Managed mode not yet implemented';
            break;
          case 'custom':
            status = manifest.version ? 'custom-valid' : 'custom-invalid';
            message = manifest.version
              ? `BPC extension version ${manifest.version} (custom path: ${manifest.path})`
              : `No BPC extension found at custom path: ${manifest.path}`;
            break;
        }

        if (options.json) {
          printJson({
            success: true,
            bpc: {
              sourceMode: manifest.sourceMode,
              path: manifest.path,
              version: manifest.version,
              name: manifest.name,
              status,
              message,
            },
          });
        } else {
          process.stdout.write(`${message}\n`);
          if (config.bpc.sourceMode === 'custom' && !manifest.version) {
            process.stderr.write('Warning: BPC extension not found at the configured path\n');
          }
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
