import { z } from 'zod';

export const ScrapeRequestSchema = z.object({
  url: z.string().url(),
  options: z.object({
    selector: z.string().optional(),
    noFastPath: z.boolean().optional(),
    noBpc: z.boolean().optional(),
    mobile: z.boolean().optional(),
    proxy: z.string().nullable().optional(),
    debugArtifacts: z.boolean().optional(),
  }).optional().default({}),
});

export const MapRequestSchema = z.object({
  url: z.string().url(),
  options: z.object({
    noFastPath: z.boolean().optional(),
    noBpc: z.boolean().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    sameOriginOnly: z.boolean().optional(),
  }).optional().default({}),
});

export const CrawlRequestSchema = z.object({
  url: z.string().url(),
  options: z.object({
    depth: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    delay: z.number().int().nonnegative().optional(),
    source: z.enum(['links', 'sitemap', 'both']).optional(),
    resume: z.boolean().optional(),
    noFastPath: z.boolean().optional(),
    noBpc: z.boolean().optional(),
    debugArtifacts: z.boolean().optional(),
  }).optional().default({}),
});

export const ScreenshotRequestSchema = z.object({
  url: z.string().url(),
  options: z.object({
    fullPage: z.boolean().optional(),
  }).optional().default({}),
});

export const PdfRequestSchema = z.object({
  url: z.string().url(),
  options: z.object({
    format: z.string().optional(),
    landscape: z.boolean().optional(),
  }).optional().default({}),
});

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;
export type MapRequest = z.infer<typeof MapRequestSchema>;
export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;
export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;
export type PdfRequest = z.infer<typeof PdfRequestSchema>;
