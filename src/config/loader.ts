import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ShuvcrawlConfigSchema, type ShuvcrawlConfig } from './schema.ts';
import { defaultConfig } from './defaults.ts';
import { expandHome } from '../utils/paths.ts';

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (Array.isArray(base) || Array.isArray(override)) return (override ?? base) as T;
  if (typeof base !== 'object' || base === null || typeof override !== 'object' || override === null) {
    return (override ?? base) as T;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = key in result ? deepMerge(current as never, value as never) : value;
  }
  return result as T;
}

function parseEnvValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function applyEnvOverrides(config: ShuvcrawlConfig): ShuvcrawlConfig {
  const clone = structuredClone(config) as Record<string, any>;
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('SHUVCRAWL_') || value == null) continue;
    const pathParts = key.replace(/^SHUVCRAWL_/, '').toLowerCase().split('_');
    if (pathParts.length < 2) continue;
    let cursor: Record<string, any> = clone;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i]!;
      cursor[part] ??= {};
      cursor = cursor[part];
    }
    cursor[pathParts.at(-1)!] = parseEnvValue(value);
  }
  return ShuvcrawlConfigSchema.parse(clone);
}

export async function loadConfig(configPath?: string): Promise<ShuvcrawlConfig> {
  const resolvedConfigPath = expandHome(configPath ?? process.env.SHUVCRAWL_CONFIG ?? '~/.shuvcrawl/config.json');
  let merged = defaultConfig;

  if (existsSync(resolvedConfigPath)) {
    const raw = await readFile(resolvedConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    merged = deepMerge(defaultConfig, parsed);
  }

  return applyEnvOverrides(ShuvcrawlConfigSchema.parse(merged));
}
