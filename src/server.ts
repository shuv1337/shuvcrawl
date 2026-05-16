import { loadConfig } from './config/loader.ts';
import { createLogger } from './utils/logger.ts';
import { Engine } from './core/engine.ts';
import { buildApi } from './api/routes.ts';

const config = await loadConfig();
const logger = createLogger(config.telemetry.logLevel, { service: 'shuvcrawl' });
const engine = new Engine(config, logger);
const app = buildApi(engine, config);

logger.info('server.start', { host: config.api.host, port: config.api.port });
const server = Bun.serve({ hostname: config.api.host, port: config.api.port, fetch: app.fetch });

logger.info('server.ready', { hostname: server.hostname, port: server.port });
