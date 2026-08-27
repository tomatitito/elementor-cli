import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeManifestUpdate } from "../../src/commands/deps.js";
import {
  type ReleaseProvider,
  applySelectedVersions,
  compareVersions,
  resolveUpdates,
  selectVersion,
  writeManifestAtomic,
} from "../../src/services/dependency-updates.js";
import {
  type PackagesManifest,
  PackagesManifestSchema,
  type SiteInventory,
} from "../../src/types/deps.js";

const official = { type: "wordpress.org" as const };
const custom = {
  type: "local-artifact" as const,
  path: "packages/custom.zip",
  sha256: "a".repeat(64),
  reviewed: true as const,
};

function manifest(): PackagesManifest {
  return PackagesManifestSchema.parse({
    schemaVersion: 1,
    core: { version: "6.9.4", locale: "de_DE", updatePolicy: "minor" },
    plugins: [
      {
        slug: "elementor",
        version: "4.2.3",
        active: true,
        source: official,
        updatePolicy: "minor",
      },
      {
        slug: "vendor",
        version: "1.0.0-beta.1",
        active: false,
        source: custom,
        updatePolicy: "major",
      },
    ],
    themes: [
      {
        slug: "hello-elementor",
        version: "3.4.0",
        active: true,
        source: official,
        updatePolicy: "patch",
      },
    ],
  });
}

const inventory: SiteInventory = {
  schemaVersion: 1,
  site: { name: "test", publicUrl: "https://example.test/" },
  collectedAt: "2026-08-27T00:00:00.000Z",
  core: { version: "6.9.3", locale: "de_DE" },
  phpVersion: "8.3",
  plugins: [
    { slug: "elementor", version: "4.2.2", activationState: "active" },
    { slug: "unmanaged", version: "9.0", activationState: "inactive" },
  ],
  themes: [
    {
      slug: "hello-elementor",
      version: "3.4.0",
      active: false,
      parent: null,
      child: false,
    },
    {
      slug: "child-theme",
      version: "1.0.0",
      active: true,
      parent: "hello-elementor",
      child: true,
    },
  ],
  muPlugins: [],
  dropIns: [],
  recordedSources: [],
  trust: "observation-only",
};

class Provider implements ReleaseProvider {
  calls: string[] = [];
  fail?: string;

  async core(locale: string): Promise<string[]> {
    this.calls.push(`core:${locale}`);
    return ["6.9.4", "6.9.7", "6.10.1", "7.0.0"];
  }

  async package(kind: "plugin" | "theme", slug: string): Promise<string[]> {
    this.calls.push(`${kind}:${slug}`);
    if (this.fail === slug) throw new Error(`resolution failed for ${slug}`);
    return kind === "plugin"
      ? ["4.2.3", "4.2.9", "4.3.0", "5.0.0-beta.1"]
      : ["3.4.0", "3.4.9", "3.5.0"];
  }
}

describe("semantic update selection", () => {
  test("orders prereleases before their stable release without changing identifiers", () => {
    expect(compareVersions("4.0.0-beta.10", "4.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("4.0.0", "4.0.0-RC1")).toBeGreaterThan(0);
    expect(selectVersion("4.0.0-beta.1", ["4.0.0-RC1", "4.0.0"], "patch")).toBe(
      "4.0.0",
    );
  });

  test("enforces exact, patch, minor, and major boundaries", () => {
    const available = ["1.2.4", "1.3.0", "2.0.0", "3.0.0-beta.1"];
    expect(selectVersion("1.2.3", available, "exact")).toBeNull();
    expect(selectVersion("1.2.3", available, "patch")).toBe("1.2.4");
    expect(selectVersion("1.2.3", available, "minor")).toBe("1.3.0");
    expect(selectVersion("1.2.3", available, "major")).toBe("2.0.0");
  });

  test("does not silently move a stable manifest onto a prerelease", () => {
    expect(selectVersion("4.2.3", ["5.0.0-beta.1"], "major")).toBeNull();
  });
});

describe("trusted deterministic resolution", () => {
  test("bulk resolution uses policies, locale, and never queries custom packages", async () => {
    const provider = new Provider();
    const reports = await resolveUpdates(manifest(), {
      categories: ["core", "theme", "plugin"],
      inventory,
      provider,
      includeUnmanaged: true,
    });

    expect(provider.calls).toEqual([
      "core:de_DE",
      "theme:hello-elementor",
      "plugin:elementor",
    ]);
    expect(
      reports.map((report) => `${report.category}:${report.package}`),
    ).toEqual([
      "core:wordpress",
      "plugin:elementor",
      "plugin:unmanaged",
      "plugin:vendor",
      "theme:child-theme",
      "theme:hello-elementor",
    ]);
    expect(
      reports.find((report) => report.package === "wordpress")?.selected,
    ).toBe("6.10.1");
    expect(
      reports.find((report) => report.package === "hello-elementor")?.selected,
    ).toBe("3.4.9");
    expect(reports.find((report) => report.package === "vendor")).toMatchObject(
      {
        status: "unknown",
        available: null,
        reason: "custom source has no trusted update metadata",
      },
    );
    expect(
      reports.find((report) => report.package === "child-theme"),
    ).toMatchObject({
      status: "skipped",
      state: "active-unmanaged-child",
    });
  });

  test("reports all successful and failed bulk resolutions", async () => {
    const provider = new Provider();
    provider.fail = "elementor";
    const reports = await resolveUpdates(manifest(), {
      categories: ["theme", "plugin"],
      provider,
    });
    expect(
      reports.find((report) => report.package === "elementor"),
    ).toMatchObject({
      status: "failed",
      selected: null,
    });
    expect(
      reports.find((report) => report.package === "hello-elementor")?.selected,
    ).toBe("3.4.9");
  });

  test("rejects unmanaged targeted packages", async () => {
    await expect(
      resolveUpdates(manifest(), {
        categories: ["plugin"],
        packageSlug: "not-managed",
        provider: new Provider(),
      }),
    ).rejects.toThrow("not managed");
  });
});

describe("manifest-only atomic update", () => {
  test("changes selected versions while preserving locale, sources, state, and other entries", () => {
    const original = manifest();
    const updated = applySelectedVersions(original, [
      {
        category: "plugin",
        package: "elementor",
        current: null,
        desired: "4.2.3",
        available: ["4.2.9"],
        selected: "4.2.9",
        policy: "minor",
        source: "wordpress.org",
        state: "not-checked",
        status: "selected",
        reason: "selected by minor policy",
      },
    ]);
    expect(updated.plugins[0].version).toBe("4.2.9");
    expect(updated.plugins[0].active).toBe(true);
    expect(updated.plugins[1]).toEqual(original.plugins[1]);
    expect(updated.core.locale).toBe("de_DE");
    expect(original.plugins[0].version).toBe("4.2.3");
  });

  test("writes a complete valid manifest atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deps-update-"));
    const path = join(directory, "packages.json");
    try {
      await writeFile(path, `${JSON.stringify(manifest())}\n`, { mode: 0o640 });
      const next = structuredClone(manifest());
      next.core.version = "6.9.7";
      await writeManifestAtomic(path, next);
      expect(
        PackagesManifestSchema.parse(JSON.parse(await readFile(path, "utf8"))),
      ).toEqual(next);
      expect((await Bun.file(path).stat()).mode & 0o777).toBe(0o640);
      expect(
        await Array.fromAsync(new Bun.Glob(".*.tmp").scan(directory)),
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("never writes on any resolution failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deps-update-failure-"));
    const path = join(directory, "packages.json");
    try {
      const text = `${JSON.stringify(manifest(), null, 2)}\n`;
      await writeFile(path, text);
      const status = await executeManifestUpdate(
        path,
        manifest(),
        [
          {
            category: "plugin",
            package: "elementor",
            current: null,
            desired: "4.2.3",
            available: null,
            selected: null,
            policy: "minor",
            source: "wordpress.org",
            state: "not-checked",
            status: "failed",
            reason: "resolution failed",
          },
        ],
        { explicitIntent: true, interactive: false },
      );
      expect(status).toBe("failed");
      expect(await readFile(path, "utf8")).toBe(text);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("non-interactive preview never prompts or writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deps-update-preview-"));
    const path = join(directory, "packages.json");
    try {
      const text = `${JSON.stringify(manifest(), null, 2)}\n`;
      await writeFile(path, text);
      let prompted = false;
      const reports = await resolveUpdates(manifest(), {
        categories: ["plugin"],
        packageSlug: "elementor",
        provider: new Provider(),
      });
      const status = await executeManifestUpdate(
        path,
        manifest(),
        reports,
        { explicitIntent: false, interactive: false },
        async () => {
          prompted = true;
          return true;
        },
      );
      expect(status).toBe("preview");
      expect(prompted).toBe(false);
      expect(await readFile(path, "utf8")).toBe(text);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("interactive refusal preserves the manifest and acceptance writes it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deps-update-prompt-"));
    const path = join(directory, "packages.json");
    try {
      const reports = await resolveUpdates(manifest(), {
        categories: ["plugin"],
        packageSlug: "elementor",
        provider: new Provider(),
      });
      await writeFile(path, `${JSON.stringify(manifest())}\n`);
      expect(
        await executeManifestUpdate(
          path,
          manifest(),
          reports,
          { explicitIntent: false, interactive: true },
          async () => false,
        ),
      ).toBe("preview");
      expect(JSON.parse(await readFile(path, "utf8")).plugins[0].version).toBe(
        "4.2.3",
      );
      expect(
        await executeManifestUpdate(
          path,
          manifest(),
          reports,
          { explicitIntent: false, interactive: true },
          async () => true,
        ),
      ).toBe("written");
      expect(JSON.parse(await readFile(path, "utf8")).plugins[0].version).toBe(
        "4.3.0",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
