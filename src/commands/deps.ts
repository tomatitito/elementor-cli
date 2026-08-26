import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Command } from "commander";
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
import type { PackagesManifest, SiteInventory } from "../types/deps.js";
import { getSiteConfig } from "../utils/config-store.js";

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
    command: "check" as const,
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
  .command("check")
  .description("Compare a site with an exact packages.json manifest")
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
        reportError("check", error, options.json);
        process.exitCode = 2;
      }
    },
  );

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
