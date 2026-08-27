import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeManifestUpdate } from "../../src/commands/deps.js";
import { auditDependencies } from "../../src/services/dependency-audit.js";
import { resolveUpdates } from "../../src/services/dependency-updates.js";
import {
  collectInventory,
  compareDependencies,
  executeInstallPlan,
  planInstall,
} from "../../src/services/deps-manager.js";
import { ComposeWpCliTransport } from "../../src/services/wp-cli-transport.js";
import { PackagesManifestSchema } from "../../src/types/deps.js";
import { setupTestEnvironment } from "./setup.js";

const slug = "hello-dolly";
const exactVersion = "1.7.2";
const transport = new ComposeWpCliTransport(
  {
    type: "compose",
    composeFile: "docker-compose.yml",
    projectName: "elementor-cli-test",
    service: "wordpress",
    mode: "exec",
    runtime: "docker",
  },
  import.meta.dir,
);

async function desired(active: boolean, version = exactVersion) {
  const observed = await collectInventory(transport, "test");
  return PackagesManifestSchema.parse({
    schemaVersion: 1,
    core: observed.core,
    plugins: [
      {
        slug,
        version,
        active,
        source: { type: "wordpress.org" },
      },
    ],
    themes: [],
  });
}

describe("E2E: dependency reconciliation", () => {
  beforeAll(async () => {
    await setupTestEnvironment();
    await transport.exec(["plugin", "deactivate", slug]);
    await transport.exec(["plugin", "delete", slug]);
  }, 180000);

  afterAll(async () => {
    await transport.exec(["plugin", "deactivate", slug]);
    await transport.exec(["plugin", "delete", slug]);
  });

  test("reports a missing package", async () => {
    const manifest = await desired(false);
    const observed = await collectInventory(transport, "test");
    expect(compareDependencies(manifest, observed)).toContainEqual({
      kind: "plugin",
      package: slug,
      field: "presence",
      expected: "installed",
      actual: "missing",
    });
  });

  test("performs a clean exact-version install", async () => {
    const manifest = await desired(false);
    const before = await collectInventory(transport, "test");
    await executeInstallPlan(
      transport,
      manifest,
      planInstall(manifest, before),
    );
    const after = await collectInventory(transport, "test");

    expect(compareDependencies(manifest, after)).toEqual([]);
    expect(after.plugins.find((plugin) => plugin.slug === slug)?.version).toBe(
      exactVersion,
    );
  }, 120000);

  test("explains exact version drift", async () => {
    const wrongVersion = await desired(false, "1.7.1");
    const observed = await collectInventory(transport, "test");
    expect(compareDependencies(wrongVersion, observed)).toContainEqual({
      kind: "plugin",
      package: slug,
      field: "version",
      expected: "1.7.1",
      actual: exactVersion,
    });
  });

  test("detects and reconciles activation drift", async () => {
    const manifest = await desired(true);
    const before = await collectInventory(transport, "test");
    expect(compareDependencies(manifest, before)).toContainEqual({
      kind: "plugin",
      package: slug,
      field: "active",
      expected: true,
      actual: false,
    });

    await executeInstallPlan(
      transport,
      manifest,
      planInstall(manifest, before),
    );
    expect(
      compareDependencies(manifest, await collectInventory(transport, "test")),
    ).toEqual([]);
  });

  test("an idempotent rerun produces an empty plan", async () => {
    const manifest = await desired(true);
    const observed = await collectInventory(transport, "test");
    expect(planInstall(manifest, observed)).toEqual([]);
  });

  test("manifest update does not mutate WordPress until deps install", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deps-e2e-update-"));
    const path = join(directory, "packages.json");
    try {
      const oldManifest = await desired(false, "1.7.1");
      await executeInstallPlan(
        transport,
        oldManifest,
        planInstall(oldManifest, await collectInventory(transport, "test")),
      );
      expect(
        (await collectInventory(transport, "test")).plugins.find(
          (plugin) => plugin.slug === slug,
        )?.version,
      ).toBe("1.7.1");

      await writeFile(path, `${JSON.stringify(oldManifest, null, 2)}\n`);
      const reports = await resolveUpdates(oldManifest, {
        categories: ["plugin"],
        packageSlug: slug,
        policyOverride: "patch",
        provider: {
          async core() {
            return [];
          },
          async package() {
            return ["1.7.1", exactVersion];
          },
        },
      });
      expect(
        await executeManifestUpdate(path, oldManifest, reports, {
          explicitIntent: true,
          interactive: false,
        }),
      ).toBe("written");

      const afterUpdate = await collectInventory(transport, "test");
      expect(
        afterUpdate.plugins.find((plugin) => plugin.slug === slug)?.version,
      ).toBe("1.7.1");

      const updatedManifest = PackagesManifestSchema.parse(
        JSON.parse(await Bun.file(path).text()),
      );
      await executeInstallPlan(
        transport,
        updatedManifest,
        planInstall(updatedManifest, afterUpdate),
      );
      expect(
        (await collectInventory(transport, "test")).plugins.find(
          (plugin) => plugin.slug === slug,
        )?.version,
      ).toBe(exactVersion);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120000);

  test("audits modified, missing, added, unknown, unavailable, and uploads fixtures", async () => {
    expect(
      (
        await transport.exec([
          "plugin",
          "install",
          slug,
          `--version=${exactVersion}`,
          "--force",
        ])
      ).exitCode,
    ).toBe(0);
    const manifest = await desired(false);
    const createFixtures = String.raw`
$plugin = WP_PLUGIN_DIR . '/hello-dolly';
file_put_contents($plugin . '/hello.php', "\n// modified audit fixture\n", FILE_APPEND);
@unlink($plugin . '/readme.txt');
file_put_contents($plugin . '/unexpected.php', "<?php\n// added audit fixture\n");
$custom = WP_PLUGIN_DIR . '/audit-unknown';
wp_mkdir_p($custom);
file_put_contents($custom . '/audit-unknown.php', "<?php\n/* Plugin Name: Audit Unknown Fixture\nVersion: 1.0.0 */\n");
$upload = wp_upload_dir(null, false);
wp_mkdir_p($upload['basedir'] . '/audit-fixture');
file_put_contents($upload['basedir'] . '/audit-fixture/shell.php', "<?php\n// executable upload fixture\n");
`;
    const cleanupFixtures = String.raw`
$remove = static function($path) use (&$remove) {
  if (is_dir($path) && !is_link($path)) {
    foreach (array_diff(scandir($path), array('.', '..')) as $entry) { $remove($path . '/' . $entry); }
    @rmdir($path);
  } else { @unlink($path); }
};
$remove(WP_PLUGIN_DIR . '/audit-unknown');
$upload = wp_upload_dir(null, false);
$remove($upload['basedir'] . '/audit-fixture');
`;

    try {
      expect((await transport.exec(["eval", createFixtures])).exitCode).toBe(0);
      const findings = await auditDependencies(
        transport,
        await collectInventory(transport, "test"),
        manifest,
      );

      expect(findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            package: slug,
            path: `wp-content/plugins/${slug}/hello.php`,
            reason: expect.stringContaining("does not match"),
          }),
          expect.objectContaining({
            package: slug,
            path: `wp-content/plugins/${slug}/readme.txt`,
            reason: "official package file is missing",
          }),
          expect.objectContaining({
            package: slug,
            path: `wp-content/plugins/${slug}/unexpected.php`,
            reason: expect.stringContaining("absent from the official package"),
          }),
          expect.objectContaining({
            package: "audit-unknown",
            actual: "unknown source",
          }),
          expect.objectContaining({
            package: "audit-unknown",
            reason: expect.stringContaining("HTTP 404"),
          }),
          expect.objectContaining({
            severity: "critical",
            componentType: "uploads",
            path: expect.stringContaining("/audit-fixture/shell.php"),
          }),
        ]),
      );
    } finally {
      await transport.exec(["eval", cleanupFixtures]);
      await transport.exec([
        "plugin",
        "install",
        slug,
        `--version=${exactVersion}`,
        "--force",
      ]);
    }
  }, 180000);
});
