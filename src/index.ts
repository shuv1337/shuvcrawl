import { Command } from 'commander';
import { loadConfig } from './config/loader.ts';
import type { ShuvcrawlConfig } from './config/schema.ts';
import { createLogger } from './utils/logger.ts';
import { Engine } from './core/engine.ts';
import { registerScrapeCommand } from './cli/commands/scrape.ts';
import { registerScreenshotCommand } from './cli/commands/screenshot.ts';
import { registerPdfCommand } from './cli/commands/pdf.ts';
import { registerConfigCommand } from './cli/commands/config.ts';
import { registerVersionCommand } from './cli/commands/version.ts';
import { registerMapCommand } from './cli/commands/map.ts';
import { registerCrawlCommand } from './cli/commands/crawl.ts';
import { handleCliError } from './cli/error-handler.ts';
import { ConfigError } from './errors/classify.ts';

let config: ShuvcrawlConfig;
try {
  config = await loadConfig();
} catch (error) {
  handleCliError(new ConfigError('Failed to load configuration', { cause: error }), { json: process.argv.includes('--json') });
}

const logger = createLogger(config.telemetry.logLevel, { service: 'shuvcrawl' });
const engine = new Engine(config, logger);

const program = new Command();
program
  .name('shuvcrawl')
  .description('Bypass-aware scraping toolkit')
  .showHelpAfterError();
registerScrapeCommand(program, engine);
registerMapCommand(program, engine);
registerCrawlCommand(program, engine);
registerScreenshotCommand(program, engine);
registerPdfCommand(program, engine);
registerConfigCommand(program, engine);
registerVersionCommand(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  handleCliError(error, { json: process.argv.includes('--json') });
}
