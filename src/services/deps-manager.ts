import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type {
  PackageManifestEntry,
  PackageSource,
  PackagesManifest,
  RecordedPackageSource,
  SiteInventory,
} from "../types/deps.js";
import {
  PACKAGES_SCHEMA_VERSION,
  PackageSourceSchema,
  PackagesManifestSchema,
} from "../types/deps.js";
import type { WpCliTransport } from "./wp-cli-transport.js";
import { redactWpCliSecrets } from "./wp-cli-transport.js";

const INVENTORY_SCRIPT = String.raw`
require_once ABSPATH . 'wp-admin/includes/plugin.php';
$plugin_slug = static function($file) {
  $dir = dirname($file);
  return $dir === '.' ? basename($file, '.php') : $dir;
};
$network = is_multisite() ? array_keys((array) get_site_option('active_sitewide_plugins', array())) : array();
$plugins = array();
foreach (get_plugins() as $file => $data) {
  $plugins[] = array(
    'slug' => $plugin_slug($file),
    'version' => (string) $data['Version'],
    'activationState' => in_array($file, $network, true) ? 'network-active' : (is_plugin_active($file) ? 'active' : 'inactive'),
  );
}
$themes = array();
foreach (wp_get_themes() as $theme) {
  $parent = $theme->parent();
  $themes[] = array(
    'slug' => $theme->get_stylesheet(),
    'version' => (string) $theme->get('Version'),
    'active' => get_stylesheet() === $theme->get_stylesheet(),
    'parent' => $parent ? $parent->get_stylesheet() : null,
    'child' => (bool) $parent,
  );
}
$special = static function($items) use ($plugin_slug) {
  $result = array();
  foreach ($items as $file => $data) {
    $result[] = array(
      'slug' => $plugin_slug($file),
      'name' => (string) $data['Name'],
      'version' => empty($data['Version']) ? null : (string) $data['Version'],
    );
  }
  return $result;
};
echo wp_json_encode(array(
  'publicUrl' => home_url('/'),
  'core' => array('version' => get_bloginfo('version'), 'locale' => get_locale()),
  'phpVersion' => PHP_VERSION,
  'plugins' => $plugins,
  'themes' => $themes,
  'muPlugins' => $special(get_mu_plugins()),
  'dropIns' => $special(get_dropins()),
  'recordedSources' => get_option('_elementor_cli_package_sources', array()),
));
`;

const observedPluginSchema = z
  .object({
    slug: z.string(),
    version: z.string(),
    activationState: z.enum(["active", "inactive", "network-active"]),
  })
  .strict();
const observedThemeSchema = z
  .object({
    slug: z.string(),
    version: z.string(),
    active: z.boolean(),
    parent: z.string().nullable(),
    child: z.boolean(),
  })
  .strict();
const observedSpecialSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    version: z.string().nullable(),
  })
  .strict();
const rawInventorySchema = z.object({
  publicUrl: z.string(),
  core: z.object({ version: z.string(), locale: z.string() }),
  phpVersion: z.string(),
  plugins: z.array(observedPluginSchema),
  themes: z.array(observedThemeSchema),
  muPlugins: z.array(observedSpecialSchema),
  dropIns: z.array(observedSpecialSchema),
  recordedSources: z.unknown(),
});

function bySlug<T extends { slug: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.slug.localeCompare(right.slug));
}

function safePublicUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseRecordedSources(value: unknown): RecordedPackageSource[] {
  if (!Array.isArray(value)) return [];
  const result: RecordedPackageSource[] = [];
  for (const item of value) {
    const parsed = z
      .object({
        kind: z.enum(["plugin", "theme"]),
        slug: z.string(),
        source: PackageSourceSchema,
      })
      .strict()
      .safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result.sort((left, right) =>
    `${left.kind}:${left.slug}`.localeCompare(`${right.kind}:${right.slug}`),
  );
}

export class DepsOperationalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepsOperationalError";
  }
}

async function execOrThrow(
  transport: WpCliTransport,
  args: string[],
  stdin?: string | Uint8Array,
): Promise<string> {
  const result = await transport.exec(args, { stdin });
  if (result.exitCode !== 0) {
    const detail = redactWpCliSecrets(
      result.stderr.trim() || result.stdout.trim(),
      args,
    );
    throw new DepsOperationalError(
      detail
        ? `WP-CLI failed: ${detail}`
        : `WP-CLI exited with code ${result.exitCode}.`,
    );
  }
  return result.stdout.trim();
}

export async function collectInventory(
  transport: WpCliTransport,
  siteName: string,
  collectedAt = new Date(),
): Promise<SiteInventory> {
  const output = await execOrThrow(transport, ["eval", INVENTORY_SCRIPT]);
  let decoded: unknown;
  try {
    decoded = JSON.parse(output);
  } catch {
    throw new DepsOperationalError("WP-CLI returned invalid inventory JSON.");
  }
  const raw = rawInventorySchema.safeParse(decoded);
  if (!raw.success) {
    throw new DepsOperationalError(
      "WP-CLI returned an invalid inventory shape.",
    );
  }
  return {
    schemaVersion: PACKAGES_SCHEMA_VERSION,
    site: { name: siteName, publicUrl: safePublicUrl(raw.data.publicUrl) },
    collectedAt: collectedAt.toISOString(),
    core: raw.data.core,
    phpVersion: raw.data.phpVersion,
    plugins: bySlug(raw.data.plugins),
    themes: bySlug(raw.data.themes),
    muPlugins: bySlug(raw.data.muPlugins),
    dropIns: bySlug(raw.data.dropIns),
    recordedSources: parseRecordedSources(raw.data.recordedSources),
    trust: "observation-only",
  };
}

export async function readPackagesManifest(
  path: string,
): Promise<PackagesManifest> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(await Bun.file(path).text());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DepsOperationalError(`Unable to read manifest: ${message}`);
  }
  const result = PackagesManifestSchema.safeParse(decoded);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
      .join("; ");
    throw new DepsOperationalError(`Invalid packages manifest: ${details}`);
  }
  return result.data;
}

export type DriftKind = "core" | "plugin" | "theme";
export type DriftField =
  | "presence"
  | "version"
  | "locale"
  | "active"
  | "source"
  | "unexpected";

export interface DependencyDrift {
  kind: DriftKind;
  package: string;
  field: DriftField;
  expected: string | boolean;
  actual: string | boolean;
}

function sourceIdentity(source: PackageSource): string {
  if (source.type === "wordpress.org") return source.type;
  const metadata = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(source))
    .digest("hex")
    .slice(0, 12);
  if (source.type === "git")
    return `git:${source.revision}:${source.sha256}:metadata-${metadata}`;
  return `${source.type}:${source.sha256}:metadata-${metadata}`;
}

function sourcesMatch(left: PackageSource, right: PackageSource): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparePackage(
  kind: "plugin" | "theme",
  expected: PackageManifestEntry,
  actual: { version: string; active: boolean } | undefined,
  inventory: SiteInventory,
): DependencyDrift[] {
  if (!actual) {
    return [
      {
        kind,
        package: expected.slug,
        field: "presence",
        expected: "installed",
        actual: "missing",
      },
    ];
  }
  const drift: DependencyDrift[] = [];
  if (actual.version !== expected.version) {
    drift.push({
      kind,
      package: expected.slug,
      field: "version",
      expected: expected.version,
      actual: actual.version,
    });
  }
  if (actual.active !== expected.active) {
    drift.push({
      kind,
      package: expected.slug,
      field: "active",
      expected: expected.active,
      actual: actual.active,
    });
  }
  const recorded = inventory.recordedSources.find(
    (item) => item.kind === kind && item.slug === expected.slug,
  );
  if (expected.source.type !== "wordpress.org") {
    const expectedSource = sourceIdentity(expected.source);
    const actualSource = recorded
      ? sourceIdentity(recorded.source)
      : "unrecorded";
    if (!recorded || !sourcesMatch(expected.source, recorded.source)) {
      drift.push({
        kind,
        package: expected.slug,
        field: "source",
        expected: expectedSource,
        actual: actualSource,
      });
    }
  } else if (recorded && recorded.source.type !== "wordpress.org") {
    drift.push({
      kind,
      package: expected.slug,
      field: "source",
      expected: "wordpress.org",
      actual: sourceIdentity(recorded.source),
    });
  }
  return drift;
}

export function compareDependencies(
  manifest: PackagesManifest,
  inventory: SiteInventory,
  strict = false,
): DependencyDrift[] {
  const drift: DependencyDrift[] = [];
  if (manifest.core.version !== inventory.core.version) {
    drift.push({
      kind: "core",
      package: "wordpress",
      field: "version",
      expected: manifest.core.version,
      actual: inventory.core.version,
    });
  }
  if (manifest.core.locale !== inventory.core.locale) {
    drift.push({
      kind: "core",
      package: "wordpress",
      field: "locale",
      expected: manifest.core.locale,
      actual: inventory.core.locale,
    });
  }
  for (const expected of manifest.plugins) {
    const observed = inventory.plugins.find(
      (item) => item.slug === expected.slug,
    );
    drift.push(
      ...comparePackage(
        "plugin",
        expected,
        observed && {
          version: observed.version,
          active: observed.activationState !== "inactive",
        },
        inventory,
      ),
    );
  }
  for (const expected of manifest.themes) {
    const observed = inventory.themes.find(
      (item) => item.slug === expected.slug,
    );
    drift.push(
      ...comparePackage(
        "theme",
        expected,
        observed && { version: observed.version, active: observed.active },
        inventory,
      ),
    );
  }
  if (strict) {
    const pluginSlugs = new Set(manifest.plugins.map((item) => item.slug));
    const themeSlugs = new Set(manifest.themes.map((item) => item.slug));
    for (const item of inventory.plugins) {
      if (!pluginSlugs.has(item.slug)) {
        drift.push({
          kind: "plugin",
          package: item.slug,
          field: "unexpected",
          expected: "not installed",
          actual: "installed",
        });
      }
    }
    for (const item of inventory.themes) {
      if (!themeSlugs.has(item.slug)) {
        drift.push({
          kind: "theme",
          package: item.slug,
          field: "unexpected",
          expected: "not installed",
          actual: "installed",
        });
      }
    }
  }
  return drift.sort((left, right) =>
    `${left.kind}:${left.package}:${left.field}`.localeCompare(
      `${right.kind}:${right.package}:${right.field}`,
    ),
  );
}

export type InstallActionType =
  | "install"
  | "activate"
  | "deactivate"
  | "remove";
export interface InstallAction {
  type: InstallActionType;
  kind: DriftKind;
  package: string;
  version?: string;
  source?: PackageSource;
  network?: boolean;
}

export function planInstall(
  manifest: PackagesManifest,
  inventory: SiteInventory,
  prune = false,
): InstallAction[] {
  const actions: InstallAction[] = [];
  if (
    manifest.core.version !== inventory.core.version ||
    manifest.core.locale !== inventory.core.locale
  ) {
    actions.push({
      type: "install",
      kind: "core",
      package: "wordpress",
      version: manifest.core.version,
    });
  }
  const planPackages = (
    kind: "plugin" | "theme",
    expectedPackages: PackageManifestEntry[],
  ) => {
    const observedPackages =
      kind === "plugin" ? inventory.plugins : inventory.themes;
    for (const expected of expectedPackages) {
      const observed = observedPackages.find(
        (item) => item.slug === expected.slug,
      );
      const recorded = inventory.recordedSources.find(
        (item) => item.kind === kind && item.slug === expected.slug,
      );
      const actualVersion = observed?.version;
      const wrongSource =
        expected.source.type !== "wordpress.org"
          ? !recorded || !sourcesMatch(recorded.source, expected.source)
          : !!recorded && recorded.source.type !== "wordpress.org";
      if (!observed || actualVersion !== expected.version || wrongSource) {
        actions.push({
          type: "install",
          kind,
          package: expected.slug,
          version: expected.version,
          source: expected.source,
        });
      }
    }
    for (const expected of expectedPackages) {
      const observed = observedPackages.find(
        (item) => item.slug === expected.slug,
      );
      const active =
        kind === "plugin"
          ? observed &&
            "activationState" in observed &&
            observed.activationState !== "inactive"
          : observed && "active" in observed && observed.active;
      if (active !== undefined && active !== expected.active) {
        if (kind === "theme" && !expected.active) continue;
        actions.push({
          type: expected.active ? "activate" : "deactivate",
          kind,
          package: expected.slug,
          network:
            kind === "plugin" &&
            observed !== undefined &&
            "activationState" in observed &&
            observed.activationState === "network-active",
        });
      } else if (!observed && expected.active) {
        actions.push({ type: "activate", kind, package: expected.slug });
      }
    }
  };
  planPackages("plugin", manifest.plugins);
  planPackages("theme", manifest.themes);

  if (prune) {
    const pluginSlugs = new Set(manifest.plugins.map((item) => item.slug));
    const themeSlugs = new Set(manifest.themes.map((item) => item.slug));
    for (const item of inventory.plugins) {
      if (!pluginSlugs.has(item.slug))
        actions.push({ type: "remove", kind: "plugin", package: item.slug });
    }
    for (const item of inventory.themes) {
      if (!themeSlugs.has(item.slug))
        actions.push({ type: "remove", kind: "theme", package: item.slug });
    }
  }
  return actions;
}

export function describeAction(action: InstallAction): string {
  if (action.type === "install") {
    const source = action.source ? action.source.type : "wordpress.org";
    return `INSTALL ${action.kind} ${action.package} ${action.version} from ${source}`;
  }
  return `${action.type.toUpperCase()} ${action.kind} ${action.package}`;
}

const INSTALL_ARTIFACT_SCRIPT = String.raw`
$kind = $args[0]; $expected = $args[1];
$tmp = wp_tempnam('elementor-cli-package.zip');
$out = fopen($tmp, 'wb'); stream_copy_to_stream(STDIN, $out); fclose($out);
if (!hash_equals($expected, hash_file('sha256', $tmp))) { @unlink($tmp); WP_CLI::error('Artifact SHA-256 mismatch.'); }
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
$skin = new Automatic_Upgrader_Skin();
$upgrader = $kind === 'plugin' ? new Plugin_Upgrader($skin) : new Theme_Upgrader($skin);
$result = $upgrader->install($tmp, array('overwrite_package' => true));
@unlink($tmp);
if (is_wp_error($result)) { WP_CLI::error($result->get_error_message()); }
if (!$result) { WP_CLI::error('WordPress rejected the package artifact.'); }
`;

const RECORD_SOURCE_SCRIPT = String.raw`
$entry = json_decode(stream_get_contents(STDIN), true);
$records = get_option('_elementor_cli_package_sources', array());
$records = is_array($records) ? $records : array();
$records = array_values(array_filter($records, static function($item) use ($entry) {
  return !is_array($item) || ($item['kind'] ?? '') !== $entry['kind'] || ($item['slug'] ?? '') !== $entry['slug'];
}));
if ($entry['source'] !== null) { $records[] = $entry; }
update_option('_elementor_cli_package_sources', $records, false);
`;

async function artifactBytes(
  source: Exclude<PackageSource, { type: "wordpress.org" }>,
): Promise<Uint8Array> {
  const maximumBytes = 200 * 1024 * 1024;
  if (source.type === "local-artifact") {
    const root = await realpath(process.cwd());
    const configured = resolve(root, source.path);
    const pathFromRoot = relative(root, configured);
    if (
      pathFromRoot === ".." ||
      pathFromRoot.startsWith("../") ||
      isAbsolute(pathFromRoot)
    ) {
      throw new DepsOperationalError(
        "Local package artifacts must remain inside the project root.",
      );
    }
    let realFile: string;
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      [realFile, fileStat] = await Promise.all([
        realpath(configured),
        stat(configured),
      ]);
    } catch {
      throw new DepsOperationalError(
        "Local package artifact is missing or unreadable.",
      );
    }
    const realPathFromRoot = relative(root, realFile);
    if (
      realPathFromRoot === ".." ||
      realPathFromRoot.startsWith("../") ||
      isAbsolute(realPathFromRoot) ||
      !fileStat.isFile()
    ) {
      throw new DepsOperationalError(
        "Local package artifact is not a regular project file.",
      );
    }
    if (fileStat.size > maximumBytes)
      throw new DepsOperationalError(
        "Package artifact exceeds the 200 MiB limit.",
      );
    try {
      return new Uint8Array(await Bun.file(realFile).arrayBuffer());
    } catch {
      throw new DepsOperationalError(
        "Local package artifact is missing or unreadable.",
      );
    }
  }
  const sourceUrl = source.type === "git" ? source.artifactUrl : source.url;
  const response = await fetch(sourceUrl, { redirect: "follow" });
  if (!response.ok || new URL(response.url).protocol !== "https:") {
    throw new DepsOperationalError(
      `Unable to download reviewed ${source.type} artifact over HTTPS.`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes)
    throw new DepsOperationalError(
      "Package artifact exceeds the 200 MiB limit.",
    );
  if (!response.body)
    throw new DepsOperationalError("Package artifact response had no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new DepsOperationalError(
        "Package artifact exceeds the 200 MiB limit.",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function recordSource(
  transport: WpCliTransport,
  kind: "plugin" | "theme",
  slug: string,
  source: PackageSource | null,
): Promise<void> {
  await execOrThrow(
    transport,
    ["eval", RECORD_SOURCE_SCRIPT],
    JSON.stringify({ kind, slug, source }),
  );
}

export async function executeInstallPlan(
  transport: WpCliTransport,
  manifest: PackagesManifest,
  actions: InstallAction[],
): Promise<void> {
  for (const action of actions) {
    if (action.type === "install" && action.kind === "core") {
      await execOrThrow(transport, [
        "core",
        "update",
        `--version=${action.version}`,
        `--locale=${manifest.core.locale}`,
        "--force",
      ]);
      if (manifest.core.locale === "en_US") {
        await execOrThrow(transport, ["option", "update", "WPLANG", ""]);
      } else {
        await execOrThrow(transport, [
          "language",
          "core",
          "install",
          manifest.core.locale,
          "--activate",
        ]);
      }
      continue;
    }
    if (action.type === "install" && action.kind !== "core" && action.source) {
      if (action.source.type === "wordpress.org") {
        await execOrThrow(transport, [
          action.kind,
          "install",
          action.package,
          `--version=${action.version}`,
          "--force",
        ]);
      } else {
        const bytes = await artifactBytes(action.source);
        const actualHash = new Bun.CryptoHasher("sha256")
          .update(bytes)
          .digest("hex");
        if (actualHash !== action.source.sha256) {
          throw new DepsOperationalError(
            `SHA-256 mismatch for ${action.kind} '${action.package}'.`,
          );
        }
        await execOrThrow(
          transport,
          ["eval", INSTALL_ARTIFACT_SCRIPT, action.kind, action.source.sha256],
          bytes,
        );
      }
      const installedVersion = await execOrThrow(transport, [
        action.kind,
        "get",
        action.package,
        "--field=version",
      ]);
      if (installedVersion !== action.version) {
        throw new DepsOperationalError(
          `${action.kind} '${action.package}' installed version '${installedVersion}', expected exact version '${action.version}'.`,
        );
      }
      await recordSource(
        transport,
        action.kind,
        action.package,
        action.source.type === "wordpress.org" ? null : action.source,
      );
      continue;
    }
    if (action.kind === "core") continue;
    if (action.type === "activate") {
      await execOrThrow(transport, [action.kind, "activate", action.package]);
    } else if (action.type === "deactivate") {
      if (action.kind === "theme") continue;
      await execOrThrow(transport, [
        "plugin",
        "deactivate",
        action.package,
        ...(action.network ? ["--network"] : []),
      ]);
    } else if (action.type === "remove") {
      await execOrThrow(transport, [action.kind, "delete", action.package]);
      await recordSource(transport, action.kind, action.package, null);
    }
  }
}
