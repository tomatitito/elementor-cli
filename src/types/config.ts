import { z } from "zod";
import { DEFAULT_PAGES_DIR, DEFAULT_STAGING_DIR } from "../utils/constants.js";

function isCanonicalRemotePath(path: string): boolean {
  if (!path.startsWith("/") || path === "/" || hasUnsafeConfigText(path))
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

function hasUnsafeConfigText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    )
      return true;
  }
  return false;
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
    (path) => !hasUnsafeConfigText(path),
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
    backupsPath: canonicalRemoteDeployPath.optional(),
    configSourcePath: canonicalRemoteDeployPath.optional(),
    maintenancePath: canonicalRemoteDeployPath.optional(),
    wpCliPath: canonicalRemoteDeployPath.optional(),
    smokeUrls: z
      .array(
        z
          .string()
          .url()
          .refine((url) => url.startsWith("https://"), "must use HTTPS")
          .refine((url) => {
            const parsed = new URL(url);
            return (
              !parsed.username &&
              !parsed.password &&
              !parsed.search &&
              !parsed.hash
            );
          }, "must not contain credentials, query parameters, or fragments"),
      )
      .min(1)
      .max(10)
      .optional(),
    strategy: z.literal("directory-rename"),
  })
  .superRefine((deploy, context) => {
    const roots: Array<readonly [string, string]> = [
      ["wordpressPath", deploy.wordpressPath],
      ["releasesPath", deploy.releasesPath],
      ...(deploy.backupsPath
        ? ([["backupsPath", deploy.backupsPath]] as const)
        : []),
    ];
    for (let left = 0; left < roots.length; left++) {
      for (let right = left + 1; right < roots.length; right++) {
        const [leftName, leftPath] = roots[left];
        const [rightName, rightPath] = roots[right];
        if (
          `${leftPath}/`.startsWith(`${rightPath}/`) ||
          `${rightPath}/`.startsWith(`${leftPath}/`)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${leftName} and ${rightName} must be disjoint`,
          });
        }
      }
    }
    for (const [name, path] of [
      ["configSourcePath", deploy.configSourcePath],
      ["maintenancePath", deploy.maintenancePath],
      ["wpCliPath", deploy.wpCliPath],
    ] as const) {
      if (path && roots.some(([, root]) => `${path}/`.startsWith(`${root}/`))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} must be outside deploy roots`,
        });
      }
    }
  });

export const DeployPublishConfigSchema = DeployConfigSchema.superRefine(
  (deploy, context) => {
    for (const field of [
      "backupsPath",
      "configSourcePath",
      "maintenancePath",
      "wpCliPath",
      "smokeUrls",
    ] as const) {
      if (deploy[field] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "is required for publish and rollback",
        });
      }
    }
  },
);

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
