/**
 * E2E Tests: pull/push/diff commands
 *
 * Tests for:
 * - pull
 * - push
 * - diff
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { join } from "path";
import { rm, mkdir } from "fs/promises";
import {
  setupTestEnvironment,
  type TestEnvironment,
  createTestConfig,
} from "./setup";

const CLI_PATH = join(import.meta.dir, "../../src/index.ts");
const CONFIG_PATH = join(import.meta.dir, "test-config.yaml");
const TEST_PAGES_DIR = join(import.meta.dir, ".elementor-cli");

let env: TestEnvironment;

/**
 * Run the CLI with given arguments in a specific working directory
 */
async function runCli(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; output: string; exitCode: number }> {
  const proc = spawn({
    cmd: ["bun", "run", CLI_PATH, ...args],
    cwd: cwd ?? import.meta.dir,
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

describe("E2E: pull/push/diff commands", () => {
  beforeAll(async () => {
    // Setup test environment
    env = await setupTestEnvironment();

    // Create test config
    await createTestConfig(CONFIG_PATH, env.credentials);

    // Clean up any existing local pages
    try {
      await rm(TEST_PAGES_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  }, 180000);

  afterAll(async () => {
    // Cleanup
    try {
      await rm(TEST_PAGES_DIR, { recursive: true, force: true });
      await Bun.write(CONFIG_PATH, "");
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("pull", () => {
    test("pulls a page from remote", async () => {
      const { output, exitCode } = await runCli([
        "pull",
        String(env.pages.simple),
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Pulled");
    });

    test("creates local files after pull", async () => {
      // Pull the page first
      await runCli(["pull", String(env.pages.complex), "--site", "test"]);

      // Check that files were created
      const elementsPath = join(
        TEST_PAGES_DIR,
        "pages",
        "test",
        String(env.pages.complex),
        "elements.json"
      );
      const metaPath = join(
        TEST_PAGES_DIR,
        "pages",
        "test",
        String(env.pages.complex),
        "meta.json"
      );

      const elementsFile = Bun.file(elementsPath);
      const metaFile = Bun.file(metaPath);

      expect(await elementsFile.exists()).toBe(true);
      expect(await metaFile.exists()).toBe(true);

      // Verify elements.json contains valid JSON
      const elementsContent = await elementsFile.json();
      expect(Array.isArray(elementsContent)).toBe(true);
    });

    test("pulls page with correct template", async () => {
      await runCli(["pull", String(env.pages.simple), "--site", "test"]);

      const metaPath = join(
        TEST_PAGES_DIR,
        "pages",
        "test",
        String(env.pages.simple),
        "meta.json"
      );
      const metaFile = Bun.file(metaPath);
      const meta = await metaFile.json();

      expect(meta.template).toBe("elementor_canvas");
    });

    test("fails for non-existent page", async () => {
      const { output, exitCode } = await runCli([
        "pull",
        "999999",
        "--site",
        "test",
      ]);

      // Should fail with non-zero exit when pulling a specific page that doesn't exist
      expect(exitCode).not.toBe(0);
      expect(output).toContain("Failed");
    });

    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli(["pull", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Download");
      expect(stdout).toContain("Examples:");
    });
  });

  describe("push", () => {
    test("pushes modified page to remote", async () => {
      // First pull the page
      await runCli(["pull", String(env.pages.simple), "--site", "test"]);

      // Modify the local elements.json
      const elementsPath = join(
        TEST_PAGES_DIR,
        "pages",
        "test",
        String(env.pages.simple),
        "elements.json"
      );
      const elements = await Bun.file(elementsPath).json();

      // Find the heading widget and modify it
      if (elements[0]?.elements?.[0]?.settings) {
        elements[0].elements[0].settings.title = "Modified Title for E2E Test";
      }
      await Bun.write(elementsPath, JSON.stringify(elements, null, 2));

      // Push the changes
      const { output, exitCode } = await runCli([
        "push",
        String(env.pages.simple),
        "--site",
        "test",
        "--force",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Pushed");
    });

    test("warns when no local page exists", async () => {
      const { output, exitCode } = await runCli([
        "push",
        "999999",
        "--site",
        "test",
      ]);

      // Push shows a warning for non-existent local pages
      expect(output).toContain("not found locally");
    });
  });

  describe("diff", () => {
    test("shows diff between local and remote", async () => {
      // Pull a page first
      await runCli(["pull", String(env.pages.complex), "--site", "test"]);

      // Modify local file
      const elementsPath = join(
        TEST_PAGES_DIR,
        "pages",
        "test",
        String(env.pages.complex),
        "elements.json"
      );
      const elements = await Bun.file(elementsPath).json();
      if (elements[0]?.settings) {
        elements[0].settings.content_width = "boxed";
      }
      await Bun.write(elementsPath, JSON.stringify(elements, null, 2));

      // Run diff
      const { stdout, exitCode } = await runCli([
        "diff",
        String(env.pages.complex),
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      // Should show some difference
      expect(stdout.length).toBeGreaterThan(0);
    });

    test("shows no changes when synced", async () => {
      // Create a new page and pull it fresh
      const createResult = await runCli([
        "pages",
        "create",
        `Diff Test ${Date.now()}`,
        "--site",
        "test",
      ]);
      const match = createResult.output.match(/ID: (\d+)/);
      expect(match).not.toBeNull();
      const pageId = match![1];

      // Pull the fresh page
      await runCli(["pull", pageId, "--site", "test"]);

      // Run diff - should show no changes
      const { stdout, exitCode } = await runCli([
        "diff",
        pageId,
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("No changes");
    });

    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli(["diff", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Compare");
      expect(stdout).toContain("Examples:");
    });
  });
});
