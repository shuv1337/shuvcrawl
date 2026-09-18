import { loadConfig } from './config/loader.ts';
import { createLogger } from './utils/logger.ts';
import { Engine } from './core/engine.ts';
import { buildApi } from './api/routes.ts';

function parseServeArgs(argv: string[]): { port?: number; host?: string } {
  const result: { port?: number; host?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      const port = Number(argv[++i]);
      if (Number.isInteger(port) && port > 0) result.port = port;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      result.host = argv[++i];
    }
  }
  return result;
}

const config = await loadConfig();
const args = parseServeArgs(process.argv.slice(2));
const port = args.port ?? config.api.port;
const host = args.host ?? config.api.host;
const logger = createLogger(config.telemetry.logLevel, { service: 'shuvcrawl' });
const engine = new Engine(config, logger);
const app = buildApi(engine, config);

logger.info('server.start', { host, port });
const server = Bun.serve({ hostname: host, port, fetch: app.fetch });

logger.info('server.ready', { hostname: server.hostname, port: server.port });
