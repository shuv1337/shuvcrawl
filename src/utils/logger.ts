export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(level: LogLevel, baseFields: Record<string, unknown> = {}): Logger {
  function emit(logLevel: LogLevel, event: string, fields: Record<string, unknown> = {}) {
    if (levelOrder[logLevel] < levelOrder[level]) return;
    const payload = {
      ts: new Date().toISOString(),
      level: logLevel,
      event,
      ...baseFields,
      ...fields,
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
