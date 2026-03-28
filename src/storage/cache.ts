export type CacheKeyInput = {
  url: string;
  format: string;
  mobile: boolean;
  fastPath: boolean;
  bpc: boolean;
  selector?: string | null;
  proxy?: string | null;
};

export function buildCacheKey(input: CacheKeyInput): string {
  return JSON.stringify({
    url: input.url,
    format: input.format,
    mobile: input.mobile,
    fastPath: input.fastPath,
    bpc: input.bpc,
    selector: input.selector ?? null,
    proxy: input.proxy ?? null,
  });
}
