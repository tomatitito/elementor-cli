import { z } from "zod";
import { DEFAULT_PAGES_DIR, DEFAULT_STAGING_DIR } from "../utils/constants.js";

function isCanonicalRemotePath(path: string): boolean {
  if (!path.startsWith("/") || path === "/" || /[\0\r\n]/.test(path))
    return false;
  const components = path.split("/");
  return (
    !path.endsWith("/") &&
    components.every((component, index) =>
      index === 0
        ? component === ""
        : component !== "" && component !== "." && component !== "..",
    )
  );
}

const identifier = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "must be a valid identifier");

const sshHost = z
  .string()
  .min(1)
  .regex(
    /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/,
    "must be a host or user@host without shell characters",
  );

const remoteWordPressPath = z
  .string()
  .min(1)
  .refine((path) => path.startsWith("/"), "must be an absolute path")
  .refine(
    (path) => !/[\0\r\n]/.test(path),
    "must not contain control characters",
  );

const canonicalRemoteDeployPath = z
  .string()
  .min(1)
  .refine(isCanonicalRemotePath, "must be a canonical absolute path");

const projectFile = z
  .string()
  .min(1)
  .refine(
    (path) => !/[\0\r\n]/.test(path),
    "must not contain control characters",
  );

export const SshWpCliConfigSchema = z.object({
  type: z.literal("ssh"),
  host: sshHost,
  path: remoteWordPressPath,
});

export const ComposeWpCliConfigSchema = z.object({
  type: z.literal("compose"),
  composeFile: projectFile,
  envFile: projectFile.optional(),
  projectName: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "must be a valid Compose project name")
    .optional(),
  service: identifier,
  mode: z.enum(["run", "exec"]),
  runtime: z.enum(["docker", "podman"]).default("docker"),
});

export const WpCliConfigSchema = z.discriminatedUnion("type", [
  SshWpCliConfigSchema,
  ComposeWpCliConfigSchema,
]);

export const DeployConfigSchema = z
  .object({
    wordpressPath: canonicalRemoteDeployPath,
    releasesPath: canonicalRemoteDeployPath,
    strategy: z.literal("directory-rename"),
  })
  .superRefine((deploy, context) => {
    const live = `${deploy.wordpressPath}/`;
    const releases = `${deploy.releasesPath}/`;
    if (live.startsWith(releases) || releases.startsWith(live)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "wordpressPath and releasesPath must be disjoint",
      });
    }
  });

export const ContainerConfigSchema = z.object({
  runtime: z.enum(["docker", "podman"]).default("docker"),
  name: z.string(),
});

export const SiteConfigSchema = z
  .object({
    url: z.string().url(),
    username: z.string().min(1).optional(),
    appPassword: z.string().min(1).optional(),
    container: ContainerConfigSchema.optional(),
    wpCli: WpCliConfigSchema.optional(),
    deploy: DeployConfigSchema.optional(),
  })
  .superRefine((site, context) => {
    if ((site.username === undefined) !== (site.appPassword === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "username and appPassword must be configured together",
      });
    }
    if (!site.wpCli && !site.username) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "site requires REST credentials or wpCli configuration",
      });
    }
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
export type SshWpCliConfig = z.infer<typeof SshWpCliConfigSchema>;
export type ComposeWpCliConfig = z.infer<typeof ComposeWpCliConfigSchema>;
export type WpCliConfig = z.infer<typeof WpCliConfigSchema>;
export type DeployConfig = z.infer<typeof DeployConfigSchema>;
export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type StagingConfig = z.infer<typeof StagingConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
