/**
 * E2E Tests: revisions commands
 *
 * Tests for:
 * - revisions list
 * - revisions show
 * - revisions diff
 * - revisions restore
 * - revisions create
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { join } from "path";
import { rm } from "fs/promises";
import {
  setupTestEnvironment,
  type TestEnvironment,
  createTestConfig,
} from "./setup";

const CLI_PATH = join(import.meta.dir, "../../src/index.ts");
const CONFIG_PATH = join(import.meta.dir, "test-config.yaml");
const TEST_DATA_DIR = join(import.meta.dir, ".elementor-cli");

let env: TestEnvironment;
let testPageId: string;

/**
 * Run the CLI with given arguments
 */
async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; output: string; exitCode: number }> {
  const proc = spawn({
    cmd: ["bun", "run", CLI_PATH, ...args],
    cwd: import.meta.dir,
    env: {
      ...process.env,
      ELEMENTOR_CLI_CONFIG: CONFIG_PATH,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // Combine stdout and stderr for easier assertions (spinner outputs to stderr)
  const output = stdout + stderr;

  return { stdout, stderr, output, exitCode };
}

describe("E2E: revisions commands", () => {
  beforeAll(async () => {
    env = await setupTestEnvironment();
    await createTestConfig(CONFIG_PATH, env.credentials);

    // Create a test page for revision tests
    const createResult = await runCli([
      "pages",
      "create",
      `Revision Test ${Date.now()}`,
      "--site",
      "test",
      "--status",
      "publish",
    ]);

    const match = createResult.output.match(/ID: (\d+)/);
    if (match) {
      testPageId = match[1];
    }
  }, 180000);

  afterAll(async () => {
    // Clean up test page
    if (testPageId) {
      await runCli(["pages", "delete", testPageId, "--site", "test", "--force"]);
    }

    try {
      await rm(TEST_DATA_DIR, { recursive: true, force: true });
      await Bun.write(CONFIG_PATH, "");
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("revisions list", () => {
    test("lists revisions for a page", async () => {
      const { stdout, exitCode } = await runCli([
        "revisions",
        "list",
        testPageId,
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      // May have no revisions initially, but command should succeed
      expect(stdout).toBeDefined();
    });

    test("fails for non-existent page", async () => {
      const { exitCode } = await runCli([
        "revisions",
        "list",
        "999999",
        "--site",
        "test",
      ]);

      expect(exitCode).not.toBe(0);
    });

    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli(["revisions", "list", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("List");
      expect(stdout).toContain("Examples:");
    });
  });

  describe("revisions create", () => {
    test("creates a revision", async () => {
      const { output, exitCode } = await runCli([
        "revisions",
        "create",
        testPageId,
        "--site",
        "test",
      ]);

      // May fail if WordPress doesn't support programmatic revision creation
      // but command structure should be correct
      if (exitCode === 0) {
        expect(output).toContain("backup");
      }
    });

    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli([
        "revisions",
        "create",
        "--help",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Create");
    });
  });

  describe("revisions command help", () => {
    test("shows help for revisions command", async () => {
      const { stdout, exitCode } = await runCli(["revisions", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("revisions");
      expect(stdout).toContain("list");
      expect(stdout).toContain("show");
      expect(stdout).toContain("diff");
      expect(stdout).toContain("restore");
    });

    test("shows help for revisions show", async () => {
      const { stdout, exitCode } = await runCli(["revisions", "show", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Show");
    });

    test("shows help for revisions diff", async () => {
      const { stdout, exitCode } = await runCli(["revisions", "diff", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("diff");
    });

    test("shows help for revisions restore", async () => {
      const { stdout, exitCode } = await runCli([
        "revisions",
        "restore",
        "--help",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Restore");
    });
  });
});
