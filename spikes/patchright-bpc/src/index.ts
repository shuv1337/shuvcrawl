import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, summarizeConfig } from './config.ts';
import { createLogger } from './logger.ts';
import { ensureBaseDirectories, assertPathExists } from './paths.ts';
import { ensureRunArtifactDir, writeJsonArtifact, writeTextArtifact } from './artifacts.ts';
import { ensureProfileRoot, initializeEmptyProfile, resetRuntimeProfile, directorySize } from './profile.ts';
import { launchPersistentContext } from './launch.ts';
import { waitForExtensionWorker } from './extension.ts';
import { readStorageSnapshot, runControlledMutation } from './storage.ts';
import { runHealthCheck } from './health.ts';
import { navigateAfterReadiness } from './scenario.ts';
import { serializeError } from './telemetry.ts';

async function createTemplateProfile(config: ReturnType<typeof loadConfig>, logger: Awaited<ReturnType<typeof createLogger>>, artifactDir: string) {
  if (config.forceTemplateInit && existsSync(config.paths.templateProfileDir)) {
    await rm(config.paths.templateProfileDir, { recursive: true, force: true });
  }

  const templateMissing = !existsSync(config.paths.templateProfileDir);
  if (!config.initTemplate && !templateMissing && !config.forceTemplateInit) {
    return { created: false, bytes: await directorySize(config.paths.templateProfileDir) };
  }

  await initializeEmptyProfile(config.paths.templateProfileDir);
  const launch = await launchPersistentContext(config, logger, config.paths.templateProfileDir);
  try {
    const workerInfo = await waitForExtensionWorker(launch.context, config.timeoutWorkerMs, logger, artifactDir);
    const snapshot = await readStorageSnapshot(workerInfo.worker, logger, artifactDir, 'template-storage');
    const bytes = await directorySize(config.paths.templateProfileDir);
    await logger.log('profile.template.created', {
      templateProfileDir: config.paths.templateProfileDir,
      bytes,
      extensionId: workerInfo.extensionId,
      workerUrl: workerInfo.workerUrl,
      snapshotKeys: Object.keys(snapshot),
    });
    return { created: true, bytes };
  } finally {
    await launch.context.close();
  }
}

function buildReport(params: {
  config: ReturnType<typeof loadConfig>;
  logFilePath: string;
  artifactDir: string;
  environment: Record<string, unknown>;
  templateResult?: Record<string, unknown>;
  runtimeResult?: Record<string, unknown>;
  recommendation: string;
  blockers: string[];
  dockerSummary?: string;
}): string {
  const { config, logFilePath, artifactDir, environment, templateResult, runtimeResult, recommendation, blockers, dockerSummary } = params;
  return `# Patchright + BPC spike report\n\n## Environment\n\n- Run ID: \`${config.runId}\`\n- Scenario: \`${config.scenario}\`\n- Headless: \`${config.headless}\`\n- Target URL: ${config.targetUrl}\n- Host OS: ${environment.platform} ${environment.release}\n- Hostname: ${environment.hostname}\n- Browser executable: ${String(environment.browserExecutablePath ?? 'auto')}\n- Log file: \`${logFilePath}\`\n- Artifact dir: \`${artifactDir}\`\n\n## Local/template results\n\n\`\`\`json\n${JSON.stringify(templateResult ?? {}, null, 2)}\n\`\`\`\n\n## Runtime results\n\n\`\`\`json\n${JSON.stringify(runtimeResult ?? {}, null, 2)}\n\`\`\`\n\n## Docker results\n\n${dockerSummary ?? 'Not captured in this specific run. Execute both docker scenarios to populate container evidence.'}\n\n## Recommendation\n\n${recommendation}\n\n## Unresolved blockers\n\n${blockers.length ? blockers.map(blocker => `- ${blocker}`).join('\n') : '- None recorded during this run'}\n\n## Notes\n\n- This report is generated from saved artifacts and JSONL logs.
- Readiness timing and storage behavior are embedded in the runtime JSON block above.\n`;
}

async function main() {
  const config = loadConfig();
  await ensureBaseDirectories(config.paths);
  assertPathExists(config.paths.bpcPath, 'BPC extension path');
  await ensureProfileRoot(config.paths.profilesRoot);

  const logger = await createLogger(config.paths.logsDir, {
    runId: config.runId,
    profileId: config.profileId,
    scenarioId: config.scenarioId,
  });
  const artifactDir = await ensureRunArtifactDir(config.paths.artifactsDir, config.runId);

  await logger.log('spike.start', summarizeConfig(config));
  await logger.log('bpc.path.resolved', { bpcPath: config.paths.bpcPath });

  const environment = {
    platform: os.platform(),
    release: os.release(),
    hostname: os.hostname(),
    arch: os.arch(),
    browserExecutablePath: config.browserExecutablePath,
    cwd: process.cwd(),
  };
  await writeJsonArtifact(artifactDir, 'environment.json', environment);

  let templateResult: Record<string, unknown> | undefined;
  let runtimeResult: Record<string, unknown> | undefined;
  const blockers: string[] = [];

  try {
    templateResult = await createTemplateProfile(config, logger, artifactDir);

    if (!existsSync(config.paths.templateProfileDir)) {
      throw new Error(`Template profile missing at ${config.paths.templateProfileDir}`);
    }

    if (!config.keepRuntime || config.resetRuntime || !existsSync(config.paths.runtimeProfileDir)) {
      const runtimeCopy = await resetRuntimeProfile(config.paths.templateProfileDir, config.paths.runtimeProfileDir, logger);
      await logger.log('profile.runtime.copied', {
        templateProfileDir: config.paths.templateProfileDir,
        runtimeProfileDir: config.paths.runtimeProfileDir,
        bytes: runtimeCopy.bytes,
      });
    }

    const launch = await launchPersistentContext(config, logger, config.paths.runtimeProfileDir);
    try {
      const workerInfo = await waitForExtensionWorker(launch.context, config.timeoutWorkerMs, logger, artifactDir);
      const initialSnapshot = await readStorageSnapshot(workerInfo.worker, logger, artifactDir, 'runtime-storage-initial');

      let mutationResult: Record<string, unknown> | undefined;
      if (config.scenario === 'default' || config.scenario === 'storage' || config.scenario === 'docker-headless' || config.scenario === 'docker-headed') {
        mutationResult = await runControlledMutation(workerInfo.worker, logger, artifactDir);
      }

      const healthSnapshot = await readStorageSnapshot(workerInfo.worker, logger, artifactDir, 'runtime-storage-health');
      const health = await runHealthCheck(workerInfo, healthSnapshot, logger);
      if (!health.ok) {
        throw new Error('Health check failed; navigation blocked');
      }

      let navigation: Record<string, unknown> | undefined;
      if (config.scenario !== 'storage') {
        navigation = await navigateAfterReadiness(launch.page, config, logger, artifactDir);
      }

      runtimeResult = {
        extensionId: workerInfo.extensionId,
        workerUrl: workerInfo.workerUrl,
        readyDurationMs: workerInfo.readyDurationMs,
        browserVersion: launch.browserVersion,
        initialSnapshotKeys: Object.keys(initialSnapshot),
        storageBehaviorSummary: {
          readableKeys: Object.keys(initialSnapshot),
          controlledMutationVerified: Boolean(mutationResult),
        },
        profileWorkflowSummary: {
          templateProfileDir: config.paths.templateProfileDir,
          runtimeProfileDir: config.paths.runtimeProfileDir,
          runtimeProfileBytes: await directorySize(config.paths.runtimeProfileDir),
        },
        mutationResult,
        health,
        navigation,
      };
    } finally {
      await launch.context.close();
    }

    const recommendation = config.scenario === 'docker-headless'
      ? 'Proceed with Patchright as spec’d. Headless Chromium with the unpacked BPC extension was viable in Docker for this run.'
      : config.scenario === 'docker-headed'
        ? 'Proceed with Patchright as spec’d. Headed Chromium under Xvfb was also viable in Docker for this run, so both Docker modes currently look workable.'
        : config.headless
          ? 'Proceed with Patchright as spec’d locally; headless runtime succeeded in this run. Docker mode still needs explicit execution to confirm whether headless-new remains viable there.'
          : 'Proceed locally with headed Patchright. Docker baseline should be validated against Xvfb before locking the V1 runtime mode.';

    const report = buildReport({
      config,
      logFilePath: logger.filePath,
      artifactDir,
      environment,
      templateResult,
      runtimeResult,
      recommendation,
      blockers,
      dockerSummary: config.scenario.startsWith('docker-')
        ? (config.scenario === 'docker-headless'
            ? 'This run exercised Docker headless mode successfully.'
            : 'This run exercised Docker headed+Xvfb mode successfully.')
        : undefined,
    });
    const reportPath = await writeTextArtifact(config.paths.reportsDir, 'patchright-bpc-spike-report.md', report);
    await logger.log('spike.complete', { reportPath, artifactDir, runtimeResult });
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
    await logger.log('spike.failed', { error: serializeError(error), artifactDir });

    const report = buildReport({
      config,
      logFilePath: logger.filePath,
      artifactDir,
      environment,
      templateResult,
      runtimeResult,
      recommendation: 'No-go for this specific run until the recorded failure is resolved and the spike is rerun.',
      blockers,
      dockerSummary: config.scenario.startsWith('docker-') ? 'Docker scenario failed in this run; inspect saved artifacts and logs.' : undefined,
    });
    await writeTextArtifact(config.paths.reportsDir, 'patchright-bpc-spike-report.md', report);
    process.exitCode = 1;
  } finally {
    await logger.close();
  }
}

await main();
