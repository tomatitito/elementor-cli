import { z } from "zod";
import { DEFAULT_STAGING_DIR, DEFAULT_PAGES_DIR } from "../utils/constants.js";

export const ContainerConfigSchema = z.object({
  runtime: z.enum(["docker", "podman"]).default("docker"),
  name: z.string(),
});

export const SiteConfigSchema = z.object({
  url: z.string().url(),
  username: z.string(),
  appPassword: z.string(),
  container: ContainerConfigSchema.optional(),
});

export const StagingConfigSchema = z.object({
  path: z.string().default(DEFAULT_STAGING_DIR),
  service: z.string().default("wordpress"),
  url: z.string().default("http://localhost:8080"),
  wpCommand: z.string().default("wp"),
  containerRuntime: z.enum(["docker", "podman"]).default("docker"),
});

export const ConfigSchema = z.object({
  defaultSite: z.string().optional(),
  sites: z.record(z.string(), SiteConfigSchema).default({}),
  staging: StagingConfigSchema.default({}),
  pagesDir: z.string().default(DEFAULT_PAGES_DIR),
});

export type ContainerConfig = z.infer<typeof ContainerConfigSchema>;
export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type StagingConfig = z.infer<typeof StagingConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
