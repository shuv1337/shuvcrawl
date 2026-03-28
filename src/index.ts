import { Command } from 'commander';
import { loadConfig } from './config/loader.ts';
import type { ShuvcrawlConfig } from './config/schema.ts';
import { createLogger, type LogLevel } from './utils/logger.ts';
import { Engine } from './core/engine.ts';
import { registerScrapeCommand } from './cli/commands/scrape.ts';
import { registerScreenshotCommand } from './cli/commands/screenshot.ts';
import { registerPdfCommand } from './cli/commands/pdf.ts';
import { registerConfigCommand } from './cli/commands/config.ts';
import { registerVersionCommand } from './cli/commands/version.ts';
import { registerMapCommand } from './cli/commands/map.ts';
import { registerCrawlCommand } from './cli/commands/crawl.ts';
import { registerServeCommand } from './cli/commands/serve.ts';
import { registerCacheCommand } from './cli/commands/cache.ts';
import { registerUpdateBpcCommand } from './cli/commands/update-bpc.ts';
import { handleCliError } from './cli/error-handler.ts';
import { ConfigError } from './errors/classify.ts';
import { resolveProxy } from './utils/proxy.ts';

// Parse global options early to handle --config
function parseGlobalOptions(): { configPath?: string; logLevel?: string; json?: boolean } {
  const args = process.argv.slice(2);
  const result: { configPath?: string; logLevel?: string; json?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      result.configPath = args[i + 1];
    }
    if (args[i] === '--verbose') {
      result.logLevel = 'debug';
    }
    if (args[i] === '--quiet') {
      result.logLevel = 'error';
    }
    if (args[i] === '--json') {
      result.json = true;
    }
  }

  return result;
}

const globalOpts = parseGlobalOptions();

let config: ShuvcrawlConfig;
try {
  config = await loadConfig(globalOpts.configPath);
} catch (error) {
  handleCliError(new ConfigError('Failed to load configuration', { cause: error }), { json: globalOpts.json });
}

// Override log level if specified
const logLevel: LogLevel = (globalOpts.logLevel as LogLevel) ?? config.telemetry.logLevel;
const logger = createLogger(logLevel, { service: 'shuvcrawl' });
const engine = new Engine(config, logger);

const program = new Command();
program
  .name('shuvcrawl')
  .description('Bypass-aware scraping toolkit')
  .showHelpAfterError()
  .option('--config <path>', 'Path to config file')
  .option('--output <dir>', 'Output directory', config.output.dir)
  .option('--format <format>', 'Output format: markdown|json', config.output.format)
  .option('--no-cache', 'Disable cache for this session')
  .option('--no-robots', 'Disable robots.txt checking')
  .option('--proxy <url>', 'Proxy URL')
  .option('--user-agent <ua>', 'User agent for fast path', config.fastPath.userAgent)
  .option('--verbose', 'Verbose logging (debug level)')
  .option('--quiet', 'Quiet logging (error level only)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    // Apply global option overrides to config
    if (opts.output) {
      config.output.dir = opts.output;
    }
    if (opts.format) {
      config.output.format = opts.format;
    }
    if (opts.cache === false) {
      config.cache.enabled = false;
    }
    if (opts.robots === false) {
      config.crawl.respectRobots = false;
    }
    if (opts.proxy) {
      config.proxy.url = opts.proxy;
    }
    if (opts.userAgent) {
      config.fastPath.userAgent = opts.userAgent;
    }

    // Resolve proxy if set
    if (config.proxy.url) {
      const proxyConfig = resolveProxy(config);
      if (proxyConfig) {
        logger.debug('proxy.configured', { server: proxyConfig.server });
      }
    }
  });

// Register all commands
registerScrapeCommand(program, engine);
registerMapCommand(program, engine);
registerCrawlCommand(program, engine);
registerScreenshotCommand(program, engine);
registerPdfCommand(program, engine);
registerConfigCommand(program, engine);
registerVersionCommand(program);
registerServeCommand(program, engine, config);
registerCacheCommand(program, config);
registerUpdateBpcCommand(program, config);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  handleCliError(error, { json: globalOpts.json });
}
