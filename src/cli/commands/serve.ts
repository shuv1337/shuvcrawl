import type { Command } from 'commander';
import type { Engine } from '../../core/engine.ts';
import type { ShuvcrawlConfig } from '../../config/schema.ts';
import { buildApi } from '../../api/routes.ts';
import { handleCliError } from '../error-handler.ts';

export function registerServeCommand(program: Command, engine: Engine, config: ShuvcrawlConfig) {
  program
    .command('serve')
    .description('Start the REST API server')
    .option('--port <port>', 'Port to listen on', value => Number(value))
    .option('--host <host>', 'Host to bind to')
    .option('--json', 'Output as JSON on startup')
    .action(async (options) => {
      try {
        const port = options.port ?? config.api.port;
        const host = options.host ?? config.api.host;

        const api = buildApi(engine, config);

        const server = Bun.serve({
          port,
          hostname: host,
          fetch: api.fetch,
        });

        if (options.json) {
          process.stdout.write(JSON.stringify({ success: true, port, host, url: `http://${host}:${port}` }) + '\n');
        } else {
          process.stderr.write(`Server running at http://${host}:${port}\n`);
        }

        // Keep the process alive
        await new Promise(() => {});
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
