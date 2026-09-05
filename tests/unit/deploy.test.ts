import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEPLOY_SENTINEL,
  DeploySshClient,
  PUBLISH_STEPS,
  RELEASE_METADATA,
  assertPublishTransition,
  assertSourceUnchanged,
  buildDeploySshCommand,
  createUploadArchive,
  inspectDeploySource,
  inspectSanitizedDatabase,
  releaseNameFor,
  remotePayload,
  validateGateEvidence,
} from "../../src/services/deploy.js";
import type { ProcessRunner } from "../../src/services/wp-cli-transport.js";
import { runWpCliProcess } from "../../src/services/wp-cli-transport.js";
import type { DeployConfig } from "../../src/types/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function wordpressFixture(): Promise<string> {
  const root = await temporaryDirectory("elementor-cli-deploy-source-");
  await Promise.all([
    mkdir(join(root, "wp-admin")),
    mkdir(join(root, "wp-includes")),
    mkdir(join(root, "wp-content", "uploads"), { recursive: true }),
    mkdir(join(root, ".git")),
  ]);
  await writeFile(
    join(root, "index.php"),
    "<?php require 'wp-blog-header.php';\n",
  );
  await writeFile(join(root, "wp-admin", "admin.php"), "<?php // clean\n");
  await writeFile(
    join(root, "wp-includes", "version.php"),
    "<?php $wp_version='7.1';\n",
  );
  await writeFile(
    join(root, "wp-content", "uploads", "photo.jpg"),
    "jpeg-data",
  );
  await writeFile(join(root, ".DS_Store"), "ignored");
  await writeFile(
    join(root, ".git", "config"),
    "secret-ish repository metadata",
  );
  await chmod(join(root, "index.php"), 0o640);
  return root;
}

async function remoteFixture(): Promise<{
  root: string;
  deploy: DeployConfig;
  client: DeploySshClient;
}> {
  const root = await temporaryDirectory("elementor-cli-deploy-remote-");
  const app = join(root, "app");
  const releases = join(root, "releases");
  const backups = join(root, "backups");
  const configSource = join(root, "protected-wp-config.php");
  const maintenancePath = join(root, "maintenance.html");
  const wpCliPath = join(root, "wp");
  await Promise.all([
    mkdir(join(app, "wp-admin"), { recursive: true }),
    mkdir(join(app, "wp-includes"), { recursive: true }),
    mkdir(join(app, "wp-content"), { recursive: true }),
    mkdir(releases),
    mkdir(backups, { mode: 0o700 }),
  ]);
  await writeFile(join(app, "index.php"), "<?php // live\n");
  await writeFile(join(app, "LIVE"), "must never change\n");
  await writeFile(configSource, "<?php // protected config\n", { mode: 0o600 });
  await writeFile(
    wpCliPath,
    `#!/bin/sh
set -eu
case " $* " in
  *" db size "*) printf '%s\n' 1024 ;;
  *" db export "*)
    for arg in "$@"; do case "$arg" in *.sql) printf '%s\n' 'CREATE TABLE backup;' > "$arg";; esac; done ;;
  *" db import "*) exit "\${ELEMENTOR_CLI_TEST_DB_IMPORT_EXIT:-0}" ;;
  *" verify-checksums "*) exit "\${ELEMENTOR_CLI_TEST_CHECK_EXIT:-0}" ;;
esac
`,
    { mode: 0o700 },
  );
  const deploy: DeployConfig = {
    wordpressPath: app,
    releasesPath: releases,
    backupsPath: backups,
    configSourcePath: configSource,
    maintenancePath,
    wpCliPath,
    smokeUrls: ["https://example.com/"],
    strategy: "directory-rename",
  };
  await writeFile(
    join(releases, DEPLOY_SENTINEL),
    JSON.stringify({
      schemaVersion: 2,
      wordpressPath: app,
      releasesPath: releases,
      backupsPath: backups,
      configSourcePath: configSource,
      maintenancePath,
      wpCliPath,
    }),
  );
  const localRemoteRunner: ProcessRunner = (command, stdin) =>
    runWpCliProcess(
      { executable: "sh", args: ["-c", command.args.at(-1) ?? "exit 1"] },
      stdin,
    );
  return {
    root,
    deploy,
    client: new DeploySshClient(
      { type: "ssh", host: "deploy@example.test", path: app },
      localRemoteRunner,
    ),
  };
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function stageRelease(
  remote: Awaited<ReturnType<typeof remoteFixture>>,
  gates: GateEvidence[] = [
    { kind: "deps-check", sha256: "1".repeat(64) },
    { kind: "deps-audit", sha256: "2".repeat(64) },
  ],
): Promise<{ release: string; manifestSha256: string }> {
  const source = await wordpressFixture();
  const inspection = await inspectDeploySource(source);
  const release = releaseNameFor(inspection.manifestSha256);
  const payload = remotePayload(
    "production",
    remote.deploy,
    release,
    inspection,
    gates,
  );
  const archive = await createUploadArchive(inspection, payload);
  try {
    await remote.client.upload(archive.path);
  } finally {
    await archive.cleanup();
  }
  return { release, manifestSha256: inspection.manifestSha256 };
}

describe("publish state machine and sanitized database input", () => {
  test("accepts only the explicit ordered state machine", () => {
    const completed: (typeof PUBLISH_STEPS)[number][] = [];
    for (const step of PUBLISH_STEPS.filter(
      (candidate) => candidate !== "database-imported",
    )) {
      expect(() =>
        assertPublishTransition(completed, step, false),
      ).not.toThrow();
      completed.push(step);
    }
    expect(() =>
      assertPublishTransition(["preflight"], "files-backed-up", false),
    ).toThrow("Invalid publish state transition");
    expect(() =>
      assertPublishTransition(
        ["preflight", "preflight"],
        "maintenance-enabled",
        false,
      ),
    ).toThrow("Invalid publish state transition");
  });

  test("requires a canonical, non-symlink, uncompressed SQL file", async () => {
    const directory = await temporaryDirectory("elementor-cli-sanitized-db-");
    const database = join(directory, "sanitized.sql");
    await writeFile(database, "CREATE TABLE safe;\n");
    expect(await inspectSanitizedDatabase(database)).toEqual({
      path: database,
      size: 19,
      sha256: digest(await readFile(database)),
    });
    await symlink(database, join(directory, "linked.sql"));
    await expect(
      inspectSanitizedDatabase(join(directory, "linked.sql")),
    ).rejects.toThrow("canonical, non-symlink");
    await expect(
      inspectSanitizedDatabase(join(directory, "dump.sql.gz")),
    ).rejects.toThrow("uncompressed .sql");
  });

  test("accepts and reports every ordered mutation failure prefix", async () => {
    const deploy: DeployConfig = {
      wordpressPath: "/srv/app",
      releasesPath: "/srv/releases",
      backupsPath: "/srv/backups",
      configSourcePath: "/srv/protected/wp-config.php",
      maintenancePath: "/srv/maintenance/enabled",
      wpCliPath: "/usr/local/bin/wp",
      smokeUrls: ["https://example.com/"],
      strategy: "directory-rename",
    };
    const expected = PUBLISH_STEPS.filter(
      (step) => step !== "database-imported",
    );
    for (let failedIndex = 1; failedIndex < expected.length; failedIndex++) {
      const client = new DeploySshClient(
        { type: "ssh", host: "deploy@example.com", path: "/srv/app" },
        async () => ({
          stdout: JSON.stringify({
            ok: true,
            publicationId: "pub-state-test",
            release: "release-test",
            status: "failed",
            completedSteps: expected.slice(0, failedIndex),
            failedStep: expected[failedIndex],
            maintenanceActive:
              failedIndex > 1 &&
              expected[failedIndex] !== "maintenance-disabled" &&
              expected[failedIndex] !== "completed",
            livePath: "/srv/app",
            currentRelease: null,
          }),
          stderr: "ignored secret output",
          exitCode: 0,
        }),
      );
      const result = await client.publish(deploy, {});
      expect(result.status).toBe("failed");
      expect(result.failedStep).toBe(expected[failedIndex]);
      expect(result.completedSteps).toEqual(expected.slice(0, failedIndex));
    }
  });
});

describe("deploy source inspection", () => {
  test("creates a deterministic sorted size/mode/SHA-256 manifest and records exclusions", async () => {
    const root = await wordpressFixture();
    const first = await inspectDeploySource(root);
    const second = await inspectDeploySource(root);

    expect(first).toEqual(second);
    expect(first.manifest.files.map((file) => file.path)).toEqual([
      "index.php",
      "wp-admin/admin.php",
      "wp-content/uploads/photo.jpg",
      "wp-includes/version.php",
    ]);
    expect(first.exclusions).toEqual([".DS_Store", ".git/"]);
    const index = first.manifest.files[0];
    expect(index.mode).toBe(0o640);
    expect(index.sha256).toBe(digest(await readFile(join(root, "index.php"))));
  });

  test.each([
    ["wp-config.php", "secret"],
    [".env.production", "TOKEN=secret"],
    ["backup.sql.gz", "database"],
    ["debug.log", "sensitive log"],
    ["server.key", "private key"],
  ])("rejects forbidden file %s", async (name, content) => {
    const root = await wordpressFixture();
    await writeFile(join(root, name), content);
    await expect(inspectDeploySource(root)).rejects.toThrow(
      "Forbidden secret, dump, or log",
    );
  });

  test("rejects quarantine/evidence directories and PHP-like uploads by extension or content", async () => {
    const quarantine = await wordpressFixture();
    await mkdir(join(quarantine, "evidence"));
    await expect(inspectDeploySource(quarantine)).rejects.toThrow(
      "quarantine/evidence",
    );

    const extension = await wordpressFixture();
    await writeFile(
      join(extension, "wp-content", "uploads", "image.php5"),
      "not php",
    );
    await expect(inspectDeploySource(extension)).rejects.toThrow(
      "PHP-like executable",
    );

    const signature = await wordpressFixture();
    await writeFile(
      join(signature, "wp-content", "uploads", "image.jpg"),
      "GIF89a<?php echo 1;",
    );
    await expect(inspectDeploySource(signature)).rejects.toThrow(
      "PHP-like executable",
    );
  });

  test("rejects nested layouts, symlinks, traversal links, control filenames, and special files", async () => {
    const parent = await temporaryDirectory("elementor-cli-deploy-parent-");
    const nested = await wordpressFixture();
    await cp(nested, join(parent, "wordpress"), { recursive: true });
    await expect(inspectDeploySource(parent)).rejects.toThrow(
      "missing index.php",
    );

    const root = await wordpressFixture();
    await symlink("/etc/passwd", join(root, "wp-content", "outside"));
    await expect(inspectDeploySource(root)).rejects.toThrow("Symbolic links");

    const hostile = await wordpressFixture();
    await writeFile(join(hostile, "bad\nname.txt"), "bad");
    await expect(inspectDeploySource(hostile)).rejects.toThrow(
      "Unsafe source path",
    );
  });

  test("accepts hostile shell characters as inert archive names", async () => {
    const root = await wordpressFixture();
    await writeFile(join(root, "friend's $(touch NOPE).txt"), "safe");
    const inspection = await inspectDeploySource(root);
    expect(
      inspection.manifest.files.some((file) =>
        file.path.includes("$(touch NOPE)"),
      ),
    ).toBe(true);
  });

  test("aborts when the source changes after planning", async () => {
    const root = await wordpressFixture();
    const inspection = await inspectDeploySource(root);
    await writeFile(join(root, "index.php"), "changed after plan\n");
    await expect(assertSourceUnchanged(inspection)).rejects.toThrow(
      "changed after planning",
    );
  });
});

describe("deploy gates and SSH command policy", () => {
  test("accepts only successful evidence and stores only its digest", async () => {
    const directory = await temporaryDirectory("elementor-cli-deploy-gates-");
    const clean = join(directory, "audit.json");
    await writeFile(
      clean,
      JSON.stringify({
        schemaVersion: 1,
        command: "deps audit",
        status: "clean",
      }),
    );
    expect(await validateGateEvidence("deps-audit", clean)).toEqual({
      kind: "deps-audit",
      sha256: digest(await readFile(clean)),
    });
    await writeFile(
      clean,
      JSON.stringify({
        schemaVersion: 1,
        command: "deps audit",
        status: "findings",
      }),
    );
    await expect(validateGateEvidence("deps-audit", clean)).rejects.toThrow(
      "does not record success",
    );
  });

  test("pins host verification, disables password prompts, and quotes remote arguments", () => {
    const command = buildDeploySshCommand(
      { type: "ssh", host: "deploy@example.com", path: "/srv/app" },
      "preflight",
      {
        wordpressPath: "/srv/app",
        releasesPath: "/srv/releases",
        release: "safe",
      },
    );
    expect(command.executable).toBe("ssh");
    expect(command.args).toContain("StrictHostKeyChecking=yes");
    expect(command.args).toContain("BatchMode=yes");
    expect(command.args).toContain("PasswordAuthentication=no");
    expect(command.args).toContain("KbdInteractiveAuthentication=no");
    expect(command.args).toContain("--");
    expect(command.args.at(-1)).not.toContain("/srv/releases");
  });
});

describe("remote staged release protocol", () => {
  test("uploads and re-hashes a unique release while preserving the live tree byte-for-byte", async () => {
    const source = await wordpressFixture();
    const remote = await remoteFixture();
    const before = await readFile(join(remote.root, "app", "LIVE"));
    const inspection = await inspectDeploySource(source);
    const release = releaseNameFor(inspection.manifestSha256);
    const payload = remotePayload(
      "production",
      remote.deploy,
      release,
      inspection,
      [],
    );
    const archive = await createUploadArchive(inspection, payload);
    try {
      await remote.client.preflight(
        remote.deploy,
        release,
        payload.requiredBytes,
      );
      const result = await remote.client.upload(archive.path);
      expect(result.release).toBe(release);
    } finally {
      await archive.cleanup();
    }

    expect(await readFile(join(remote.root, "app", "LIVE"))).toEqual(before);
    const status = await remote.client.status(remote.deploy);
    expect(status.currentRelease).toBeNull();
    expect(status.releases).toEqual([
      {
        name: release,
        state: "verified",
        manifestSha256: inspection.manifestSha256,
      },
    ]);
    await expect(
      remote.client.preflight(remote.deploy, release, 1),
    ).rejects.toThrow("release already exists");
  });

  test("distinguishes incomplete and hash-invalid releases and never infers success from existence", async () => {
    const remote = await remoteFixture();
    await mkdir(join(remote.root, "releases", ".uploading-interrupted"));
    await mkdir(join(remote.root, "releases", "directory-only"));
    const status = await remote.client.status(remote.deploy);
    expect(status.releases.map(({ name, state }) => ({ name, state }))).toEqual(
      [
        { name: ".uploading-interrupted", state: "incomplete" },
        { name: "directory-only", state: "invalid" },
      ],
    );
  });

  test("fails closed on a missing or mismatched ownership sentinel", async () => {
    const remote = await remoteFixture();
    await writeFile(
      join(remote.root, "releases", DEPLOY_SENTINEL),
      JSON.stringify({
        schemaVersion: 1,
        wordpressPath: "/wrong",
        releasesPath: "/wrong",
      }),
    );
    await expect(
      remote.client.preflight(remote.deploy, "release-safe", 1),
    ).rejects.toThrow("sentinel does not match");
    expect(await readFile(join(remote.root, "app", "LIVE"), "utf8")).toBe(
      "must never change\n",
    );
  });

  test("rejects a group-writable sentinel", async () => {
    const remote = await remoteFixture();
    await chmod(join(remote.root, "releases", DEPLOY_SENTINEL), 0o664);
    await expect(
      remote.client.preflight(remote.deploy, "release-safe", 1),
    ).rejects.toThrow("unsafe ownership or permissions");
  });

  test("cleans only its contained temporary directory after failed verification", async () => {
    const source = await wordpressFixture();
    const remote = await remoteFixture();
    const before = await readFile(join(remote.root, "app", "LIVE"));
    const inspection = await inspectDeploySource(source);
    const release = releaseNameFor(inspection.manifestSha256);
    const payload = remotePayload(
      "production",
      remote.deploy,
      release,
      inspection,
      [],
    );
    payload.manifest.files[0].sha256 = "0".repeat(64);
    const archive = await createUploadArchive(inspection, payload);
    try {
      await expect(remote.client.upload(archive.path)).rejects.toThrow(
        "upload verification failed",
      );
    } finally {
      await archive.cleanup();
    }
    expect((await remote.client.status(remote.deploy)).releases).toEqual([]);
    expect(await readFile(join(remote.root, "app", "LIVE"))).toEqual(before);
  });

  test("marks a release invalid after post-upload tampering", async () => {
    const source = await wordpressFixture();
    const remote = await remoteFixture();
    const inspection = await inspectDeploySource(source);
    const release = releaseNameFor(inspection.manifestSha256);
    const payload = remotePayload(
      "production",
      remote.deploy,
      release,
      inspection,
      [],
    );
    const archive = await createUploadArchive(inspection, payload);
    try {
      await remote.client.upload(archive.path);
    } finally {
      await archive.cleanup();
    }
    await writeFile(
      join(remote.root, "releases", release, "index.php"),
      "tampered",
    );
    const status = await remote.client.status(remote.deploy);
    expect(status.releases[0].state).toBe("invalid");
    expect(
      await readFile(
        join(remote.root, "releases", release, RELEASE_METADATA),
        "utf8",
      ),
    ).not.toContain(source);
  });

  test("reports current and previous only from verified publication metadata", async () => {
    const source = await wordpressFixture();
    const remote = await remoteFixture();
    const inspection = await inspectDeploySource(source);
    const release = releaseNameFor(inspection.manifestSha256);
    const payload = remotePayload(
      "production",
      remote.deploy,
      release,
      inspection,
      [],
    );
    const archive = await createUploadArchive(inspection, payload);
    try {
      await remote.client.upload(archive.path);
    } finally {
      await archive.cleanup();
    }

    await rm(join(remote.root, "app"), { recursive: true });
    await cp(join(remote.root, "releases", release), join(remote.root, "app"), {
      recursive: true,
    });
    let status = await remote.client.status(remote.deploy);
    expect(status.currentRelease).toBe(release);
    expect(status.releases[0].state).toBe("current");

    await rm(join(remote.root, "app", RELEASE_METADATA));
    const metadataPath = join(
      remote.root,
      "releases",
      release,
      RELEASE_METADATA,
    );
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    metadata.publishedAt = "2026-09-05T00:00:00Z";
    await writeFile(metadataPath, JSON.stringify(metadata));
    status = await remote.client.status(remote.deploy);
    expect(status.currentRelease).toBeNull();
    expect(status.releases[0].state).toBe("previous");
  });

  test("redacts credentials returned by a failed remote helper", async () => {
    const client = new DeploySshClient(
      { type: "ssh", host: "deploy@example.com", path: "/srv/app" },
      async () => ({
        stdout: JSON.stringify({
          ok: false,
          error: "password=hunter2 token=secret",
        }),
        stderr: "",
        exitCode: 1,
      }),
    );
    await expect(
      client.preflight(
        {
          wordpressPath: "/srv/app",
          releasesPath: "/srv/releases",
          strategy: "directory-rename",
        },
        "release-safe",
        1,
      ),
    ).rejects.toThrow("password=[REDACTED] token=[REDACTED]");
  });
});

describe("remote publish and matching rollback protocol", () => {
  test("refuses a candidate without issue #67 and #69 gate evidence", async () => {
    const remote = await remoteFixture();
    const { release } = await stageRelease(remote, []);
    await expect(
      remote.client.publishPreflight(remote.deploy, {
        site: "production",
        release,
        databaseRequested: false,
        databaseSize: 0,
      }),
    ).rejects.toThrow("dependency check and audit evidence");
  });

  test("keeps publish preflight mutation-free and refuses maintenance, lock, config, and hash hazards", async () => {
    const remote = await remoteFixture();
    const { release } = await stageRelease(remote);
    const before = (await readdir(remote.root, { recursive: true })).sort();
    const plan = await remote.client.publishPreflight(remote.deploy, {
      site: "production",
      release,
      databaseRequested: false,
      databaseSize: 0,
    });
    expect(plan.release).toBe(release);
    expect((await readdir(remote.root, { recursive: true })).sort()).toEqual(
      before,
    );

    await writeFile(remote.deploy.maintenancePath as string, "active\n");
    await expect(
      remote.client.publishPreflight(remote.deploy, {
        site: "production",
        release,
        databaseRequested: false,
        databaseSize: 0,
      }),
    ).rejects.toThrow("maintenance is already active");
    await rm(remote.deploy.maintenancePath as string);

    await mkdir(
      join(remote.deploy.backupsPath as string, ".elementor-cli-publish.lock"),
    );
    await expect(
      remote.client.publishPreflight(remote.deploy, {
        site: "production",
        release,
        databaseRequested: false,
        databaseSize: 0,
      }),
    ).rejects.toThrow("holds the deployment lock");
    await rm(
      join(remote.deploy.backupsPath as string, ".elementor-cli-publish.lock"),
      { recursive: true },
    );

    await chmod(remote.deploy.configSourcePath as string, 0o644);
    await expect(
      remote.client.publishPreflight(remote.deploy, {
        site: "production",
        release,
        databaseRequested: false,
        databaseSize: 0,
      }),
    ).rejects.toThrow("protected server-side file is unsafe");
  }, 30_000);

  test("publishes, records non-secret evidence, is idempotent, and restores the matching pair", async () => {
    const remote = await remoteFixture();
    const { release } = await stageRelease(remote);
    const publicationId = "pub-unit-success";
    const result = await remote.client.publish(remote.deploy, {
      site: "production",
      release,
      publicationId,
      databaseRequested: false,
      databaseSize: 0,
    });
    expect(result.status).toBe("completed");
    expect(result.maintenanceActive).toBe(false);
    expect(result.currentRelease).toBe(release);
    expect(result.completedSteps).not.toContain("database-imported");
    expect(
      await readFile(join(remote.root, "app", "wp-config.php"), "utf8"),
    ).toBe("<?php // protected config\n");

    const recordText = await readFile(
      join(
        remote.deploy.backupsPath as string,
        publicationId,
        "publication.json",
      ),
      "utf8",
    );
    expect(recordText).not.toContain("protected config");
    expect(recordText).not.toContain("CREATE TABLE");
    const repeated = await remote.client.publish(remote.deploy, {
      site: "production",
      release,
      publicationId,
      databaseRequested: false,
      databaseSize: 0,
    });
    expect(repeated.status).toBe("completed");

    const rollbackPlan = await remote.client.rollbackPreflight(
      remote.deploy,
      publicationId,
    );
    expect(rollbackPlan.publicationId).toBe(publicationId);
    process.env.ELEMENTOR_CLI_TEST_CHECK_EXIT = "1";
    try {
      const failedRollback = await remote.client.rollback(
        remote.deploy,
        publicationId,
      );
      expect(failedRollback.status).toBe("failed");
      expect(failedRollback.failedStep).toBe("rollback-checks");
      expect(failedRollback.maintenanceActive).toBe(true);
    } finally {
      Reflect.deleteProperty(process.env, "ELEMENTOR_CLI_TEST_CHECK_EXIT");
    }
    const rolledBack = await remote.client.rollback(
      remote.deploy,
      publicationId,
    );
    expect(rolledBack.status).toBe("rolled-back");
    expect(rolledBack.maintenanceActive).toBe(false);
    expect(await readFile(join(remote.root, "app", "LIVE"), "utf8")).toBe(
      "must never change\n",
    );
    const status = await remote.client.status(remote.deploy);
    expect(status.maintenanceActive).toBe(false);
    expect(status.publications[0].status).toBe("rolled-back");
  }, 60_000);

  test("keeps maintenance active and matching rollback available after DB import failure", async () => {
    const remote = await remoteFixture();
    const { release } = await stageRelease(remote);
    const database = join(remote.root, "sanitized.sql");
    await writeFile(database, "CREATE TABLE sanitized;\n");
    const inspected = await inspectSanitizedDatabase(database);
    process.env.ELEMENTOR_CLI_TEST_DB_IMPORT_EXIT = "1";
    try {
      const failed = await remote.client.publish(
        remote.deploy,
        {
          site: "production",
          release,
          publicationId: "pub-unit-db-failure",
          databaseRequested: true,
          databaseSize: inspected.size,
          databaseSha256: inspected.sha256,
        },
        database,
      );
      expect(failed.status).toBe("failed");
      expect(failed.failedStep).toBe("import-database");
      expect(failed.maintenanceActive).toBe(true);
    } finally {
      Reflect.deleteProperty(process.env, "ELEMENTOR_CLI_TEST_DB_IMPORT_EXIT");
    }
    const plan = await remote.client.rollbackPreflight(
      remote.deploy,
      "pub-unit-db-failure",
    );
    expect(plan.maintenanceActive).toBe(true);
    const rolledBack = await remote.client.rollback(
      remote.deploy,
      "pub-unit-db-failure",
    );
    expect(rolledBack.status).toBe("rolled-back");
    expect(rolledBack.maintenanceActive).toBe(false);
  }, 60_000);

  test("records the exact smoke failure and reports the candidate as live under maintenance", async () => {
    const remote = await remoteFixture();
    const { release } = await stageRelease(remote);
    remote.deploy.smokeUrls = ["https://127.0.0.1:1/"];
    const failed = await remote.client.publish(remote.deploy, {
      site: "production",
      release,
      publicationId: "pub-unit-smoke-failure",
      databaseRequested: false,
      databaseSize: 0,
    });
    expect(failed.status).toBe("failed");
    expect(failed.failedStep).toBe("http-smoke-checks");
    expect(failed.currentRelease).toBe(release);
    expect(failed.maintenanceActive).toBe(true);
    const status = await remote.client.status(remote.deploy);
    expect(status.currentRelease).toBe(release);
    expect(status.maintenanceActive).toBe(true);
  }, 30_000);
});
