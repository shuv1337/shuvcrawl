import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { resolveProjectRoots, type SpikePaths } from './paths.ts';

export type ScenarioName = 'default' | 'launch' | 'storage' | 'docker-headless' | 'docker-headed';

export type SpikeConfig = {
  runId: string;
  profileId: string;
  scenarioId: string;
  scenario: ScenarioName;
  initTemplate: boolean;
  resetRuntime: boolean;
  keepRuntime: boolean;
  forceTemplateInit: boolean;
  headless: boolean;
  targetUrl: string;
  browserExecutablePath?: string;
  browserChannel?: string;
  timeoutBrowserMs: number;
  timeoutWorkerMs: number;
  timeoutHealthMs: number;
  timeoutNavigationMs: number;
  outputRootOverride?: string;
  paths: SpikePaths;
};

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function getFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function getEnvBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function getEnvNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function detectBrowserExecutable(): string | undefined {
  const envPath = process.env.SPIKE_BROWSER_EXECUTABLE;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium',
  ];

  return candidates.find(candidate => existsSync(candidate));
}

function resolveScenario(argv: string[]): ScenarioName {
  const raw = getFlagValue(argv, '--scenario') ?? process.env.SPIKE_SCENARIO ?? 'default';
  switch (raw) {
    case 'launch':
    case 'storage':
    case 'docker-headless':
    case 'docker-headed':
      return raw;
    default:
      return 'default';
  }
}

export function loadConfig(argv = process.argv.slice(2)): SpikeConfig {
  const outputRootOverride = process.env.SPIKE_OUTPUT_DIR || getFlagValue(argv, '--output-dir');
  const paths = resolveProjectRoots(outputRootOverride, process.env.BPC_PATH || getFlagValue(argv, '--bpc-path'));
  const scenario = resolveScenario(argv);
  const explicitHeaded = hasFlag(argv, '--headed');
  const explicitHeadless = hasFlag(argv, '--headless');

  let headless = getEnvBoolean('SPIKE_HEADLESS', true);
  if (scenario === 'docker-headed') headless = false;
  if (scenario === 'docker-headless') headless = true;
  if (explicitHeaded) headless = false;
  if (explicitHeadless) headless = true;

  const browserExecutablePath = detectBrowserExecutable();
  const browserChannel = browserExecutablePath ? undefined : 'chromium';
  const runId = process.env.SPIKE_RUN_ID || randomUUID();
  const profileId = headless ? 'runtime-headless' : 'runtime-headed';

  return {
    runId,
    profileId,
    scenarioId: scenario,
    scenario,
    initTemplate: hasFlag(argv, '--init-template'),
    resetRuntime: hasFlag(argv, '--reset-runtime'),
    keepRuntime: getEnvBoolean('SPIKE_KEEP_RUNTIME', false),
    forceTemplateInit: getEnvBoolean('SPIKE_FORCE_TEMPLATE_INIT', false),
    headless,
    targetUrl: process.env.SPIKE_TARGET_URL || getFlagValue(argv, '--target-url') || 'https://example.com/',
    browserExecutablePath,
    browserChannel,
    timeoutBrowserMs: getEnvNumber('SPIKE_TIMEOUT_BROWSER_MS', 45_000),
    timeoutWorkerMs: getEnvNumber('SPIKE_TIMEOUT_WORKER_MS', 25_000),
    timeoutHealthMs: getEnvNumber('SPIKE_TIMEOUT_HEALTH_MS', 15_000),
    timeoutNavigationMs: getEnvNumber('SPIKE_TIMEOUT_NAVIGATION_MS', 30_000),
    outputRootOverride,
    paths,
  };
}

export function summarizeConfig(config: SpikeConfig): Record<string, unknown> {
  return {
    runId: config.runId,
    profileId: config.profileId,
    scenarioId: config.scenarioId,
    scenario: config.scenario,
    headless: config.headless,
    targetUrl: config.targetUrl,
    browserExecutablePath: config.browserExecutablePath,
    browserChannel: config.browserChannel,
    timeoutBrowserMs: config.timeoutBrowserMs,
    timeoutWorkerMs: config.timeoutWorkerMs,
    timeoutHealthMs: config.timeoutHealthMs,
    timeoutNavigationMs: config.timeoutNavigationMs,
    paths: {
      spikeRoot: config.paths.spikeRoot,
      bpcPath: config.paths.bpcPath,
      templateProfileDir: path.relative(config.paths.repoRoot, config.paths.templateProfileDir),
      runtimeProfileDir: path.relative(config.paths.repoRoot, config.paths.runtimeProfileDir),
      outputRoot: path.relative(config.paths.repoRoot, config.paths.outputRoot),
    },
  };
}
