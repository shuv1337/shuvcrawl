import { classifyError } from '../errors/classify.ts';
import { printJson } from './output.ts';

export function handleCliError(error: unknown, options: { json?: boolean }): never {
  const classified = classifyError(error);

  if (options.json) {
    printJson({
      success: false,
      error: {
        code: classified.code,
        message: classified.message,
        details: classified.details ?? {},
      },
    });
  } else {
    process.stderr.write(`[${classified.code}] ${classified.message}\n`);
  }

  process.exit(classified.exitCode);
}
