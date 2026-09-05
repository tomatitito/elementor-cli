import { describe, expect, test } from "bun:test";
import {
  type DependencyAuditFinding,
  auditDependencies,
  auditReport,
  exitCodeForAudit,
  normalizeChecksumOutput,
  normalizeCoreChecksumOutput,
} from "../../src/services/dependency-audit.js";
import { DepsOperationalError } from "../../src/services/deps-manager.js";
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

const CORE_CHECKSUM_SUCCESS =
  "Success: WordPress installation verifies against checksums.";

class FakeTransport implements WpCliTransport {
  calls: Array<{ args: string[]; options: WpCliExecOptions }> = [];

  constructor(private readonly result: (args: string[]) => CommandResult) {}

  async exec(
    args: string[],
    options: WpCliExecOptions = {},
  ): Promise<CommandResult> {
    this.calls.push({ args: [...args], options });
    return this.result(args);
  }
}

function inventory(overrides: Partial<SiteInventory> = {}): SiteInventory {
  return {
    schemaVersion: 1,
    site: { name: "production", publicUrl: "https://example.com/" },
    collectedAt: "2026-08-27T12:00:00.000Z",
    core: { version: "6.9.4", locale: "en_US" },
    phpVersion: "8.3.0",
    plugins: [],
    themes: [],
    muPlugins: [],
    dropIns: [],
    recordedSources: [],
    trust: "observation-only",
    ...overrides,
  };
}

function manifest(plugins: PackagesManifest["plugins"] = []): PackagesManifest {
  return PackagesManifestSchema.parse({
    schemaVersion: 1,
    core: { version: "6.9.4", locale: "en_US" },
    plugins,
    themes: [],
  });
}

describe("checksum normalization", () => {
  test("preserves added, missing, and modified rows as separate sorted findings", () => {
    const result = normalizeChecksumOutput(
      JSON.stringify([
        { file: "z.php", message: "File was added" },
        { file: "a.php", message: "Checksum does not match" },
        { file: "m.php", message: "File doesn't exist" },
      ]),
      "Error: verification failed.",
      1,
    );

    expect(result).toEqual({
      findings: [
        { kind: "modified", path: "a.php" },
        { kind: "missing", path: "m.php" },
        { kind: "added", path: "z.php" },
      ],
    });
  });

  test("accepts WP-CLI's non-JSON success summary", () => {
    expect(
      normalizeChecksumOutput("Success: Verified 1 of 1 plugins.\n", "", 0),
    ).toEqual({ findings: [] });
    expect(
      normalizeChecksumOutput(
        "Success: Verified 0 of 1 plugins (1 skipped).\n",
        "Warning: Couldn't fetch checksums (HTTP code 404).",
        0,
      ).unavailable?.cause,
    ).toBe("http-404");
  });

  test("normalizes supported core checksum text output", () => {
    expect(
      normalizeCoreChecksumOutput(
        "Success: WordPress installation verifies against checksums.\n",
        "Warning: File should not exist: wp-config-docker.php\n",
        0,
      ),
    ).toEqual({
      findings: [{ kind: "added", path: "wp-config-docker.php" }],
    });
    expect(
      normalizeCoreChecksumOutput(
        "",
        [
          "Warning: File doesn't exist: license.txt",
          "Warning: File doesn't verify against checksum: index.php",
          "Error: WordPress installation doesn't verify against checksums.",
        ].join("\n"),
        1,
      ),
    ).toEqual({
      findings: [
        { kind: "modified", path: "index.php" },
        { kind: "missing", path: "license.txt" },
      ],
    });
  });

  test("rejects unknown or unsafe core checksum text", () => {
    expect(() =>
      normalizeCoreChecksumOutput("", "Warning: Unexpected result", 1),
    ).toThrow("unrecognized core checksum output");
    expect(() =>
      normalizeCoreChecksumOutput(
        "",
        "Warning: File should not exist: ../secret",
        1,
      ),
    ).toThrow("unsafe checksum finding path");
  });

  test("distinguishes HTTP 404 from network failure without leaking secrets", () => {
    expect(
      normalizeChecksumOutput(
        "",
        "Error: Couldn't fetch checksums (HTTP code 404). token=hunter2",
        1,
      ).unavailable,
    ).toEqual({
      cause: "http-404",
      reason:
        "HTTP 404: WordPress.org has no checksums for this package and version.",
    });
    const network = normalizeChecksumOutput(
      "",
      "cURL error 6: Could not resolve host; password=topsecret",
      1,
    );
    expect(network.unavailable?.cause).toBe("network-failure");
    expect(JSON.stringify(network)).not.toContain("topsecret");
    expect(
      normalizeChecksumOutput("", "Couldn't fetch response (HTTP code 503).", 1)
        .unavailable,
    ).toEqual({
      cause: "http-error",
      reason: "HTTP 503: WordPress.org checksum retrieval failed.",
    });
  });

  test("rejects malformed, unknown, and traversal-bearing output rather than reporting clean", () => {
    expect(() => normalizeChecksumOutput("not-json", "", 1)).toThrow(
      "invalid checksum JSON",
    );
    expect(() =>
      normalizeChecksumOutput(
        JSON.stringify([{ file: "safe.php", message: "Surprising result" }]),
        "",
        1,
      ),
    ).toThrow("unrecognized checksum finding");
    expect(() =>
      normalizeChecksumOutput(
        JSON.stringify([{ file: "../secret", message: "File was added" }]),
        "",
        1,
      ),
    ).toThrow("unsafe checksum finding path");
  });
});

describe("dependency integrity audit", () => {
  test("normalizes every official finding, unknown/custom sources, unsupported themes, and uploads executables", async () => {
    const customSource = {
      type: "git" as const,
      repository: "https://github.com/example/custom.git",
      revision: "a".repeat(40),
      artifactUrl: "https://github.com/example/custom/archive/a.zip",
      sha256: "b".repeat(64),
      reviewed: true as const,
    };
    const observed = inventory({
      plugins: [
        { slug: "official", version: "1.2.3", activationState: "active" },
        { slug: "unknown", version: "9.9.9", activationState: "inactive" },
        { slug: "custom", version: "2.0.0", activationState: "inactive" },
      ],
      themes: [
        {
          slug: "official-theme",
          version: "3.0.0",
          active: true,
          parent: null,
          child: false,
        },
      ],
      recordedSources: [
        { kind: "plugin", slug: "custom", source: customSource },
      ],
    });
    const desired = manifest([
      {
        slug: "official",
        version: "1.2.3",
        active: true,
        source: { type: "wordpress.org" },
      },
      {
        slug: "custom",
        version: "2.0.0",
        active: false,
        source: customSource,
      },
    ]);
    const hashes = {
      "wp-content/plugins/official/added.php": "1".repeat(64),
      "wp-content/plugins/official/changed.js": "2".repeat(64),
    };
    const transport = new FakeTransport((args) => {
      if (args[0] === "core") {
        return { exitCode: 0, stdout: CORE_CHECKSUM_SUCCESS, stderr: "" };
      }
      if (args[0] === "plugin" && args.includes("official")) {
        return {
          exitCode: 1,
          stdout: JSON.stringify([
            {
              plugin_name: "official",
              file: "changed.js",
              message: "Checksum does not match",
            },
            {
              plugin_name: "official",
              file: "added.php",
              message: "File was added",
            },
          ]),
          stderr: "Error: Only verified 0 of 1 plugins (1 failed).",
        };
      }
      if (args[0] === "plugin" && args.includes("unknown")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Error: Couldn't fetch checksums (HTTP code 404).",
        };
      }
      if (args[0] === "eval") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            hashes,
            expected: {
              "wp-content/plugins/official/changed.js": ["4".repeat(64)],
              "wp-content/plugins/official/missing.css": ["5".repeat(64)],
            },
            pluginMissing: [
              {
                slug: "official",
                version: "1.2.3",
                path: "wp-content/plugins/official/missing.css",
              },
            ],
            pluginUnavailable: [],
            uploadsStatus: "scanned",
            uploads: [
              {
                path: "wp-content/uploads/2026/08/shell.php",
                sha256: "3".repeat(64),
              },
            ],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    });

    const findings = await auditDependencies(transport, observed, desired);

    expect(findings.filter((item) => item.package === "official")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "critical",
          reason: expect.stringContaining("does not match"),
          path: "wp-content/plugins/official/changed.js",
          expected: `SHA-256 ${"4".repeat(64)}`,
          actual: `SHA-256 ${"2".repeat(64)}`,
        }),
        expect.objectContaining({
          severity: "high",
          reason: "official package file is missing",
          path: "wp-content/plugins/official/missing.css",
          expected: `official file present; SHA-256 ${"5".repeat(64)}`,
          actual: "file missing",
        }),
        expect.objectContaining({
          severity: "critical",
          reason: expect.stringContaining("absent from the official package"),
          path: "wp-content/plugins/official/added.php",
          expected: "file absent",
        }),
      ]),
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "critical",
          componentType: "uploads",
          path: "wp-content/uploads/2026/08/shell.php",
        }),
        expect.objectContaining({
          severity: "warning",
          package: "unknown",
          reason: expect.stringContaining("HTTP 404"),
        }),
        expect.objectContaining({
          severity: "warning",
          package: "unknown",
          actual: "unknown source",
        }),
        expect.objectContaining({
          severity: "warning",
          package: "custom",
          reason: expect.stringContaining("matching manifest provenance"),
          reference: expect.stringContaining("artifact SHA-256"),
        }),
        expect.objectContaining({
          severity: "warning",
          componentType: "theme",
          reason: expect.stringContaining("not published"),
        }),
      ]),
    );
  });

  test("constructs only read-only checksum/hash commands and never interpolates custom source metadata", async () => {
    const source = {
      type: "vendor-url" as const,
      url: "https://vendor.example/private.zip",
      sha256: "c".repeat(64),
      reviewed: true as const,
    };
    const transport = new FakeTransport((args) => ({
      exitCode: 0,
      stdout:
        args[0] === "eval"
          ? JSON.stringify({
              hashes: {},
              expected: {},
              pluginMissing: [],
              pluginUnavailable: [],
              uploadsStatus: "outside-root",
              uploads: [],
            })
          : CORE_CHECKSUM_SUCCESS,
      stderr: "",
    }));
    const findings = await auditDependencies(
      transport,
      inventory({
        plugins: [
          { slug: "custom", version: "1.0.0", activationState: "inactive" },
        ],
        recordedSources: [{ kind: "plugin", slug: "custom", source }],
      }),
      manifest([
        {
          slug: "custom",
          version: "1.0.0",
          active: false,
          source,
        },
      ]),
    );

    expect(transport.calls.map((call) => call.args.slice(0, 2))).toEqual([
      ["core", "verify-checksums"],
      ["eval", expect.any(String)],
    ]);
    expect(transport.calls[0].args).not.toContain("--format=json");
    const serializedCalls = JSON.stringify(transport.calls);
    expect(serializedCalls).not.toContain(source.url);
    for (const mutation of [
      "install",
      "update",
      "delete",
      "activate",
      "deactivate",
      "import",
      "search-replace",
    ]) {
      expect(serializedCalls).not.toContain(`\"${mutation}\"`);
    }
    expect(transport.calls[1].options.stdin).toBe(
      JSON.stringify({ paths: [], plugins: [] }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        componentType: "uploads",
        actual: "uploads scan unavailable",
      }),
    );
  });

  test("treats evidence scan failure as operational, not a clean audit", async () => {
    const transport = new FakeTransport((args) =>
      args[0] === "eval"
        ? { exitCode: 1, stdout: "", stderr: "token=secret-value" }
        : { exitCode: 0, stdout: CORE_CHECKSUM_SUCCESS, stderr: "" },
    );
    await expect(auditDependencies(transport, inventory())).rejects.toEqual(
      expect.objectContaining({
        name: "DepsOperationalError",
        message: expect.stringContaining("token=[REDACTED]"),
      }),
    );
  });
});

describe("audit output and thresholds", () => {
  const findings: DependencyAuditFinding[] = [
    {
      severity: "warning",
      componentType: "theme",
      package: "theme",
      reason: "reference unavailable",
      remediation: "review source",
    },
    {
      severity: "high",
      componentType: "plugin",
      package: "plugin",
      reason: "missing file",
      remediation: "reinstall",
    },
  ];

  test("applies inclusive info/warning/high/critical thresholds", () => {
    expect(exitCodeForAudit(findings, "info")).toBe(1);
    expect(exitCodeForAudit(findings, "warning")).toBe(1);
    expect(exitCodeForAudit(findings, "high")).toBe(1);
    expect(exitCodeForAudit(findings, "critical")).toBe(0);
    expect(exitCodeForAudit([], "warning")).toBe(0);
  });

  test("produces deterministic JSON with the same evidence and remediation fields", () => {
    const first = auditReport("production", findings, "high");
    const second = auditReport("production", [...findings].reverse(), "high");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.findings[0]).toEqual(
      expect.objectContaining({
        severity: "high",
        reason: "missing file",
        remediation: "reinstall",
      }),
    );
  });

  test("uses DepsOperationalError for normalization failures", () => {
    expect(() => normalizeChecksumOutput("{}", "", 1)).toThrow(
      DepsOperationalError,
    );
  });

  test("CLI operational failures use exit 2 with secret-free structured errors", async () => {
    for (const args of [
      ["deps", "audit", "--json"],
      [
        "deps",
        "audit",
        "--site",
        "does-not-need-to-exist",
        "--fail-on",
        "invalid",
        "--json",
      ],
    ]) {
      const child = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
      expect(JSON.parse(stderr)).toMatchObject({
        command: "deps audit",
        status: "error",
      });
      expect(stderr).not.toContain("password");
    }
  });
});
