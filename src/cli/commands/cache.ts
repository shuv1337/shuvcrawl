import type { Command } from 'commander';
import type { ShuvcrawlConfig } from '../../config/schema.ts';
import { getCacheStats, listCache, clearCache } from '../../storage/cache.ts';
import { printJson } from '../output.ts';
import { handleCliError } from '../error-handler.ts';

export function registerCacheCommand(program: Command, config: ShuvcrawlConfig) {
  const cache = program
    .command('cache')
    .description('Cache management commands');

  cache
    .command('status')
    .description('Show cache status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const stats = await getCacheStats(config.cache.dir);

        if (options.json) {
          printJson({
            success: true,
            cache: {
              dir: config.cache.dir,
              enabled: config.cache.enabled,
              ttl: config.cache.ttl,
              ...stats,
            },
          });
        } else {
          process.stdout.write(`Cache directory: ${config.cache.dir}\n`);
          process.stdout.write(`Enabled: ${config.cache.enabled}\n`);
          process.stdout.write(`TTL: ${config.cache.ttl}s\n`);
          process.stdout.write(`Entries: ${stats.entries}\n`);
          process.stdout.write(`Total size: ${(stats.totalSize / 1024).toFixed(2)} KB\n`);
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });

  cache
    .command('list')
    .description('List cache entries')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const entries = await listCache(config.cache.dir);

        if (options.json) {
          printJson({
            success: true,
            entries: entries.map(e => ({
              ...e,
              cachedAt: new Date(e.cachedAt).toISOString(),
            })),
          });
        } else {
          process.stdout.write(`Found ${entries.length} cache entries:\n`);
          for (const entry of entries.slice(0, 20)) {
            const date = new Date(entry.cachedAt).toISOString();
            process.stdout.write(`  ${entry.hash} (${(entry.size / 1024).toFixed(1)} KB) - ${date}\n`);
          }
          if (entries.length > 20) {
            process.stdout.write(`  ... and ${entries.length - 20} more\n`);
          }
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });

  cache
    .command('clear')
    .description('Clear cache entries')
    .option('--older-than <seconds>', 'Only clear entries older than this many seconds', value => Number(value))
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const result = await clearCache(config.cache.dir, options.olderThan);

        if (options.json) {
          printJson({
            success: true,
            deleted: result.deleted,
            skipped: result.skipped,
          });
        } else {
          process.stdout.write(`Deleted: ${result.deleted} entries\n`);
          process.stdout.write(`Skipped: ${result.skipped} entries\n`);
        }
      } catch (error) {
        handleCliError(error, { json: options.json });
      }
    });
}
