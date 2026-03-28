import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

type LogContext = {
  runId: string;
  profileId: string;
  scenarioId: string;
};

export type SpikeLogger = {
  log: (event: string, fields?: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
  filePath: string;
  context: LogContext;
};

export async function createLogger(logsDir: string, context: LogContext): Promise<SpikeLogger> {
  await mkdir(logsDir, { recursive: true });
  const filePath = path.join(logsDir, `${new Date().toISOString().replace(/[.:]/g, '-')}-${context.runId}.jsonl`);

  return {
    filePath,
    context,
    async log(event, fields = {}) {
      const entry = {
        ts: new Date().toISOString(),
        event,
        ...context,
        ...fields,
      };
      const line = JSON.stringify(entry);
      await appendFile(filePath, `${line}\n`, 'utf8');
      process.stdout.write(`${line}\n`);
    },
    async close() {
      return;
    },
  };
}
