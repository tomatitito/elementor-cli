import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  PackageManifestEntry,
  PackagesManifest,
  SiteInventory,
  UpdatePolicy,
} from "../types/deps.js";
import { PackagesManifestSchema } from "../types/deps.js";
import { DepsOperationalError } from "./deps-manager.js";

export type UpdateCategory = "core" | "theme" | "plugin";
export type UpdateStatus =
  | "selected"
  | "skipped"
  | "unchanged"
  | "unknown"
  | "failed";

export interface UpdateReport {
  category: UpdateCategory;
  package: string;
  current: string | null;
  desired: string;
  available: string[] | null;
  availableByPolicy: {
    patch: string | null;
    minor: string | null;
    major: string | null;
  } | null;
  selected: string | null;
  policy: UpdatePolicy;
  source: string;
  state: string;
  status: UpdateStatus;
  reason: string;
}

export interface ReleaseProvider {
  core(locale: string): Promise<string[]>;
  package(kind: "plugin" | "theme", slug: string): Promise<string[]>;
}

interface ParsedVersion {
  original: string;
  numbers: number[];
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(
    /^[vV]?(\d+(?:\.\d+)*)(?:[-_.]?([A-Za-z][A-Za-z0-9.-]*))?(?:\+[A-Za-z0-9.-]+)?$/,
  );
  if (!match) return null;
  return {
    original: version,
    numbers: match[1].split(".").map(Number),
    prerelease: match[2]
      ? (match[2].match(/[A-Za-z]+|\d+/g) ?? []).map((part) =>
          part.toLowerCase(),
        )
      : [],
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) {
    throw new DepsOperationalError(
      `Cannot compare non-semantic version '${!a ? left : right}'.`,
    );
  }
  const width = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < width; index++) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  const prereleaseWidth = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < prereleaseWidth; index++) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart);
    const rightNumber = /^\d+$/.test(rightPart);
    if (leftNumber && rightNumber)
      return Math.sign(Number(leftPart) - Number(rightPart));
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function policyAllows(
  current: ParsedVersion,
  candidate: ParsedVersion,
  policy: UpdatePolicy,
): boolean {
  if (policy === "exact") return false;
  if ((candidate.numbers[0] ?? 0) !== (current.numbers[0] ?? 0))
    return policy === "major";
  if ((candidate.numbers[1] ?? 0) !== (current.numbers[1] ?? 0)) {
    return policy === "minor" || policy === "major";
  }
  return true;
}

export function selectVersion(
  currentVersion: string,
  availableVersions: string[],
  policy: UpdatePolicy,
): string | null {
  const current = parseVersion(currentVersion);
  if (!current) {
    throw new DepsOperationalError(
      `Cannot apply update policy to non-semantic version '${currentVersion}'.`,
    );
  }
  const candidates = [...new Set(availableVersions)]
    .map(parseVersion)
    .filter((version): version is ParsedVersion => version !== null)
    .filter(
      (version) => compareVersions(version.original, current.original) > 0,
    )
    .filter((version) => policyAllows(current, version, policy))
    // Stable manifests do not opt in to a prerelease channel implicitly.
    .filter(
      (version) =>
        current.prerelease.length > 0 || version.prerelease.length === 0,
    )
    .sort((left, right) => compareVersions(right.original, left.original));
  return candidates[0]?.original ?? null;
}

function sortedVersions(versions: string[]): string[] {
  return [...new Set(versions)].sort((left, right) => {
    try {
      return compareVersions(right, left);
    } catch {
      return left.localeCompare(right);
    }
  });
}

async function requestJson(url: URL): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": "elementor-cli dependency updater" },
      redirect: "error",
    });
  } catch {
    throw new DepsOperationalError(
      "Unable to query trusted WordPress.org update metadata.",
    );
  }
  if (!response.ok) {
    throw new DepsOperationalError(
      `WordPress.org update metadata request failed with HTTP ${response.status}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new DepsOperationalError(
      "WordPress.org returned invalid update metadata.",
    );
  }
}

export const wordpressOrgReleaseProvider: ReleaseProvider = {
  async core(locale: string): Promise<string[]> {
    const url = new URL("https://api.wordpress.org/core/version-check/1.7/");
    url.searchParams.set("locale", locale);
    const value = await requestJson(url);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new DepsOperationalError(
        "WordPress.org returned invalid core release metadata.",
      );
    }
    const offers = (value as { offers?: unknown }).offers;
    if (!Array.isArray(offers)) {
      throw new DepsOperationalError(
        "WordPress.org returned invalid core release metadata.",
      );
    }
    return offers
      .map((offer) =>
        offer && typeof offer === "object" && "current" in offer
          ? (offer as { current: unknown }).current
          : null,
      )
      .filter((version): version is string => typeof version === "string");
  },

  async package(kind: "plugin" | "theme", slug: string): Promise<string[]> {
    const url = new URL(
      `https://api.wordpress.org/${kind === "plugin" ? "plugins" : "themes"}/info/1.2/`,
    );
    url.searchParams.set("action", `${kind}_information`);
    url.searchParams.set("request[slug]", slug);
    url.searchParams.set("request[fields][versions]", "1");
    const value = await requestJson(url);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new DepsOperationalError(
        `WordPress.org returned invalid ${kind} metadata for '${slug}'.`,
      );
    }
    const versions = (value as { versions?: unknown }).versions;
    if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
      throw new DepsOperationalError(
        `WordPress.org has no trusted release metadata for ${kind} '${slug}'.`,
      );
    }
    return Object.keys(versions).filter((version) => version !== "trunk");
  },
};

function packageState(
  kind: "plugin" | "theme",
  entry: PackageManifestEntry,
  inventory?: SiteInventory,
): { current: string | null; state: string } {
  if (!inventory) return { current: null, state: "not-checked" };
  if (kind === "plugin") {
    const observed = inventory.plugins.find((item) => item.slug === entry.slug);
    return {
      current: observed?.version ?? null,
      state: observed?.activationState ?? "missing",
    };
  }
  const observed = inventory.themes.find((item) => item.slug === entry.slug);
  return {
    current: observed?.version ?? null,
    state: !observed
      ? "missing"
      : observed.child
        ? observed.active
          ? "active-child"
          : "inactive-child"
        : observed.active
          ? "active-parent-or-standalone"
          : inventory.themes.some((theme) => theme.parent === observed.slug)
            ? "parent"
            : "inactive",
  };
}

function selectedReport(
  category: UpdateCategory,
  packageName: string,
  current: string | null,
  desired: string,
  available: string[],
  selected: string | null,
  policy: UpdatePolicy,
  state: string,
  explicit = false,
): UpdateReport {
  const changed = selected !== null && selected !== desired;
  return {
    category,
    package: packageName,
    current,
    desired,
    available: sortedVersions(available),
    availableByPolicy: {
      patch: selectVersion(desired, available, "patch"),
      minor: selectVersion(desired, available, "minor"),
      major: selectVersion(desired, available, "major"),
    },
    selected: changed ? selected : null,
    policy,
    source: "wordpress.org",
    state,
    status: changed ? "selected" : "unchanged",
    reason: changed
      ? explicit
        ? "explicit version requested"
        : `selected by ${policy} policy`
      : explicit
        ? "requested version is already desired"
        : policy === "exact"
          ? "exact policy does not select automatic updates"
          : "no newer eligible version under policy",
  };
}

export interface ResolveOptions {
  categories: UpdateCategory[];
  inventory?: SiteInventory;
  packageSlug?: string;
  explicitVersion?: string;
  policyOverride?: UpdatePolicy;
  provider?: ReleaseProvider;
  includeUnmanaged?: boolean;
}

export async function resolveUpdates(
  manifest: PackagesManifest,
  options: ResolveOptions,
): Promise<UpdateReport[]> {
  const provider = options.provider ?? wordpressOrgReleaseProvider;
  const reports: UpdateReport[] = [];
  if (options.categories.includes("core")) {
    const policy =
      options.policyOverride ?? manifest.core.updatePolicy ?? "exact";
    let available: string[];
    try {
      available = await provider.core(manifest.core.locale);
    } catch (error) {
      reports.push({
        category: "core",
        package: "wordpress",
        current: options.inventory?.core.version ?? null,
        desired: manifest.core.version,
        available: null,
        availableByPolicy: null,
        selected: null,
        policy,
        source: "wordpress.org",
        state: `locale:${manifest.core.locale}`,
        status: "failed",
        reason:
          error instanceof Error ? error.message : "release resolution failed",
      });
      available = [];
    }
    if (
      reports.at(-1)?.category === "core" &&
      reports.at(-1)?.status === "failed"
    ) {
      // Continue resolving other categories so bulk output is complete.
    } else {
      const selected =
        options.explicitVersion ??
        selectVersion(manifest.core.version, available, policy);
      if (
        options.explicitVersion &&
        !available.includes(options.explicitVersion)
      ) {
        throw new DepsOperationalError(
          `Requested core version '${options.explicitVersion}' is not in trusted WordPress.org metadata for locale '${manifest.core.locale}'.`,
        );
      }
      reports.push(
        selectedReport(
          "core",
          "wordpress",
          options.inventory?.core.version ?? null,
          manifest.core.version,
          available,
          selected,
          policy,
          `locale:${manifest.core.locale}`,
          !!options.explicitVersion,
        ),
      );
    }
  }

  for (const kind of ["theme", "plugin"] as const) {
    if (!options.categories.includes(kind)) continue;
    const entries = (kind === "theme" ? manifest.themes : manifest.plugins)
      .filter(
        (entry) => !options.packageSlug || entry.slug === options.packageSlug,
      )
      .sort((left, right) => left.slug.localeCompare(right.slug));
    if (options.packageSlug && entries.length === 0) {
      throw new DepsOperationalError(
        `${kind} '${options.packageSlug}' is not managed by the manifest.`,
      );
    }
    for (const entry of entries) {
      const { current, state } = packageState(kind, entry, options.inventory);
      const policy = options.policyOverride ?? entry.updatePolicy ?? "exact";
      if (entry.source.type !== "wordpress.org") {
        reports.push({
          category: kind,
          package: entry.slug,
          current,
          desired: entry.version,
          available: null,
          availableByPolicy: null,
          selected: null,
          policy,
          source: entry.source.type,
          state,
          status: options.explicitVersion ? "failed" : "unknown",
          reason: options.explicitVersion
            ? "cannot validate an explicit version without trusted update metadata"
            : "custom source has no trusted update metadata",
        });
        continue;
      }
      let available: string[];
      try {
        available = await provider.package(kind, entry.slug);
      } catch (error) {
        reports.push({
          category: kind,
          package: entry.slug,
          current,
          desired: entry.version,
          available: null,
          availableByPolicy: null,
          selected: null,
          policy,
          source: "wordpress.org",
          state,
          status: "failed",
          reason:
            error instanceof Error
              ? error.message
              : "release resolution failed",
        });
        continue;
      }
      const selected =
        options.explicitVersion ??
        selectVersion(entry.version, available, policy);
      if (
        options.explicitVersion &&
        !available.includes(options.explicitVersion)
      ) {
        throw new DepsOperationalError(
          `Requested ${kind} '${entry.slug}' version '${options.explicitVersion}' is not in trusted WordPress.org metadata.`,
        );
      }
      reports.push(
        selectedReport(
          kind,
          entry.slug,
          current,
          entry.version,
          available,
          selected,
          policy,
          state,
          !!options.explicitVersion,
        ),
      );
    }
    if (options.includeUnmanaged && options.inventory) {
      const managed = new Set(
        (kind === "theme" ? manifest.themes : manifest.plugins).map(
          (entry) => entry.slug,
        ),
      );
      const observed =
        kind === "theme" ? options.inventory.themes : options.inventory.plugins;
      for (const item of observed.filter((item) => !managed.has(item.slug))) {
        const state =
          kind === "plugin"
            ? "activationState" in item
              ? item.activationState
              : "unknown"
            : "child" in item && item.child
              ? item.active
                ? "active-unmanaged-child"
                : "inactive-unmanaged-child"
              : "active" in item && item.active
                ? "active-unmanaged"
                : "inactive-unmanaged";
        reports.push({
          category: kind,
          package: item.slug,
          current: item.version,
          desired: "unmanaged",
          available: null,
          availableByPolicy: null,
          selected: null,
          policy: "exact",
          source: "unmanaged",
          state,
          status: "skipped",
          reason: "not managed by manifest",
        });
      }
    }
  }
  return reports.sort((left, right) =>
    `${left.category}:${left.package}`.localeCompare(
      `${right.category}:${right.package}`,
    ),
  );
}

export function applySelectedVersions(
  manifest: PackagesManifest,
  reports: UpdateReport[],
): PackagesManifest {
  const next = structuredClone(manifest);
  for (const report of reports) {
    if (!report.selected) continue;
    if (report.category === "core") next.core.version = report.selected;
    else {
      const list = report.category === "theme" ? next.themes : next.plugins;
      const entry = list.find((item) => item.slug === report.package);
      if (entry) entry.version = report.selected;
    }
  }
  return PackagesManifestSchema.parse(next);
}

export async function writeManifestAtomic(
  path: string,
  manifest: PackagesManifest,
): Promise<void> {
  const file = Bun.file(path);
  const mode = (await file.stat()).mode & 0o777;
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode,
      flag: "wx",
    });
    await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new DepsOperationalError(
      `Unable to write manifest atomically: ${message}`,
    );
  }
}
