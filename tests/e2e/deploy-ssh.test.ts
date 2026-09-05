import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SshWpCliConfigSchema } from "../../src/types/config.js";

const host = process.env.ELEMENTOR_CLI_DEPLOY_E2E_HOST;
const livePath = process.env.ELEMENTOR_CLI_DEPLOY_E2E_LIVE_PATH;
const releasesPath = process.env.ELEMENTOR_CLI_DEPLOY_E2E_RELEASES_PATH;
const backupsPath = process.env.ELEMENTOR_CLI_DEPLOY_E2E_BACKUPS_PATH;
const configSourcePath =
  process.env.ELEMENTOR_CLI_DEPLOY_E2E_CONFIG_SOURCE_PATH;
const maintenancePath = process.env.ELEMENTOR_CLI_DEPLOY_E2E_MAINTENANCE_PATH;
const wpCliPath = process.env.ELEMENTOR_CLI_DEPLOY_E2E_WP_CLI_PATH;
const smokeUrl = process.env.ELEMENTOR_CLI_DEPLOY_E2E_SMOKE_URL;
const enabled = !!host && !!livePath && !!releasesPath;
const publishEnabled =
  enabled &&
  !!backupsPath &&
  !!configSourcePath &&
  !!maintenancePath &&
  !!wpCliPath &&
  !!smokeUrl;

async function liveDigest(): Promise<string> {
  const validatedHost = SshWpCliConfigSchema.parse({
    type: "ssh",
    host,
    path: livePath,
  }).host;
  const script =
    "import base64,hashlib,os,sys\n" +
    "root=base64.urlsafe_b64decode(sys.argv[1]+'===').decode()\n" +
    "h=hashlib.sha256()\n" +
    "for directory,dirs,files in os.walk(root):\n" +
    " dirs.sort(); files.sort()\n" +
    " for name in files:\n" +
    "  path=os.path.join(directory,name); h.update(os.path.relpath(path,root).encode()+b'\\0')\n" +
    "  with open(path,'rb') as f:\n" +
    "   for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)\n" +
    "print(h.hexdigest())";
  const remote = [
    "python3",
    "-c",
    script,
    Buffer.from(livePath ?? "").toString("base64url"),
  ]
    .map((value) => `'${value.replace(/'/g, `'"'"'`)}'`)
    .join(" ");
  const result = Bun.spawnSync([
    "ssh",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "PasswordAuthentication=no",
    "--",
    validatedHost,
    remote,
  ]);
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().trim();
}

test.skipIf(!enabled)(
  "stages through a disposable SSH target without changing the live directory",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "elementor-cli-deploy-ssh-e2e-"),
    );
    try {
      const source = join(directory, "wordpress");
      await Promise.all([
        mkdir(join(source, "wp-admin"), { recursive: true }),
        mkdir(join(source, "wp-includes"), { recursive: true }),
        mkdir(join(source, "wp-content", "uploads"), { recursive: true }),
      ]);
      await writeFile(join(source, "index.php"), "<?php // deploy e2e\n");
      await writeFile(
        join(source, "wp-admin", "admin.php"),
        "<?php // admin\n",
      );
      await writeFile(
        join(source, "wp-includes", "version.php"),
        "<?php // version\n",
      );
      await writeFile(
        join(source, "wp-content", "uploads", "safe.txt"),
        "safe\n",
      );
      const config = join(directory, "config.yaml");
      const publishConfig = publishEnabled
        ? `      backupsPath: ${backupsPath}\n      configSourcePath: ${configSourcePath}\n      maintenancePath: ${maintenancePath}\n      wpCliPath: ${wpCliPath}\n      smokeUrls:\n        - ${smokeUrl}\n`
        : "";
      await writeFile(
        config,
        `sites:\n  disposable:\n    url: https://invalid.example\n    wpCli:\n      type: ssh\n      host: ${host}\n      path: ${livePath}\n    deploy:\n      wordpressPath: ${livePath}\n      releasesPath: ${releasesPath}\n${publishConfig}      strategy: directory-rename\n`,
      );
      const before = await liveDigest();
      const release = `e2e-${randomUUID()}`;
      const depsCheck = join(directory, "deps-check.json");
      const depsAudit = join(directory, "deps-audit.json");
      if (publishEnabled) {
        await writeFile(
          depsCheck,
          JSON.stringify({
            schemaVersion: 1,
            command: "deps check",
            status: "checked",
            reports: [],
          }),
        );
        await writeFile(
          depsAudit,
          JSON.stringify({
            schemaVersion: 1,
            command: "deps audit",
            status: "clean",
          }),
        );
      }
      const result = Bun.spawnSync(
        [
          "bun",
          "run",
          "src/index.ts",
          "deploy",
          "upload",
          "--source",
          source,
          "--site",
          "disposable",
          "--release",
          release,
          ...(publishEnabled
            ? ["--deps-check", depsCheck, "--deps-audit", depsAudit]
            : []),
          "--json",
        ],
        {
          cwd: join(import.meta.dir, "../.."),
          env: { ...process.env, ELEMENTOR_CLI_CONFIG: config },
        },
      );
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString()).published).toBe(false);
      expect(await liveDigest()).toBe(before);

      if (publishEnabled) {
        const publish = Bun.spawnSync(
          [
            "bun",
            "run",
            "src/index.ts",
            "deploy",
            "publish",
            "--site",
            "disposable",
            "--release",
            release,
            "--yes",
            "--json",
          ],
          {
            cwd: join(import.meta.dir, "../.."),
            env: { ...process.env, ELEMENTOR_CLI_CONFIG: config },
          },
        );
        expect(publish.stderr.toString()).toBe("");
        expect(publish.exitCode).toBe(0);
        const publication = JSON.parse(publish.stdout.toString());
        expect(publication.status).toBe("completed");
        expect(publication.maintenanceActive).toBe(false);
        expect(publication.currentRelease).toBe(release);

        const rollback = Bun.spawnSync(
          [
            "bun",
            "run",
            "src/index.ts",
            "deploy",
            "rollback",
            "--site",
            "disposable",
            "--publication",
            publication.publicationId,
            "--yes",
            "--json",
          ],
          {
            cwd: join(import.meta.dir, "../.."),
            env: { ...process.env, ELEMENTOR_CLI_CONFIG: config },
          },
        );
        expect(rollback.stderr.toString()).toBe("");
        expect(rollback.exitCode).toBe(0);
        expect(JSON.parse(rollback.stdout.toString()).status).toBe(
          "rolled-back",
        );
        expect(await liveDigest()).toBe(before);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
