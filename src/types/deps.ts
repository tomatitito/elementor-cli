import { z } from "zod";

export const PACKAGES_SCHEMA_VERSION = 1 as const;

const slug = z
  .string()
  .min(1)
  .max(191)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "must be a WordPress package slug");
const version = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, "must be an exact version")
  .refine(
    (value) => !["latest", "stable", "trunk"].includes(value.toLowerCase()),
    "must name an exact version, not a moving release",
  );
const sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256 hash");

function reviewedHttpsUrl(label: string) {
  return z
    .string()
    .url()
    .superRefine((value, context) => {
      const url = new URL(value);
      if (url.protocol !== "https:") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must use HTTPS`,
        });
      }
      if (url.username || url.password || url.search || url.hash) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must not contain credentials, query parameters, or fragments`,
        });
      }
    });
}

const reviewed = z.literal(true, {
  errorMap: () => ({ message: "custom sources must be explicitly reviewed" }),
});

export const PackageSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wordpress.org") }).strict(),
  z
    .object({
      type: z.literal("vendor-url"),
      url: reviewedHttpsUrl("vendor URL"),
      sha256,
      reviewed,
    })
    .strict(),
  z
    .object({
      type: z.literal("local-artifact"),
      path: z
        .string()
        .min(1)
        .refine((path) => !path.startsWith("/"), "must be project-relative")
        .refine(
          (path) =>
            !/[\0\r\n\\]/.test(path) &&
            !path.split("/").some((segment) => segment === ".."),
          "must be a safe project-relative path",
        ),
      sha256,
      reviewed,
    })
    .strict(),
  z
    .object({
      type: z.literal("git"),
      repository: reviewedHttpsUrl("Git repository URL"),
      revision: z
        .string()
        .regex(/^[a-f0-9]{40}$/, "must be a full lowercase Git commit hash"),
      artifactUrl: reviewedHttpsUrl("Git artifact URL"),
      sha256,
      reviewed,
    })
    .strict(),
]);

const packageEntry = z
  .object({
    slug,
    version,
    active: z.boolean(),
    source: PackageSourceSchema,
    updatePolicy: z.enum(["exact", "patch", "minor", "major"]).optional(),
  })
  .strict();

const packageList = z.array(packageEntry).superRefine((packages, context) => {
  const seen = new Set<string>();
  for (let index = 0; index < packages.length; index++) {
    const packageSlug = packages[index].slug;
    if (seen.has(packageSlug)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "slug"],
        message: `duplicate package slug '${packageSlug}'`,
      });
    }
    seen.add(packageSlug);
  }
});

const themeList = packageList.superRefine((themes, context) => {
  if (
    themes.length > 0 &&
    themes.filter((theme) => theme.active).length !== 1
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "exactly one listed theme must be active",
    });
  }
});

export const PackagesManifestSchema = z
  .object({
    schemaVersion: z.literal(PACKAGES_SCHEMA_VERSION),
    core: z
      .object({
        version,
        locale: z
          .string()
          .min(2)
          .max(20)
          .regex(/^[A-Za-z_@-]+$/, "must be a WordPress locale"),
        updatePolicy: z.enum(["exact", "patch", "minor", "major"]).optional(),
      })
      .strict(),
    plugins: packageList.default([]),
    themes: themeList.default([]),
  })
  .strict();

export type PackageSource = z.infer<typeof PackageSourceSchema>;
export type PackageManifestEntry = z.infer<typeof packageEntry>;
export type PackagesManifest = z.infer<typeof PackagesManifestSchema>;
export type UpdatePolicy = "exact" | "patch" | "minor" | "major";

export interface ObservedPlugin {
  slug: string;
  version: string;
  activationState: "active" | "inactive" | "network-active";
}

export interface ObservedTheme {
  slug: string;
  version: string;
  active: boolean;
  parent: string | null;
  child: boolean;
}

export interface ObservedSpecialPackage {
  slug: string;
  name: string;
  version: string | null;
}

export interface RecordedPackageSource {
  kind: "plugin" | "theme";
  slug: string;
  source: PackageSource;
}

export interface SiteInventory {
  schemaVersion: typeof PACKAGES_SCHEMA_VERSION;
  site: { name: string; publicUrl: string };
  collectedAt: string;
  core: { version: string; locale: string };
  phpVersion: string;
  plugins: ObservedPlugin[];
  themes: ObservedTheme[];
  muPlugins: ObservedSpecialPackage[];
  dropIns: ObservedSpecialPackage[];
  recordedSources: RecordedPackageSource[];
  trust: "observation-only";
}
