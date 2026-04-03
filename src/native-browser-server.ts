#!/usr/bin/env bun
/**
 * Native Browser Server — runs on the host machine (not in Docker).
 *
 * Launches Patchright's browser server with BPC extension loaded.
 * Exposes a Playwright-protocol WebSocket for the Docker container.
 *
 * Usage:
 *   bun run src/native-browser-server.ts [--port 9224] [--headless] [--no-bpc]
 */
import { chromium } from 'patchright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '9224' },
    headless: { type: 'boolean', default: false },
    'no-bpc': { type: 'boolean', default: false },
  },
});

const port = parseInt(args.port ?? '9224', 10);
const headless = args.headless ?? false;
const noBpc = args['no-bpc'] ?? false;

const bpcPath = path.resolve(import.meta.dir, '..', 'bpc-chrome');
const bpcExists = existsSync(bpcPath);

const launchArgs: string[] = [
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
];

if (!noBpc && bpcExists) {
  launchArgs.push(`--disable-extensions-except=${bpcPath}`);
  launchArgs.push(`--load-extension=${bpcPath}`);
  console.log(`[native-browser] BPC extension: ${bpcPath}`);
}

console.log(`[native-browser] Launching Patchright server (headless=${headless}, port=${port})...`);

const server = await chromium.launchServer({
  headless,
  args: launchArgs,
  port,
  host: '0.0.0.0',
});

const wsEndpoint = server.wsEndpoint();
console.log(`[native-browser] Server ready!`);
console.log(`[native-browser] WS endpoint: ${wsEndpoint}`);
console.log(`[native-browser] Docker connect: ws://host.docker.internal:${port}${new URL(wsEndpoint).pathname}`);
console.log(`[native-browser] Press Ctrl+C to stop`);

const shutdown = async () => {
  console.log(`\n[native-browser] Shutting down...`);
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await new Promise(() => {});
