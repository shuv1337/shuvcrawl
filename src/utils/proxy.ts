import type { ShuvcrawlConfig } from '../config/schema.ts';

export function resolveProxy(config: ShuvcrawlConfig, override?: string | null): { server: string } | undefined {
  const server = override ?? config.proxy.url;
  return server ? { server } : undefined;
}
