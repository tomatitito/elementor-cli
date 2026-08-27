import { z } from "zod";
import type {
  PackageManifestEntry,
  PackageSource,
  PackagesManifest,
  RecordedPackageSource,
  SiteInventory,
} from "../types/deps.js";
import { DepsOperationalError } from "./deps-manager.js";
import type { WpCliTransport } from "./wp-cli-transport.js";
import { redactWpCliSecrets } from "./wp-cli-transport.js";

export type DependencyAuditSeverity = "info" | "warning" | "high" | "critical";
export type DependencyAuditComponent = "core" | "plugin" | "theme" | "uploads";

export interface DependencyAuditFinding {
  severity: DependencyAuditSeverity;
  componentType: DependencyAuditComponent;
  package?: string;
  version?: string;
  reason: string;
  path?: string;
  expected?: string;
  actual?: string;
  reference?: string;
  remediation: string;
}

export interface DependencyAuditReport {
  schemaVersion: 1;
  command: "deps audit";
  site: string;
  status: "clean" | "findings";
  threshold: DependencyAuditSeverity;
  findings: DependencyAuditFinding[];
}

type ChecksumKind = "added" | "missing" | "modified";

export interface NormalizedChecksumFinding {
  kind: ChecksumKind;
  path: string;
}

export interface ChecksumUnavailable {
  cause: "http-404" | "http-error" | "network-failure";
  reason: string;
}

export interface NormalizedChecksumResult {
  findings: NormalizedChecksumFinding[];
  unavailable?: ChecksumUnavailable;
}

const checksumRowSchema = z
  .object({
    file: z.string(),
    message: z.string(),
    plugin_name: z.string().optional(),
  })
  .passthrough();

const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]{0,190}$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/;
const SEVERITY_RANK: Record<DependencyAuditSeverity, number> = {
  info: 0,
  warning: 1,
  high: 2,
  critical: 3,
};

const HASH_AND_UPLOADS_SCRIPT = String.raw`
$input = json_decode(stream_get_contents(STDIN), true);
if (!is_array($input) || !isset($input['paths'], $input['plugins']) || !is_array($input['paths']) || !is_array($input['plugins'])) { WP_CLI::error('Invalid audit evidence request.'); }
$requested = $input['paths'];
$root = realpath(ABSPATH);
$hashes = array();
foreach ($requested as $path) {
  if (!is_string($path) || strpos($path, "\0") !== false || strpos($path, '\\') !== false || substr($path, 0, 1) === '/') { WP_CLI::error('Invalid audit path.'); }
  $segments = explode('/', $path);
  if (in_array('', $segments, true) || in_array('.', $segments, true) || in_array('..', $segments, true)) { WP_CLI::error('Invalid audit path.'); }
  $candidate = ABSPATH . $path;
  $real = realpath($candidate);
  if ($real === false || is_link($candidate) || !is_file($real) || ($real !== $root && strpos($real, $root . DIRECTORY_SEPARATOR) !== 0)) { continue; }
  $hashes[$path] = hash_file('sha256', $real);
}
$plugin_missing = array();
$expected = array();
foreach ($input['plugins'] as $plugin) {
  if (!is_array($plugin) || !isset($plugin['slug'], $plugin['version']) || !preg_match('/^[a-z0-9][a-z0-9._-]{0,190}$/D', $plugin['slug']) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/D', $plugin['version'])) { WP_CLI::error('Invalid plugin checksum request.'); }
  $url = 'https://downloads.wordpress.org/plugin-checksums/' . rawurlencode($plugin['slug']) . '/' . rawurlencode($plugin['version']) . '.json';
  $response = wp_remote_get($url, array('timeout' => 20, 'redirection' => 2, 'reject_unsafe_urls' => true, 'limit_response_size' => 20971520));
  if (is_wp_error($response)) { WP_CLI::error('Independent plugin checksum retrieval failed due to a network error.'); }
  $status = wp_remote_retrieve_response_code($response);
  if ($status !== 200) { WP_CLI::error('Independent plugin checksum retrieval returned HTTP ' . $status . '.'); }
  $decoded = json_decode(wp_remote_retrieve_body($response), true);
  if (!is_array($decoded) || !isset($decoded['files']) || !is_array($decoded['files']) || count($decoded['files']) > 100000) { WP_CLI::error('Independent plugin checksum response was invalid or exceeded the safety limit.'); }
  foreach ($decoded['files'] as $file => $checksums) {
    if (!is_string($file) || !is_array($checksums) || strpos($file, "\0") !== false || strpos($file, '\\') !== false || substr($file, 0, 1) === '/') { WP_CLI::error('Invalid path in plugin checksum reference.'); }
    $segments = explode('/', $file);
    if (in_array('', $segments, true) || in_array('.', $segments, true) || in_array('..', $segments, true)) { WP_CLI::error('Invalid path in plugin checksum reference.'); }
    $path = 'wp-content/plugins/' . $plugin['slug'] . '/' . $file;
    $sha256 = isset($checksums['sha256']) ? array_values(array_filter((array) $checksums['sha256'], static function($hash) { return is_string($hash) && preg_match('/^[a-f0-9]{64}$/D', $hash); })) : array();
    sort($sha256);
    if (!empty($sha256)) { $expected[$path] = $sha256; }
    if (!is_file(ABSPATH . $path)) { $plugin_missing[] = array('slug' => $plugin['slug'], 'version' => $plugin['version'], 'path' => $path); }
  }
}
$uploads = array();
$upload = wp_upload_dir(null, false);
$configured_uploads = isset($upload['basedir']) && is_string($upload['basedir']) ? $upload['basedir'] : null;
$base = $configured_uploads !== null ? realpath($configured_uploads) : false;
$uploads_status = $configured_uploads !== null && file_exists($configured_uploads) ? ($base === false ? 'unavailable' : (($base === $root || strpos($base, $root . DIRECTORY_SEPARATOR) === 0) ? 'scanned' : 'outside-root')) : 'not-present';
if ($uploads_status === 'scanned') {
  $flags = FilesystemIterator::SKIP_DOTS | FilesystemIterator::CURRENT_AS_FILEINFO;
  $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, $flags));
  $extensions = array('phtml', 'pht', 'phtm', 'phar', 'cgi', 'pl', 'py', 'rb', 'sh', 'bash', 'zsh', 'fish', 'exe', 'com', 'bat', 'cmd', 'ps1', 'dll', 'so', 'jsp', 'asp', 'aspx');
  $visited = 0;
  foreach ($iterator as $file) {
    if (++$visited > 100000) { WP_CLI::error('Uploads scan exceeded the 100000-entry safety limit.'); }
    if (!$file->isFile() || $file->isLink()) { continue; }
    $extension = strtolower($file->getExtension());
    $executable_extension = preg_match('/^php\d*$/D', $extension) || in_array($extension, $extensions, true);
    $executable_mode = ($file->getPerms() & 0111) !== 0;
    if (!$executable_extension && !$executable_mode) { continue; }
    $real = $file->getRealPath();
    if ($real === false || strpos($real, $base . DIRECTORY_SEPARATOR) !== 0) { continue; }
    $relative = str_replace(DIRECTORY_SEPARATOR, '/', substr($real, strlen($root) + 1));
    $uploads[] = array('path' => $relative, 'sha256' => hash_file('sha256', $real));
  }
}
usort($uploads, static function($a, $b) { return strcmp($a['path'], $b['path']); });
usort($plugin_missing, static function($a, $b) { return strcmp($a['path'], $b['path']); });
ksort($expected);
echo wp_json_encode(array('hashes' => $hashes, 'expected' => $expected, 'pluginMissing' => $plugin_missing, 'uploadsStatus' => $uploads_status, 'uploads' => $uploads));
`;

const hashOutputSchema = z.object({
  hashes: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
  expected: z.record(z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1)),
  pluginMissing: z.array(
    z.object({ slug: z.string(), version: z.string(), path: z.string() }),
  ),
  uploadsStatus: z.enum([
    "scanned",
    "not-present",
    "outside-root",
    "unavailable",
  ]),
  uploads: z.array(
    z.object({
      path: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});

function safeRelativePath(path: string): string {
  const normalized = path.replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    /[\0\r\n]/.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new DepsOperationalError(
      "WP-CLI returned an unsafe checksum finding path.",
    );
  }
  return normalized;
}

function checksumKind(message: string): ChecksumKind | undefined {
  if (/\b(?:file\s+)?was added\b|\bshould not exist\b/i.test(message))
    return "added";
  if (
    /\b(?:file\s+)?is missing\b|\bdoes not exist\b|\bdoesn't exist\b/i.test(
      message,
    )
  )
    return "missing";
  if (/checksum does not match|doesn't verify against checksum/i.test(message))
    return "modified";
  return undefined;
}

export function normalizeChecksumOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
): NormalizedChecksumResult {
  let rows: z.infer<typeof checksumRowSchema>[] = [];
  const output = stdout.trim();
  if (output) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(output);
    } catch {
      throw new DepsOperationalError("WP-CLI returned invalid checksum JSON.");
    }
    const parsed = z.array(checksumRowSchema).safeParse(decoded);
    if (!parsed.success)
      throw new DepsOperationalError(
        "WP-CLI returned an invalid checksum result shape.",
      );
    rows = parsed.data;
  }

  const findings: NormalizedChecksumFinding[] = [];
  const unknownMessages: string[] = [];
  for (const row of rows) {
    const kind = checksumKind(row.message);
    if (kind) findings.push({ kind, path: safeRelativePath(row.file) });
    else unknownMessages.push(row.message);
  }
  findings.sort((left, right) =>
    `${left.path}:${left.kind}`.localeCompare(`${right.path}:${right.kind}`),
  );

  const failureText = redactWpCliSecrets(
    [...unknownMessages, stderr].filter(Boolean).join("\n"),
  );
  if (/\b404\b|not found|no checksums (?:are )?available/i.test(failureText)) {
    return {
      findings,
      unavailable: {
        cause: "http-404",
        reason:
          "HTTP 404: WordPress.org has no checksums for this package and version.",
      },
    };
  }
  const httpStatus = failureText.match(
    /HTTP(?:\s+(?:code|status))?\s*[:=]?\s*(\d{3})/i,
  );
  if (httpStatus) {
    return {
      findings,
      unavailable: {
        cause: "http-error",
        reason: `HTTP ${httpStatus[1]}: WordPress.org checksum retrieval failed.`,
      },
    };
  }
  if (
    /timed? out|could not resolve|couldn't connect|unable to connect|curl error|network|couldn't fetch|failed to open stream/i.test(
      failureText,
    )
  ) {
    return {
      findings,
      unavailable: {
        cause: "network-failure",
        reason: "Network failure while retrieving WordPress.org checksums.",
      },
    };
  }
  if (unknownMessages.length > 0) {
    throw new DepsOperationalError(
      "WP-CLI returned an unrecognized checksum finding.",
    );
  }
  if (exitCode !== 0 && findings.length === 0) {
    const detail = failureText.trim();
    throw new DepsOperationalError(
      detail
        ? `Checksum audit failed: ${detail}`
        : `Checksum audit exited with code ${exitCode}.`,
    );
  }
  return { findings };
}

function referenceFor(
  component: DependencyAuditComponent,
  packageSlug: string,
  version: string,
): string {
  if (component === "core")
    return `WordPress.org core checksums for ${version}`;
  return `WordPress.org ${component} checksums for ${packageSlug} ${version}`;
}

function remediationFor(kind: ChecksumKind): string {
  if (kind === "added")
    return "Remove the unexpected file only after preserving evidence and investigating its origin; reinstall the exact trusted package if needed.";
  return "Reinstall the exact trusted version and investigate when and how the file changed.";
}

function sourceDescription(source: PackageSource): string {
  if (source.type === "wordpress.org") return "WordPress.org";
  if (source.type === "git")
    return `reviewed Git commit ${source.revision}, artifact SHA-256 ${source.sha256}`;
  return `reviewed ${source.type} artifact SHA-256 ${source.sha256}`;
}

function sourcesEqual(left: PackageSource, right: PackageSource): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function manifestEntry(
  manifest: PackagesManifest | undefined,
  kind: "plugin" | "theme",
  slug: string,
): PackageManifestEntry | undefined {
  return manifest?.[kind === "plugin" ? "plugins" : "themes"].find(
    (entry) => entry.slug === slug,
  );
}

function recordedSource(
  inventory: SiteInventory,
  kind: "plugin" | "theme",
  slug: string,
): RecordedPackageSource | undefined {
  return inventory.recordedSources.find(
    (entry) => entry.kind === kind && entry.slug === slug,
  );
}

async function runChecksum(
  transport: WpCliTransport,
  args: string[],
): Promise<NormalizedChecksumResult> {
  const result = await transport.exec(args);
  return normalizeChecksumOutput(result.stdout, result.stderr, result.exitCode);
}

interface PendingChecksum {
  componentType: "core" | "plugin";
  package: string;
  version: string;
  path: string;
  kind: ChecksumKind;
  reference: string;
}

interface PluginChecksumReference {
  slug: string;
  version: string;
}

function checksumFinding(
  pending: PendingChecksum,
  hash?: string,
  expectedHashes?: string[],
): DependencyAuditFinding {
  const executable =
    /\.(?:php\d*|phtml|pht|phtm|phar|cgi|pl|py|rb|sh|bash|zsh|fish|exe|com|bat|cmd|ps1|dll|so|jsp|asp|aspx)$/i.test(
      pending.path,
    );
  const added = pending.kind === "added";
  return {
    severity:
      pending.kind === "modified" || (added && executable)
        ? "critical"
        : "high",
    componentType: pending.componentType,
    package: pending.package,
    version: pending.version,
    reason:
      pending.kind === "modified"
        ? "installed file does not match the official package checksum"
        : pending.kind === "missing"
          ? "official package file is missing"
          : "unexpected file is absent from the official package",
    path: pending.path,
    expected:
      pending.kind === "added"
        ? "file absent"
        : pending.kind === "missing"
          ? expectedHashes
            ? `official file present; SHA-256 ${expectedHashes.join(" or ")}`
            : "official file present"
          : expectedHashes
            ? `SHA-256 ${expectedHashes.join(" or ")}`
            : "official checksum match",
    actual:
      pending.kind === "missing"
        ? "file missing"
        : hash
          ? `SHA-256 ${hash}`
          : "file became unavailable during SHA-256 evidence collection",
    reference: pending.reference,
    remediation: remediationFor(pending.kind),
  };
}

function unavailableFinding(
  componentType: "core" | "plugin" | "theme",
  packageSlug: string,
  version: string,
  reason: string,
  reference: string,
  evidence: {
    expected: string;
    actual: string;
  } = {
    expected: "trusted reference checksums available",
    actual: "reference checksums unavailable",
  },
): DependencyAuditFinding {
  return {
    severity: "warning",
    componentType,
    package: packageSlug,
    version,
    reason,
    expected: evidence.expected,
    actual: evidence.actual,
    reference,
    remediation:
      "Confirm the package source and version from a trusted channel, then supply independently reviewed integrity metadata before relying on this audit.",
  };
}

function sortFindings(
  findings: DependencyAuditFinding[],
): DependencyAuditFinding[] {
  return findings.sort((left, right) => {
    const severity =
      SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (severity !== 0) return severity;
    return [
      left.componentType,
      left.package ?? "",
      left.path ?? "",
      left.reason,
    ]
      .join(":")
      .localeCompare(
        [
          right.componentType,
          right.package ?? "",
          right.path ?? "",
          right.reason,
        ].join(":"),
      );
  });
}

export function exitCodeForAudit(
  findings: DependencyAuditFinding[],
  threshold: DependencyAuditSeverity,
): 0 | 1 {
  return findings.some(
    (finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[threshold],
  )
    ? 1
    : 0;
}

export async function auditDependencies(
  transport: WpCliTransport,
  inventory: SiteInventory,
  manifest?: PackagesManifest,
): Promise<DependencyAuditFinding[]> {
  const findings: DependencyAuditFinding[] = [];
  const pending: PendingChecksum[] = [];
  const pluginReferences: PluginChecksumReference[] = [];
  const coreReference = referenceFor(
    "core",
    "wordpress",
    inventory.core.version,
  );
  const core = await runChecksum(transport, [
    "core",
    "verify-checksums",
    `--version=${inventory.core.version}`,
    `--locale=${inventory.core.locale}`,
    "--include-root",
    "--format=json",
  ]);
  for (const item of core.findings) {
    pending.push({
      componentType: "core",
      package: "wordpress",
      version: inventory.core.version,
      path: item.path,
      kind: item.kind,
      reference: coreReference,
    });
  }
  if (core.unavailable) {
    findings.push(
      unavailableFinding(
        "core",
        "wordpress",
        inventory.core.version,
        core.unavailable.reason,
        coreReference,
      ),
    );
  }

  for (const plugin of inventory.plugins) {
    if (!SAFE_SLUG.test(plugin.slug) || !SAFE_VERSION.test(plugin.version)) {
      findings.push(
        unavailableFinding(
          "plugin",
          "invalid-slug",
          plugin.version,
          "Installed plugin has an unsafe slug; no command was constructed from it.",
          "local plugin inventory",
        ),
      );
      continue;
    }
    const desired = manifestEntry(manifest, "plugin", plugin.slug);
    const recorded = recordedSource(inventory, "plugin", plugin.slug);
    if (
      desired?.source.type !== undefined &&
      desired.source.type !== "wordpress.org"
    ) {
      const provenance = sourceDescription(desired.source);
      const matches =
        plugin.version === desired.version &&
        recorded &&
        sourcesEqual(recorded.source, desired.source);
      findings.push(
        unavailableFinding(
          "plugin",
          plugin.slug,
          plugin.version,
          matches
            ? "Official checksums are unsupported for this custom source; matching manifest provenance is recorded, but an artifact hash cannot attest extracted files."
            : "Official checksums are unsupported for this custom source, and installed provenance does not match the manifest.",
          provenance,
          {
            expected: `version ${desired.version}; ${provenance}`,
            actual: matches
              ? "matching recorded install provenance"
              : `version ${plugin.version}; ${recorded ? sourceDescription(recorded.source) : "no recorded install provenance"}`,
          },
        ),
      );
      continue;
    }
    if (
      desired?.source.type === "wordpress.org" &&
      recorded?.source.type !== undefined &&
      recorded.source.type !== "wordpress.org"
    ) {
      findings.push({
        severity: "warning",
        componentType: "plugin",
        package: plugin.slug,
        version: plugin.version,
        reason:
          "Recorded installed source conflicts with the manifest's WordPress.org source.",
        expected: "WordPress.org source",
        actual: sourceDescription(recorded.source),
        reference: "packages.json and recorded install provenance",
        remediation:
          "Reinstall the exact manifest version from WordPress.org and re-run the audit.",
      });
    }
    const reference = referenceFor("plugin", plugin.slug, plugin.version);
    const result = await runChecksum(transport, [
      "plugin",
      "verify-checksums",
      plugin.slug,
      `--version=${plugin.version}`,
      "--strict",
      "--format=json",
    ]);
    if (!result.unavailable)
      pluginReferences.push({ slug: plugin.slug, version: plugin.version });
    for (const item of result.findings) {
      pending.push({
        componentType: "plugin",
        package: plugin.slug,
        version: plugin.version,
        path: `wp-content/plugins/${plugin.slug}/${item.path}`,
        kind: item.kind,
        reference,
      });
    }
    if (result.unavailable) {
      findings.push(
        unavailableFinding(
          "plugin",
          plugin.slug,
          plugin.version,
          result.unavailable.reason,
          reference,
        ),
      );
      if (!desired) {
        findings.push({
          severity: "warning",
          componentType: "plugin",
          package: plugin.slug,
          version: plugin.version,
          reason:
            "Plugin source is unknown: it is not declared by a manifest and WordPress.org did not provide checksums.",
          expected: "declared or detectable trusted source",
          actual: "unknown source",
          reference: "site inventory and WordPress.org checksum lookup",
          remediation:
            "Identify and review the package source, then declare its exact provenance in packages.json.",
        });
      }
    }
  }

  for (const theme of inventory.themes) {
    const desired = manifestEntry(manifest, "theme", theme.slug);
    const recorded = recordedSource(inventory, "theme", theme.slug);
    const source = desired?.source;
    const provenance = source ? sourceDescription(source) : undefined;
    const provenanceMatches =
      source !== undefined &&
      theme.version === desired?.version &&
      recorded !== undefined &&
      sourcesEqual(recorded.source, source);
    findings.push(
      unavailableFinding(
        "theme",
        SAFE_SLUG.test(theme.slug) ? theme.slug : "invalid-slug",
        theme.version,
        source && source.type !== "wordpress.org"
          ? provenanceMatches
            ? "Official theme checksums are unsupported; matching manifest provenance is recorded, but an artifact hash cannot attest extracted files."
            : "Official theme checksums are unsupported for this custom source, and installed provenance does not match the manifest."
          : "Official theme checksums are not published by the supported WP-CLI checksum tooling.",
        provenance ?? `WordPress.org theme ${theme.slug} ${theme.version}`,
        source && source.type !== "wordpress.org"
          ? {
              expected: `version ${desired?.version}; ${provenance}`,
              actual: provenanceMatches
                ? "matching recorded install provenance"
                : `version ${theme.version}; ${recorded ? sourceDescription(recorded.source) : "no recorded install provenance"}`,
            }
          : undefined,
      ),
    );
    if (!desired) {
      findings.push({
        severity: "warning",
        componentType: "theme",
        package: SAFE_SLUG.test(theme.slug) ? theme.slug : "invalid-slug",
        version: theme.version,
        reason:
          "Theme source is unknown because no manifest entry declares its provenance.",
        expected: "declared trusted source",
        actual: "unknown source",
        reference: "site inventory",
        remediation:
          "Identify and review the theme source, then declare its exact provenance in packages.json.",
      });
    }
  }

  for (const special of [...inventory.muPlugins, ...inventory.dropIns]) {
    findings.push({
      severity: "warning",
      componentType: "plugin",
      package: special.slug,
      version: special.version ?? undefined,
      reason:
        "Must-use plugin or drop-in source is unknown and has no supported official checksum reference.",
      expected: "independently reviewed provenance and file checksums",
      actual: "unknown source",
      reference: "WordPress special-package inventory",
      remediation:
        "Review this special package against its deployment source and maintain trusted checksums outside the site.",
    });
  }

  const requestedHashes = pending
    .filter((item) => item.kind !== "missing")
    .map((item) => item.path)
    .sort();
  const scanResult = await transport.exec(["eval", HASH_AND_UPLOADS_SCRIPT], {
    stdin: JSON.stringify({
      paths: requestedHashes,
      plugins: pluginReferences,
    }),
  });
  if (scanResult.exitCode !== 0) {
    const detail = redactWpCliSecrets(
      scanResult.stderr.trim() || scanResult.stdout.trim(),
    );
    throw new DepsOperationalError(
      detail
        ? `Audit evidence scan failed: ${detail}`
        : "Audit evidence scan failed.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(scanResult.stdout.trim());
  } catch {
    throw new DepsOperationalError(
      "WP-CLI returned invalid audit evidence JSON.",
    );
  }
  const scan = hashOutputSchema.safeParse(decoded);
  if (!scan.success)
    throw new DepsOperationalError(
      "WP-CLI returned an invalid audit evidence shape.",
    );
  const allowedPluginReferences = new Set(
    pluginReferences.map((item) => `${item.slug}:${item.version}`),
  );
  for (const [path] of Object.entries(scan.data.expected)) {
    const safePath = safeRelativePath(path);
    if (
      !pluginReferences.some((item) =>
        safePath.startsWith(`wp-content/plugins/${item.slug}/`),
      )
    )
      throw new DepsOperationalError(
        "WP-CLI returned checksum evidence outside the requested packages.",
      );
  }
  const pendingKeys = new Set(
    pending.map((item) => `${item.kind}:${item.package}:${item.path}`),
  );
  for (const missing of scan.data.pluginMissing) {
    const path = safeRelativePath(missing.path);
    if (
      !allowedPluginReferences.has(`${missing.slug}:${missing.version}`) ||
      !path.startsWith(`wp-content/plugins/${missing.slug}/`)
    )
      throw new DepsOperationalError(
        "WP-CLI returned a missing-file finding outside the requested packages.",
      );
    const key = `missing:${missing.slug}:${path}`;
    if (pendingKeys.has(key)) continue;
    pending.push({
      componentType: "plugin",
      package: missing.slug,
      version: missing.version,
      path,
      kind: "missing",
      reference: referenceFor("plugin", missing.slug, missing.version),
    });
  }
  for (const item of pending)
    findings.push(
      checksumFinding(
        item,
        scan.data.hashes[item.path],
        scan.data.expected[item.path],
      ),
    );
  for (const executable of scan.data.uploads) {
    findings.push({
      severity: "critical",
      componentType: "uploads",
      reason:
        "unexpected executable file exists beneath the WordPress uploads directory",
      path: safeRelativePath(executable.path),
      expected: "no executable files beneath uploads",
      actual: `SHA-256 ${executable.sha256}`,
      reference: "WordPress uploads executable-file policy",
      remediation:
        "Preserve forensic evidence, quarantine the file without executing it, and investigate the compromise path.",
    });
  }
  if (
    scan.data.uploadsStatus === "outside-root" ||
    scan.data.uploadsStatus === "unavailable"
  ) {
    findings.push({
      severity: "warning",
      componentType: "uploads",
      reason:
        scan.data.uploadsStatus === "outside-root"
          ? "Configured uploads directory is outside the WordPress root and was not traversed by the audit safety policy."
          : "Configured uploads directory exists but its canonical path was unavailable, so it was not scanned.",
      expected: "complete read-only uploads executable scan",
      actual: "uploads scan unavailable",
      reference: "WordPress uploads configuration",
      remediation:
        "Review the uploads location and permissions, then inspect that directory with an approved read-only host-level process.",
    });
  }
  return sortFindings(findings);
}

export function auditReport(
  site: string,
  findings: DependencyAuditFinding[],
  threshold: DependencyAuditSeverity,
): DependencyAuditReport {
  return {
    schemaVersion: 1,
    command: "deps audit",
    site,
    status: findings.length === 0 ? "clean" : "findings",
    threshold,
    findings: sortFindings([...findings]),
  };
}
