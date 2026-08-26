import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkOutput,
  exitCodeForCheck,
  inventoryOutput,
} from "../../src/commands/deps.js";
import {
  DepsOperationalError,
  collectInventory,
  compareDependencies,
  describeAction,
  executeInstallPlan,
  planInstall,
} from "../../src/services/deps-manager.js";
import type {
  CommandResult,
  WpCliExecOptions,
  WpCliTransport,
} from "../../src/services/wp-cli-transport.js";
import {
  type PackagesManifest,
  PackagesManifestSchema,
  type SiteInventory,
} from "../../src/types/deps.js";

const official = { type: "wordpress.org" as const };

function manifest(overrides: Partial<PackagesManifest> = {}): PackagesManifest {
  return PackagesManifestSchema.parse({
    schemaVersion: 1,
    core: { version: "6.9.4", locale: "de_DE", updatePolicy: "minor" },
    plugins: [
      { slug: "elementor", version: "4.2.3", active: true, source: official },
    ],
    themes: [
      {
        slug: "hello-elementor",
        version: "3.4.9",
        active: true,
        source: official,
      },
    ],
    ...overrides,
  });
}

function inventory(overrides: Partial<SiteInventory> = {}): SiteInventory {
  return {
    schemaVersion: 1,
    site: { name: "recovery", publicUrl: "https://example.com/" },
    collectedAt: "2026-08-26T12:00:00.000Z",
    core: { version: "6.9.4", locale: "de_DE" },
    phpVersion: "8.3.0",
    plugins: [
      { slug: "elementor", version: "4.2.3", activationState: "active" },
    ],
    themes: [
      {
        slug: "hello-elementor",
        version: "3.4.9",
        active: true,
        parent: null,
        child: false,
      },
    ],
    muPlugins: [],
    dropIns: [],
    recordedSources: [],
    trust: "observation-only",
    ...overrides,
  };
}

class FakeTransport implements WpCliTransport {
  calls: Array<{ args: string[]; stdin?: string | Uint8Array }> = [];

  constructor(
    private readonly result:
      | CommandResult
      | ((args: string[]) => CommandResult),
  ) {}

  async exec(
    args: string[],
    options: WpCliExecOptions = {},
  ): Promise<CommandResult> {
    const stdin =
      typeof options.stdin === "string" || options.stdin instanceof Uint8Array
        ? options.stdin
        : undefined;
    this.calls.push({ args, stdin });
    return typeof this.result === "function" ? this.result(args) : this.result;
  }
}

describe("packages.json schema", () => {
  test("accepts exact official packages and reviewed custom source forms", () => {
    const parsed = PackagesManifestSchema.parse({
      schemaVersion: 1,
      core: { version: "6.9.4", locale: "de_DE", updatePolicy: "minor" },
      plugins: [
        { slug: "elementor", version: "4.2.3", active: true, source: official },
        {
          slug: "vendor-plugin",
          version: "1.2.0",
          active: false,
          source: {
            type: "vendor-url",
            url: "https://vendor.example/plugin.zip",
            sha256: "a".repeat(64),
            reviewed: true,
          },
        },
        {
          slug: "local-plugin",
          version: "2.0.0",
          active: false,
          source: {
            type: "local-artifact",
            path: "recovery/packages/local-plugin.zip",
            sha256: "b".repeat(64),
            reviewed: true,
          },
        },
      ],
      themes: [
        {
          slug: "reviewed-theme",
          version: "1.0.0",
          active: true,
          source: {
            type: "git",
            repository: "https://github.com/example/theme.git",
            revision: "c".repeat(40),
            artifactUrl: "https://github.com/example/theme/archive/commit.zip",
            sha256: "d".repeat(64),
            reviewed: true,
          },
        },
      ],
    });

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.plugins).toHaveLength(3);
    expect(parsed.themes[0].source.type).toBe("git");
  });

  test("rejects unknown schema versions, inexact values, duplicates, and unknown fields", () => {
    expect(() =>
      PackagesManifestSchema.parse({
        schemaVersion: 2,
        core: { version: "latest", locale: "en_US", extra: true },
        plugins: [
          { slug: "same", version: "1.0.0", active: true, source: official },
          { slug: "same", version: "1.0.1", active: false, source: official },
        ],
        themes: [],
      }),
    ).toThrow();
  });

  test("rejects unreviewed, unhashed, credential-bearing, and mutable Git sources", () => {
    const base = {
      schemaVersion: 1,
      core: { version: "6.9.4", locale: "en_US" },
      themes: [],
    };
    for (const source of [
      {
        type: "vendor-url",
        url: "https://user:secret@vendor.example/plugin.zip?token=secret",
        sha256: "a".repeat(64),
        reviewed: true,
      },
      {
        type: "vendor-url",
        url: "http://vendor.example/plugin.zip",
        sha256: "a".repeat(64),
        reviewed: true,
      },
      {
        type: "local-artifact",
        path: "/tmp/plugin.zip",
        sha256: "a".repeat(64),
        reviewed: true,
      },
      {
        type: "local-artifact",
        path: "../private/plugin.zip",
        sha256: "a".repeat(64),
        reviewed: true,
      },
      {
        type: "git",
        repository: "https://github.com/example/plugin.git",
        revision: "main",
        artifactUrl: "https://github.com/example/plugin/archive/main.zip",
        sha256: "a".repeat(64),
        reviewed: true,
      },
      {
        type: "vendor-url",
        url: "https://vendor.example/plugin.zip",
        sha256: "a".repeat(64),
        reviewed: false,
      },
    ]) {
      expect(
        PackagesManifestSchema.safeParse({
          ...base,
          plugins: [
            { slug: "custom", version: "1.0.0", active: false, source },
          ],
        }).success,
      ).toBe(false);
    }
  });

  test("rejects manifests that try to activate multiple themes", () => {
    const sourceTheme = (slug: string) => ({
      slug,
      version: "1.0.0",
      active: true,
      source: official,
    });
    expect(
      PackagesManifestSchema.safeParse({
        schemaVersion: 1,
        core: { version: "6.9.4", locale: "en_US" },
        plugins: [],
        themes: [sourceTheme("one"), sourceTheme("two")],
      }).success,
    ).toBe(false);
  });
});

describe("inventory", () => {
  test("collects, sorts, distinguishes special packages, and removes URL credentials", async () => {
    const transport = new FakeTransport({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        publicUrl: "https://user:password@example.com/?token=secret#fragment",
        core: { version: "6.9.4", locale: "en_US" },
        phpVersion: "8.3.1",
        plugins: [
          { slug: "z-plugin", version: "2.0", activationState: "inactive" },
          {
            slug: "a-plugin",
            version: "1.0",
            activationState: "network-active",
          },
        ],
        themes: [
          {
            slug: "child",
            version: "1.0",
            active: true,
            parent: "parent",
            child: true,
          },
        ],
        muPlugins: [{ slug: "loader", name: "Loader", version: null }],
        dropIns: [{ slug: "object-cache", name: "Cache", version: "1.0" }],
        recordedSources: [{ token: "must-not-escape" }],
      }),
    });

    const result = await collectInventory(
      transport,
      "production",
      new Date("2026-08-26T12:00:00Z"),
    );

    expect(result.site.publicUrl).toBe("https://example.com/");
    expect(result.plugins.map((item) => item.slug)).toEqual([
      "a-plugin",
      "z-plugin",
    ]);
    expect(result.plugins[0].activationState).toBe("network-active");
    expect(result.themes[0]).toMatchObject({ parent: "parent", child: true });
    expect(result.muPlugins[0].slug).toBe("loader");
    expect(result.dropIns[0].slug).toBe("object-cache");
    expect(result.recordedSources).toEqual([]);
    expect(transport.calls[0].args.slice(0, 1)).toEqual(["eval"]);
  });

  test("fails safely on nonzero or malformed WP-CLI output", async () => {
    await expect(
      collectInventory(
        new FakeTransport({ exitCode: 1, stdout: "", stderr: "token=secret" }),
        "production",
      ),
    ).rejects.toThrow("token=[REDACTED]");
    await expect(
      collectInventory(
        new FakeTransport({ exitCode: 0, stdout: "not-json", stderr: "" }),
        "production",
      ),
    ).rejects.toThrow("invalid inventory JSON");
  });
});

describe("comparison and planning", () => {
  test("reports every core, package, activation, source, and strict mismatch stably", () => {
    const customManifest = manifest({
      plugins: [
        {
          slug: "elementor",
          version: "4.2.3",
          active: true,
          source: {
            type: "vendor-url",
            url: "https://vendor.example/elementor.zip",
            sha256: "a".repeat(64),
            reviewed: true,
          },
        },
        { slug: "missing", version: "1.0.0", active: false, source: official },
      ],
    });
    const observed = inventory({
      core: { version: "6.8.0", locale: "en_US" },
      plugins: [
        { slug: "elementor", version: "4.1.0", activationState: "inactive" },
        { slug: "unexpected", version: "1.0.0", activationState: "active" },
      ],
      themes: [
        {
          slug: "hello-elementor",
          version: "3.4.8",
          active: false,
          parent: null,
          child: false,
        },
        {
          slug: "unexpected-theme",
          version: "1.0.0",
          active: true,
          parent: null,
          child: false,
        },
      ],
    });

    const drift = compareDependencies(customManifest, observed, true);

    expect(
      drift.map((item) => `${item.kind}:${item.package}:${item.field}`),
    ).toEqual([
      "core:wordpress:locale",
      "core:wordpress:version",
      "plugin:elementor:active",
      "plugin:elementor:source",
      "plugin:elementor:version",
      "plugin:missing:presence",
      "plugin:unexpected:unexpected",
      "theme:hello-elementor:active",
      "theme:hello-elementor:version",
      "theme:unexpected-theme:unexpected",
    ]);
    expect(drift.find((item) => item.package === "missing")).toEqual({
      kind: "plugin",
      package: "missing",
      field: "presence",
      expected: "installed",
      actual: "missing",
    });
  });

  test("does not claim an unrecorded wordpress.org installation is trusted", () => {
    expect(compareDependencies(manifest(), inventory())).toEqual([]);
    expect(inventory().trust).toBe("observation-only");
  });

  test("plans exact installs and activation after installation without implicit pruning", () => {
    const desired = manifest({
      plugins: [
        { slug: "missing", version: "1.2.3", active: true, source: official },
      ],
      themes: [],
    });
    const observed = inventory({
      plugins: [
        { slug: "unexpected", version: "1.0.0", activationState: "active" },
      ],
      themes: [],
    });

    const plan = planInstall(desired, observed);

    expect(plan.map(describeAction)).toEqual([
      "INSTALL plugin missing 1.2.3 from wordpress.org",
      "ACTIVATE plugin missing",
    ]);
    expect(plan.some((action) => action.type === "remove")).toBe(false);
    expect(planInstall(desired, observed, true).map(describeAction)).toContain(
      "REMOVE plugin unexpected",
    );
  });

  test("is idempotent when exact versions, activation, and source metadata match", () => {
    const source = {
      type: "local-artifact" as const,
      path: "packages/plugin.zip",
      sha256: "a".repeat(64),
      reviewed: true as const,
    };
    const desired = manifest({
      plugins: [{ slug: "elementor", version: "4.2.3", active: true, source }],
    });
    const observed = inventory({
      recordedSources: [{ kind: "plugin", slug: "elementor", source }],
    });
    expect(planInstall(desired, observed)).toEqual([]);
    expect(compareDependencies(desired, observed)).toEqual([]);
  });

  test("detects changed custom source metadata even when the artifact hash is unchanged", () => {
    const expectedSource = {
      type: "vendor-url" as const,
      url: "https://vendor.example/reviewed/plugin.zip",
      sha256: "a".repeat(64),
      reviewed: true as const,
    };
    const recordedSource = {
      ...expectedSource,
      url: "https://mirror.example/reviewed/plugin.zip",
    };
    const desired = manifest({
      plugins: [
        {
          slug: "elementor",
          version: "4.2.3",
          active: true,
          source: expectedSource,
        },
      ],
    });
    const observed = inventory({
      recordedSources: [
        { kind: "plugin", slug: "elementor", source: recordedSource },
      ],
    });

    const drift = compareDependencies(desired, observed);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      kind: "plugin",
      package: "elementor",
      field: "source",
    });
    expect(drift[0].expected).not.toBe(drift[0].actual);
    expect(planInstall(desired, observed)[0]).toMatchObject({
      type: "install",
      kind: "plugin",
      package: "elementor",
    });
  });
});

describe("execution, output, and exit behavior", () => {
  test("uses the declared exact official version and never retries a fallback", async () => {
    const transport = new FakeTransport((args) => ({
      exitCode: args.includes("install") ? 1 : 0,
      stdout: "",
      stderr: args.includes("install") ? "requested version unavailable" : "",
    }));
    const action = {
      type: "install" as const,
      kind: "plugin" as const,
      package: "elementor",
      version: "4.2.3",
      source: official,
    };

    await expect(
      executeInstallPlan(transport, manifest(), [action]),
    ).rejects.toBeInstanceOf(DepsOperationalError);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].args).toEqual([
      "plugin",
      "install",
      "elementor",
      "--version=4.2.3",
      "--force",
    ]);
  });

  test("inventory output omits internal source records and includes the review warning", () => {
    const output = inventoryOutput(
      inventory({
        recordedSources: [
          {
            kind: "plugin",
            slug: "private",
            source: {
              type: "local-artifact",
              path: "private/customer/package.zip",
              sha256: "a".repeat(64),
              reviewed: true,
            },
          },
        ],
      }),
    );
    const json = JSON.stringify(output);
    expect(json).not.toContain("private/customer");
    expect(json).not.toContain("recordedSources");
    expect(output.warning).toContain("observation only");
  });

  test("produces stable check JSON and exact match/drift exit codes", () => {
    const drift = compareDependencies(
      manifest(),
      inventory({ core: { version: "6.8.0", locale: "de_DE" } }),
    );
    expect(checkOutput("recovery", drift, false)).toEqual({
      schemaVersion: 1,
      command: "check",
      site: "recovery",
      status: "drift",
      strict: false,
      drift: [
        {
          kind: "core",
          package: "wordpress",
          field: "version",
          expected: "6.9.4",
          actual: "6.8.0",
        },
      ],
    });
    expect(exitCodeForCheck([])).toBe(0);
    expect(exitCodeForCheck(drift)).toBe(1);
  });

  test("returns exit 2 and secret-free JSON for invalid command configuration", async () => {
    const child = Bun.spawn(
      ["bun", "run", "src/index.ts", "deps", "inventory", "--json"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toMatchObject({
      command: "inventory",
      status: "error",
      error: expect.stringContaining("--site"),
    });
  });

  test("rejects a local artifact whose bytes do not match its reviewed hash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "elementor-cli-deps-"));
    const previousCwd = process.cwd();
    try {
      await Bun.write(
        join(directory, "plugin.zip"),
        "not the reviewed artifact",
      );
      process.chdir(directory);
      const source = {
        type: "local-artifact" as const,
        path: "plugin.zip",
        sha256: "a".repeat(64),
        reviewed: true as const,
      };
      const transport = new FakeTransport({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      await expect(
        executeInstallPlan(transport, manifest(), [
          {
            type: "install",
            kind: "plugin",
            package: "custom",
            version: "1.0.0",
            source,
          },
        ]),
      ).rejects.toThrow("SHA-256 mismatch");
      expect(transport.calls).toHaveLength(0);
    } finally {
      process.chdir(previousCwd);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
