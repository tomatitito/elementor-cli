import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Command } from "commander";
import {
  type DependencyAuditFinding,
  type DependencyAuditSeverity,
  auditDependencies,
  auditReport,
  exitCodeForAudit,
} from "../services/dependency-audit.js";
import {
  type UpdateCategory,
  type UpdateReport,
  applySelectedVersions,
  resolveUpdates,
  writeManifestAtomic,
} from "../services/dependency-updates.js";
import {
  type DependencyDrift,
  DepsOperationalError,
  type InstallAction,
  collectInventory,
  compareDependencies,
  describeAction,
  executeInstallPlan,
  planInstall,
  readPackagesManifest,
} from "../services/deps-manager.js";
import {
  type WpCliTransport,
  WpCliTransportError,
  createWpCliTransport,
  redactWpCliSecrets,
} from "../services/wp-cli-transport.js";
import type {
  PackagesManifest,
  SiteInventory,
  UpdatePolicy,
} from "../types/deps.js";
import { getSiteConfig } from "../utils/config-store.js";
import { confirmAction } from "../utils/prompts.js";

export const depsCommand = new Command("deps").description(
  "Inventory, install, and check WordPress dependencies",
);

interface CommonOptions {
  site?: string;
  json?: boolean;
}

function requireSite(options: CommonOptions): string {
  if (!options.site) {
    throw new DepsOperationalError(
      "--site <name> is required and must be explicit.",
    );
  }
  return options.site;
}

function requireManifest(path?: string): string {
  if (!path) throw new DepsOperationalError("--manifest <path> is required.");
  return path;
}

async function siteTransport(siteName: string) {
  const site = await getSiteConfig(siteName);
  if (!site.config.wpCli) {
    throw new DepsOperationalError(
      `Site '${siteName}' has no wpCli transport configured.`,
    );
  }
  return createWpCliTransport(site.config.wpCli);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactWpCliSecrets(message);
}

function reportError(command: string, error: unknown, json = false): void {
  const message = errorMessage(error);
  if (json) {
    console.error(
      JSON.stringify(
        { schemaVersion: 1, command, status: "error", error: message },
        null,
        2,
      ),
    );
  } else {
    console.error(`Error: ${message}`);
  }
}

export function inventoryOutput(inventory: SiteInventory) {
  const { recordedSources: _recordedSources, ...observation } = inventory;
  return {
    ...observation,
    warning:
      "Inventory is an observation only. Review every package and source before creating a trusted packages.json manifest.",
  };
}

export function checkOutput(
  site: string,
  drift: DependencyDrift[],
  strict: boolean,
) {
  return {
    schemaVersion: 1,
    command: "verify" as const,
    site,
    status: drift.length === 0 ? ("match" as const) : ("drift" as const),
    strict,
    drift,
  };
}

export function exitCodeForCheck(drift: DependencyDrift[]): 0 | 1 {
  return drift.length === 0 ? 0 : 1;
}

function printInventoryHuman(inventory: SiteInventory): void {
  console.log(`Site: ${inventory.site.name} (${inventory.site.publicUrl})`);
  console.log(`Collected: ${inventory.collectedAt}`);
  console.log(
    `WordPress: ${inventory.core.version} (${inventory.core.locale})`,
  );
  console.log(`PHP: ${inventory.phpVersion}`);
  console.log(`Plugins: ${inventory.plugins.length}`);
  for (const item of inventory.plugins) {
    console.log(`  ${item.slug} ${item.version} [${item.activationState}]`);
  }
  console.log(`Themes: ${inventory.themes.length}`);
  for (const item of inventory.themes) {
    const relation = item.child
      ? `child of ${item.parent}`
      : "parent/standalone";
    console.log(
      `  ${item.slug} ${item.version} [${item.active ? "active" : "inactive"}; ${relation}]`,
    );
  }
  console.log(`Must-use plugins: ${inventory.muPlugins.length}`);
  for (const item of inventory.muPlugins)
    console.log(`  ${item.slug} ${item.version ?? "unknown"}`);
  console.log(`Drop-ins: ${inventory.dropIns.length}`);
  for (const item of inventory.dropIns)
    console.log(`  ${item.slug} ${item.version ?? "unknown"}`);
  console.log(
    "WARNING: Inventory is observation only, not an allowlist or trust decision. Review every package and source.",
  );
}

function printCheckHuman(site: string, drift: DependencyDrift[]): void {
  if (drift.length === 0) {
    console.log(`Dependencies match packages.json for site '${site}'.`);
    return;
  }
  console.log(`Dependency drift for site '${site}':`);
  for (const item of drift) {
    console.log(
      `  ${item.kind} ${item.package}: ${item.field}; expected ${String(item.expected)}, actual ${String(item.actual)}`,
    );
  }
}

function auditThreshold(value?: string): DependencyAuditSeverity {
  if (
    value === "info" ||
    value === "warning" ||
    value === "high" ||
    value === "critical"
  )
    return value;
  throw new DepsOperationalError(
    "--fail-on must be one of: info, warning, high, critical.",
  );
}

function printAuditHuman(
  site: string,
  findings: DependencyAuditFinding[],
  threshold: DependencyAuditSeverity,
): void {
  console.log(`Dependency integrity audit for site '${site}'`);
  console.log(`Failure threshold: ${threshold}`);
  if (findings.length === 0) {
    console.log("No integrity findings.");
    return;
  }
  for (const finding of findings) {
    const identity = [finding.package, finding.version]
      .filter(Boolean)
      .join(" ");
    console.log(
      `[${finding.severity.toUpperCase()}] ${identity || finding.componentType}`,
    );
    console.log(`Reason: ${finding.reason}`);
    if (finding.path) console.log(`File: ${finding.path}`);
    if (finding.expected) console.log(`Expected: ${finding.expected}`);
    if (finding.actual) console.log(`Actual: ${finding.actual}`);
    if (finding.reference) console.log(`Reference: ${finding.reference}`);
    console.log(`Remediation: ${finding.remediation}`);
  }
}

interface UpdateOptions extends CommonOptions {
  manifest?: string;
  all?: boolean;
  version?: string;
  write?: boolean;
  patch?: boolean;
  minor?: boolean;
  major?: boolean;
}

function policyOption(options: UpdateOptions): UpdatePolicy | undefined {
  const policies = (["patch", "minor", "major"] as const).filter(
    (policy) => options[policy],
  );
  if (policies.length > 1) {
    throw new DepsOperationalError(
      "Choose only one of --patch, --minor, or --major.",
    );
  }
  return policies[0];
}

function printUpdateReports(reports: UpdateReport[]): void {
  for (const report of reports) {
    console.log(`${report.category} ${report.package} [${report.status}]`);
    console.log(`  Current:   ${report.current ?? "unknown"}`);
    console.log(`  Desired:   ${report.desired}`);
    console.log(`  Available: ${report.available?.join(", ") ?? "unknown"}`);
    if (report.category === "core" && report.availableByPolicy) {
      console.log(
        `  Latest patch: ${report.availableByPolicy.patch ?? "none"}`,
      );
      console.log(
        `  Latest minor: ${report.availableByPolicy.minor ?? "none"}`,
      );
      console.log(
        `  Latest major: ${report.availableByPolicy.major ?? "none"}`,
      );
    }
    console.log(`  Selected:  ${report.selected ?? "none"}`);
    console.log(`  Policy:    ${report.policy}`);
    console.log(`  Source:    ${report.source}`);
    console.log(`  State:     ${report.state}`);
    console.log(`  Reason:    ${report.reason}`);
  }
  const changes = reports.filter((report) => report.selected);
  console.log("Proposed manifest changes:");
  if (changes.length === 0) console.log("  (none)");
  for (const report of changes) {
    console.log(
      `  ${report.category}.${report.package}: ${report.desired} -> ${report.selected}`,
    );
  }
}

function updateOutput(
  command: string,
  reports: UpdateReport[],
  status: "checked" | "preview" | "written" | "failed",
) {
  return {
    schemaVersion: 1,
    command,
    status,
    mutationBoundary:
      "manifest-only; run deps install separately to mutate WordPress",
    reports,
  };
}

export async function executeManifestUpdate(
  path: string,
  manifest: PackagesManifest,
  reports: UpdateReport[],
  options: { explicitIntent: boolean; interactive: boolean },
  confirm: (message: string) => Promise<boolean> = confirmAction,
): Promise<"preview" | "written" | "failed"> {
  if (reports.some((report) => report.status === "failed")) return "failed";
  if (!reports.some((report) => report.selected)) return "preview";
  let accepted = options.explicitIntent;
  if (!accepted && options.interactive) {
    accepted = await confirm("Write all proposed versions to the manifest?");
  }
  if (!accepted) return "preview";
  await writeManifestAtomic(path, applySelectedVersions(manifest, reports));
  return "written";
}

async function inventoryForUpdate(
  site?: string,
): Promise<SiteInventory | undefined> {
  if (!site) return undefined;
  return collectInventory(await siteTransport(site), site);
}

async function runReleaseCheck(
  command: string,
  categories: UpdateCategory[],
  options: UpdateOptions,
): Promise<void> {
  try {
    const site = requireSite(options);
    const manifest = await readPackagesManifest(
      requireManifest(options.manifest),
    );
    const reports = await resolveUpdates(manifest, {
      categories,
      inventory: await inventoryForUpdate(site),
      includeUnmanaged: true,
    });
    if (options.json)
      console.log(
        JSON.stringify(updateOutput(command, reports, "checked"), null, 2),
      );
    else printUpdateReports(reports);
    process.exitCode = reports.some((report) => report.status === "failed")
      ? 2
      : 0;
  } catch (error) {
    reportError(command, error, options.json);
    process.exitCode = 2;
  }
}

async function runManifestUpdate(
  command: string,
  categories: UpdateCategory[],
  packageSlug: string | undefined,
  options: UpdateOptions,
): Promise<void> {
  try {
    const path = requireManifest(options.manifest);
    if (categories.length > 1 && !options.all) {
      throw new DepsOperationalError("Aggregate deps update requires --all.");
    }
    if (
      categories.length === 1 &&
      categories[0] !== "core" &&
      !packageSlug &&
      !options.all
    ) {
      throw new DepsOperationalError(
        "Specify a managed package slug or --all.",
      );
    }
    if (packageSlug && options.all) {
      throw new DepsOperationalError(
        "A package slug and --all cannot be combined.",
      );
    }
    if (options.version && (options.all || categories.length > 1)) {
      throw new DepsOperationalError(
        "--version requires one core or named package update.",
      );
    }
    const manifest = await readPackagesManifest(path);
    const reports = await resolveUpdates(manifest, {
      categories,
      inventory: await inventoryForUpdate(options.site),
      packageSlug,
      explicitVersion: options.version,
      policyOverride: policyOption(options),
    });
    if (!options.json) printUpdateReports(reports);
    const status = await executeManifestUpdate(path, manifest, reports, {
      explicitIntent: !!options.write || !!options.version,
      interactive:
        !options.json && !!process.stdin.isTTY && !!process.stdout.isTTY,
    });
    if (options.json)
      console.log(
        JSON.stringify(updateOutput(command, reports, status), null, 2),
      );
    else if (status === "written")
      console.log("Manifest updated atomically. WordPress was not changed.");
    else if (status === "preview")
      console.log("Preview only: manifest and WordPress were not changed.");
    process.exitCode = status === "failed" ? 2 : 0;
  } catch (error) {
    reportError(command, error, options.json);
    process.exitCode = 2;
  }
}

function addUpdateOptions(command: Command): Command {
  return command
    .option("-s, --site <name>", "Optional site for installed-version context")
    .requiredOption("-m, --manifest <path>", "Path to packages.json")
    .option("--all", "Select every managed dependency in scope")
    .option("--version <version>", "Select one exact trusted version")
    .option("--patch", "Use patch update policy for this resolution")
    .option("--minor", "Use minor update policy for this resolution")
    .option("--major", "Use major update policy for this resolution")
    .option("--write", "Explicitly accept all proposed manifest changes")
    .option("--json", "Print stable JSON");
}

function categoryCommand(
  name: "core" | "themes" | "plugins",
  category: UpdateCategory,
): Command {
  const command = new Command(name).description(
    `Check and update managed ${name}`,
  );
  command
    .command("check")
    .requiredOption("-s, --site <name>", "Explicit site name")
    .requiredOption("-m, --manifest <path>", "Path to packages.json")
    .option("--json", "Print stable JSON")
    .action((options: UpdateOptions) =>
      runReleaseCheck(`${name} check`, [category], options),
    );
  const update = addUpdateOptions(
    new Command("update").description(
      "Resolve and optionally write desired versions",
    ),
  );
  if (category !== "core") update.argument("[slug]", "Managed package slug");
  update.action(
    (
      slugOrOptions: string | UpdateOptions | undefined,
      maybeOptions?: UpdateOptions,
    ) => {
      const packageSlug =
        typeof slugOrOptions === "string" ? slugOrOptions : undefined;
      const options = (maybeOptions ?? slugOrOptions) as UpdateOptions;
      return runManifestUpdate(
        `${name} update`,
        [category],
        packageSlug,
        options,
      );
    },
  );
  command.addCommand(update);
  return command;
}

depsCommand
  .command("inventory")
  .description(
    "Observe installed WordPress packages without changing the target",
  )
  .option("-s, --site <name>", "Explicit site name (required)")
  .option("-o, --output <path>", "Write stable, secret-free JSON to a file")
  .option("--json", "Print JSON")
  .action(async (options: CommonOptions & { output?: string }) => {
    try {
      const site = requireSite(options);
      const inventory = await collectInventory(await siteTransport(site), site);
      const output = inventoryOutput(inventory);
      if (options.output) {
        await mkdir(dirname(options.output), { recursive: true });
        await Bun.write(options.output, `${JSON.stringify(output, null, 2)}\n`);
        if (!options.json)
          console.log(`Inventory written to ${options.output}`);
      }
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else if (!options.output) printInventoryHuman(inventory);
      process.exitCode = 0;
    } catch (error) {
      reportError("inventory", error, options.json);
      process.exitCode = 2;
    }
  });

depsCommand
  .command("verify")
  .description("Compare a site with exact packages.json desired state")
  .option("-s, --site <name>", "Explicit site name (required)")
  .option("-m, --manifest <path>", "Path to packages.json (required)")
  .option("--strict", "Treat unlisted regular plugins and themes as drift")
  .option("--json", "Print stable JSON")
  .action(
    async (
      options: CommonOptions & { manifest?: string; strict?: boolean },
    ) => {
      try {
        const site = requireSite(options);
        const manifest = await readPackagesManifest(
          requireManifest(options.manifest),
        );
        const inventory = await collectInventory(
          await siteTransport(site),
          site,
        );
        const drift = compareDependencies(
          manifest,
          inventory,
          !!options.strict,
        );
        if (options.json) {
          console.log(
            JSON.stringify(checkOutput(site, drift, !!options.strict), null, 2),
          );
        } else {
          printCheckHuman(site, drift);
        }
        process.exitCode = exitCodeForCheck(drift);
      } catch (error) {
        reportError("verify", error, options.json);
        process.exitCode = 2;
      }
    },
  );

depsCommand
  .command("audit")
  .description(
    "Read-only integrity audit of WordPress core, packages, and uploads",
  )
  .option("-s, --site <name>", "Explicit site name (required)")
  .option("-m, --manifest <path>", "Optional packages.json provenance")
  .option("--fail-on <severity>", "Finding threshold", "high")
  .option("-o, --output <path>", "Write stable, secret-free JSON to a file")
  .option("--json", "Print stable JSON")
  .action(
    async (
      options: CommonOptions & {
        manifest?: string;
        failOn?: string;
        output?: string;
      },
    ) => {
      try {
        const site = requireSite(options);
        const threshold = auditThreshold(options.failOn);
        const manifest = options.manifest
          ? await readPackagesManifest(options.manifest)
          : undefined;
        const transport = await siteTransport(site);
        const inventory = await collectInventory(transport, site);
        const findings = await auditDependencies(
          transport,
          inventory,
          manifest,
        );
        const report = auditReport(site, findings, threshold);
        const json = `${JSON.stringify(report, null, 2)}\n`;
        if (options.output) {
          await mkdir(dirname(options.output), { recursive: true });
          await Bun.write(options.output, json);
        }
        if (options.json) console.log(json.trimEnd());
        else {
          printAuditHuman(site, findings, threshold);
          if (options.output)
            console.log(`Audit JSON written to ${options.output}`);
        }
        process.exitCode = exitCodeForAudit(findings, threshold);
      } catch (error) {
        reportError("deps audit", error, options.json);
        process.exitCode = 2;
      }
    },
  );

depsCommand
  .command("check")
  .description("Check all managed categories for trusted releases")
  .requiredOption("-s, --site <name>", "Explicit site name")
  .requiredOption("-m, --manifest <path>", "Path to packages.json")
  .option("--json", "Print stable JSON")
  .action((options: UpdateOptions) =>
    runReleaseCheck("check", ["core", "theme", "plugin"], options),
  );

addUpdateOptions(
  depsCommand
    .command("update")
    .description("Resolve all categories and optionally update the manifest"),
).action((options: UpdateOptions) =>
  runManifestUpdate("update", ["core", "theme", "plugin"], undefined, options),
);

depsCommand.addCommand(categoryCommand("core", "core"));
depsCommand.addCommand(categoryCommand("themes", "theme"));
depsCommand.addCommand(categoryCommand("plugins", "plugin"));

depsCommand
  .command("install")
  .description(
    "Reconcile a site to exact packages.json versions and activation state",
  )
  .option("-s, --site <name>", "Explicit site name (required)")
  .option("-m, --manifest <path>", "Path to packages.json (required)")
  .option("--dry-run", "Show the plan without changing the target")
  .option("--prune", "Remove unlisted regular plugins and themes")
  .option("--json", "Print stable JSON")
  .action(
    async (
      options: CommonOptions & {
        manifest?: string;
        dryRun?: boolean;
        prune?: boolean;
      },
    ) => {
      let site: string;
      let manifest: PackagesManifest;
      let transport: WpCliTransport;
      let actions: InstallAction[];
      try {
        site = requireSite(options);
        manifest = await readPackagesManifest(
          requireManifest(options.manifest),
        );
        transport = await siteTransport(site);
        const inventory = await collectInventory(transport, site);
        actions = planInstall(manifest, inventory, !!options.prune);
      } catch (error) {
        reportError("install", error, options.json);
        process.exitCode = 2;
        return;
      }

      const plan = actions.map(describeAction);
      if (options.dryRun) {
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                schemaVersion: 1,
                command: "install",
                site,
                status: actions.length === 0 ? "match" : "dry-run-drift",
                dryRun: true,
                prune: !!options.prune,
                plan,
              },
              null,
              2,
            ),
          );
        } else {
          console.log(
            actions.length === 0 ? "No changes required." : "Install plan:",
          );
          for (const line of plan) console.log(`  ${line}`);
          console.log("Dry run: no target changes were made.");
        }
        process.exitCode = actions.length === 0 ? 0 : 1;
        return;
      }

      if (!options.json) {
        console.log(
          actions.length === 0 ? "No changes required." : "Install plan:",
        );
        for (const line of plan) console.log(`  ${line}`);
      }
      try {
        await executeInstallPlan(transport, manifest, actions);
      } catch (error) {
        reportError("install", error, options.json);
        process.exitCode = error instanceof WpCliTransportError ? 2 : 1;
        return;
      }

      let finalInventory: SiteInventory;
      try {
        finalInventory = await collectInventory(transport, site);
      } catch (error) {
        reportError("install", error, options.json);
        process.exitCode = 2;
        return;
      }
      const drift = compareDependencies(
        manifest,
        finalInventory,
        !!options.prune,
      );
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              schemaVersion: 1,
              command: "install",
              site,
              status: drift.length === 0 ? "installed" : "drift",
              dryRun: false,
              prune: !!options.prune,
              plan,
              drift,
            },
            null,
            2,
          ),
        );
      } else {
        printCheckHuman(site, drift);
      }
      process.exitCode = exitCodeForCheck(drift);
    },
  );
