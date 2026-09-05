import { basename } from "node:path";
import { Command } from "commander";
import {
  DeployError,
  type DeployPlan,
  DeploySshClient,
  type GateEvidence,
  assertSourceUnchanged,
  createUploadArchive,
  inspectDeploySource,
  releaseNameFor,
  remotePayload,
  validateGateEvidence,
} from "../services/deploy.js";
import { redactWpCliSecrets } from "../services/wp-cli-transport.js";
import type { DeployConfig } from "../types/config.js";
import { getSiteConfig } from "../utils/config-store.js";

interface SourceOptions {
  source: string;
  site: string;
  release?: string;
  depsCheck?: string;
  depsAudit?: string;
  tests?: string;
  json?: boolean;
}

interface UploadOptions extends SourceOptions {
  dryRun?: boolean;
}

function errorMessage(error: unknown): string {
  return redactWpCliSecrets(
    error instanceof Error ? error.message : String(error),
  );
}

function reportError(command: string, error: unknown, json?: boolean): void {
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

async function deployTarget(siteName: string): Promise<{
  site: string;
  deploy: DeployConfig;
  client: DeploySshClient;
}> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(siteName))
    throw new DeployError("--site <name> is required and must be explicit.");
  const site = await getSiteConfig(siteName);
  if (!site.config.deploy)
    throw new DeployError(`Site '${siteName}' has no deploy configuration.`);
  if (!site.config.wpCli || site.config.wpCli.type !== "ssh") {
    throw new DeployError(
      `Site '${siteName}' requires an SSH wpCli transport for deploy.`,
    );
  }
  if (site.config.wpCli.path !== site.config.deploy.wordpressPath) {
    throw new DeployError(
      "wpCli.path must exactly match deploy.wordpressPath.",
    );
  }
  return {
    site: site.name,
    deploy: site.config.deploy,
    client: new DeploySshClient(site.config.wpCli),
  };
}

async function gateEvidence(options: SourceOptions): Promise<GateEvidence[]> {
  const requested: Array<[GateEvidence["kind"], string | undefined]> = [
    ["deps-check", options.depsCheck],
    ["deps-audit", options.depsAudit],
    ["tests", options.tests],
  ];
  const gates: GateEvidence[] = [];
  for (const [kind, path] of requested) {
    if (path) gates.push(await validateGateEvidence(kind, path));
  }
  return gates;
}

async function createPlan(options: SourceOptions) {
  if (!options.source) throw new DeployError("--source <path> is required.");
  const target = await deployTarget(options.site);
  const inspection = await inspectDeploySource(options.source);
  const release = releaseNameFor(inspection.manifestSha256, options.release);
  const gates = await gateEvidence(options);
  const requiredBytes =
    inspection.totalBytes +
    Buffer.byteLength(JSON.stringify(inspection.manifest)) +
    16 * 1024 * 1024;
  const preflight = await target.client.preflight(
    target.deploy,
    release,
    requiredBytes,
  );
  if (
    typeof preflight.availableBytes !== "number" ||
    preflight.availableBytes < requiredBytes
  ) {
    throw new DeployError(
      "Remote preflight returned invalid available-space evidence.",
    );
  }
  const destination = `${target.deploy.releasesPath}/${release}`;
  const plan: DeployPlan = {
    schemaVersion: 1,
    command: "deploy plan",
    site: target.site,
    release,
    source: inspection.sourcePath,
    destination,
    livePath: target.deploy.wordpressPath,
    manifestSha256: inspection.manifestSha256,
    fileCount: inspection.manifest.files.length,
    totalBytes: inspection.totalBytes,
    availableBytes: preflight.availableBytes,
    files: inspection.manifest.files,
    exclusions: inspection.exclusions,
    gates,
    actions: [
      `upload to a unique temporary directory below ${target.deploy.releasesPath}`,
      "verify every remote file size, mode, and SHA-256 digest",
      `atomically rename the verified temporary directory to ${destination}`,
      `leave live WordPress path ${target.deploy.wordpressPath} unchanged`,
    ],
    mutation: "none",
  };
  return { target, inspection, release, gates, plan };
}

function printPlan(plan: DeployPlan): void {
  console.log(`Deploy plan for '${plan.site}'`);
  console.log(`Source: ${plan.source}`);
  console.log(`Release: ${plan.destination}`);
  console.log(`Live path (untouched): ${plan.livePath}`);
  console.log(`Manifest: ${plan.manifestSha256}`);
  console.log(
    `Files: ${plan.fileCount}; bytes: ${plan.totalBytes}; remote free: ${plan.availableBytes}`,
  );
  console.log(
    `Excluded: ${plan.exclusions.length ? plan.exclusions.join(", ") : "none"}`,
  );
  for (const action of plan.actions) console.log(`  - ${action}`);
  console.log("PLAN ONLY: no local or remote changes were made.");
}

function addSourceOptions(command: Command): Command {
  return command
    .requiredOption("--source <path>", "Local WordPress root")
    .requiredOption("--site <name>", "Explicit configured SSH destination")
    .option(
      "--release <name>",
      "Unique release name (defaults to manifest digest)",
    )
    .option(
      "--deps-check <path>",
      "Require successful recorded deps check JSON",
    )
    .option("--deps-audit <path>", "Require clean recorded deps audit JSON")
    .option("--tests <path>", "Require successful recorded project test JSON")
    .option("--json", "Print stable machine-readable JSON");
}

export const deployCommand = new Command("deploy").description(
  "Plan and stage verified WordPress releases without publishing",
);

addSourceOptions(
  deployCommand
    .command("plan")
    .description("Read-only local and remote deploy preflight"),
).action(async (options: SourceOptions) => {
  try {
    const { plan } = await createPlan(options);
    if (options.json) console.log(JSON.stringify(plan, null, 2));
    else printPlan(plan);
    process.exitCode = 0;
  } catch (error) {
    reportError("deploy plan", error, options.json);
    process.exitCode = 2;
  }
});

addSourceOptions(
  deployCommand
    .command("upload")
    .description(
      "Upload and verify a new release without changing the live site",
    )
    .option("--dry-run", "Run the complete read-only plan only"),
).action(async (options: UploadOptions) => {
  let archive: Awaited<ReturnType<typeof createUploadArchive>> | undefined;
  try {
    const prepared = await createPlan(options);
    if (options.dryRun) {
      const output = {
        ...prepared.plan,
        command: "deploy upload",
        dryRun: true,
      };
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else {
        printPlan(prepared.plan);
        console.log("DRY RUN: no upload was performed.");
      }
      process.exitCode = 0;
      return;
    }
    const payload = remotePayload(
      prepared.target.site,
      prepared.target.deploy,
      prepared.release,
      prepared.inspection,
      prepared.gates,
    );
    await assertSourceUnchanged(prepared.inspection);
    archive = await createUploadArchive(prepared.inspection, payload);
    await assertSourceUnchanged(prepared.inspection);
    await prepared.target.client.preflight(
      prepared.target.deploy,
      prepared.release,
      payload.requiredBytes,
    );
    const result = await prepared.target.client.upload(archive.path);
    const output = {
      schemaVersion: 1,
      command: "deploy upload",
      site: prepared.target.site,
      status: "verified",
      release: prepared.release,
      destination: prepared.plan.destination,
      manifestSha256: prepared.inspection.manifestSha256,
      livePath: prepared.target.deploy.wordpressPath,
      liveChanged: false,
      published: false,
    };
    if (
      result.manifestSha256 !== output.manifestSha256 ||
      result.release !== output.release
    ) {
      throw new DeployError(
        "Remote completion evidence does not match the requested release.",
      );
    }
    if (options.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(
        `Verified release '${output.release}' at ${output.destination}.`,
      );
      console.log(`Live path ${output.livePath} was not changed.`);
      console.log("UPLOAD ONLY: this release has not been published.");
    }
    process.exitCode = 0;
  } catch (error) {
    reportError("deploy upload", error, options.json);
    process.exitCode = 2;
  } finally {
    await archive?.cleanup();
  }
});

deployCommand
  .command("status")
  .description(
    "Re-verify staged releases and detect published release metadata",
  )
  .requiredOption("--site <name>", "Explicit configured SSH destination")
  .option("--json", "Print stable machine-readable JSON")
  .action(async (options: { site: string; json?: boolean }) => {
    try {
      const target = await deployTarget(options.site);
      const status = await target.client.status(target.deploy);
      const output = {
        schemaVersion: 1,
        command: "deploy status",
        site: target.site,
        ...status,
      };
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`Site: ${target.site}`);
        console.log(`Live path: ${status.livePath}`);
        console.log(
          `Current release: ${status.currentRelease ?? "not detectable"}`,
        );
        if (status.releases.length === 0) console.log("Releases: none");
        for (const release of status.releases) {
          console.log(
            `  ${basename(release.name)} [${release.state}]${release.manifestSha256 ? ` ${release.manifestSha256}` : ""}${release.reason ? ` - ${release.reason}` : ""}`,
          );
        }
      }
      process.exitCode = 0;
    } catch (error) {
      reportError("deploy status", error, options.json);
      process.exitCode = 2;
    }
  });
