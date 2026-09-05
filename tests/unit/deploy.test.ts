import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEPLOY_SENTINEL,
  DeploySshClient,
  RELEASE_METADATA,
  assertSourceUnchanged,
  buildDeploySshCommand,
  createUploadArchive,
  inspectDeploySource,
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
  await mkdir(app);
  await mkdir(releases);
  await writeFile(join(app, "LIVE"), "must never change\n");
  const deploy: DeployConfig = {
    wordpressPath: app,
    releasesPath: releases,
    strategy: "directory-rename",
  };
  await writeFile(
    join(releases, DEPLOY_SENTINEL),
    JSON.stringify({
      schemaVersion: 1,
      wordpressPath: app,
      releasesPath: releases,
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
