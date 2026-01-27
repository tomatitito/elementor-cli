import { z } from "zod";

export const SiteConfigSchema = z.object({
  url: z.string().url(),
  username: z.string(),
  appPassword: z.string(),
});

export const StagingConfigSchema = z.object({
  path: z.string().default(".elementor-cli/staging"),
  service: z.string().default("wordpress"),
  url: z.string().default("http://localhost:8080"),
});

export const ConfigSchema = z.object({
  defaultSite: z.string().optional(),
  sites: z.record(z.string(), SiteConfigSchema).default({}),
  staging: StagingConfigSchema.default({}),
  pagesDir: z.string().default(".elementor-cli/pages"),
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type StagingConfig = z.infer<typeof StagingConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
