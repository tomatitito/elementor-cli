/**
 * E2E Tests: preview commands
 *
 * Tests for:
 * - preview init
 * - preview status
 * - preview element
 *
 * Note: preview start/stop/sync require Docker-in-Docker which is complex in CI.
 * These tests focus on commands that don't require starting additional containers.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { join } from "path";
import { rm } from "fs/promises";
import {
  setupTestEnvironment,
  type TestEnvironment,
  createTestConfig,
  wpCli,
} from "./setup";

const CLI_PATH = join(import.meta.dir, "../../src/index.ts");
const CONFIG_PATH = join(import.meta.dir, "test-config.yaml");
const TEST_PAGES_DIR = join(import.meta.dir, ".elementor-cli");

let env: TestEnvironment;

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

describe("E2E: preview commands", () => {
  beforeAll(async () => {
    env = await setupTestEnvironment();
    await createTestConfig(CONFIG_PATH, env.credentials);

    // Pull test pages for element command tests
    await runCli(["pull", String(env.pages.simple), "--site", "test"]);
    await runCli(["pull", String(env.pages.complex), "--site", "test"]);
  }, 180000);

  afterAll(async () => {
    try {
      await rm(TEST_PAGES_DIR, { recursive: true, force: true });
      await Bun.write(CONFIG_PATH, "");
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("preview element", () => {
    test("fetches element by ID from simple page", async () => {
      // The simple page has element with ID "def67890" (heading widget)
      const { stdout, exitCode } = await runCli([
        "preview",
        "element",
        String(env.pages.simple),
        "def67890",
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("def67890");
      expect(stdout).toContain("widget");
      expect(stdout).toContain("heading");
    });

    test("fetches nested element from complex page", async () => {
      // The complex page has nested elements - let's fetch "wid22222"
      const { stdout, exitCode } = await runCli([
        "preview",
        "element",
        String(env.pages.complex),
        "wid22222",
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("wid22222");
      expect(stdout).toContain("heading");
    });

    test("shows element path with --path flag", async () => {
      const { stdout, exitCode } = await runCli([
        "preview",
        "element",
        String(env.pages.complex),
        "wid11112",
        "--site",
        "test",
        "--path",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Path:");
    });

    test("fails for non-existent element ID", async () => {
      const { exitCode } = await runCli([
        "preview",
        "element",
        String(env.pages.simple),
        "nonexistent123",
        "--site",
        "test",
      ]);

      expect(exitCode).not.toBe(0);
    });

    test("fails for non-existent page", async () => {
      const { exitCode } = await runCli([
        "preview",
        "element",
        "999999",
        "abc123",
        "--site",
        "test",
      ]);

      expect(exitCode).not.toBe(0);
    });
  });

  describe("preview init", () => {
    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli(["preview", "init", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Initialize");
      expect(stdout).toContain("docker-compose");
    });
  });

  describe("preview status", () => {
    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli(["preview", "status", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("status");
    });
  });

  describe("preview sync meta serialization", () => {
    test("stores _elementor_page_settings as PHP serialized array not JSON string", async () => {
      // Issue #17: preview sync was storing _elementor_page_settings as a raw JSON string
      // instead of letting WordPress serialize it as a PHP array.
      // The fix is to use --format=json with wp post meta update.

      const testPageId = env.pages.simple;
      const testSettings = { background_color: "#FFFFFF", test_key: "test_value" };

      // Update meta using --format=json (simulating what the fixed code does)
      const updateResult = await wpCli([
        "--allow-root",
        "post",
        "meta",
        "update",
        String(testPageId),
        "_elementor_page_settings",
        JSON.stringify(testSettings),
        "--format=json",
      ]);
      expect(updateResult.exitCode).toBe(0);

      // Read back the meta value - WordPress should return a PHP array representation
      const getResult = await wpCli([
        "--allow-root",
        "post",
        "meta",
        "get",
        String(testPageId),
        "_elementor_page_settings",
      ]);
      expect(getResult.exitCode).toBe(0);

      // When stored correctly, wp post meta get returns a PHP array format like:
      // array ( 'key' => 'value', ... )
      // When stored incorrectly as JSON string, it returns: {"key":"value"}
      const output = getResult.stdout;

      // The output should NOT be a raw JSON string
      expect(output).not.toMatch(/^\s*\{.*\}\s*$/);

      // The output should be a PHP array representation
      expect(output).toContain("array");
    });

    test("stores JSON string without --format=json flag as raw string", async () => {
      // This test verifies the old (buggy) behavior to confirm the issue
      const testPageId = env.pages.draft;
      const testSettings = { test_key: "raw_json_test" };

      // Update meta WITHOUT --format=json (old buggy behavior)
      const updateResult = await wpCli([
        "--allow-root",
        "post",
        "meta",
        "update",
        String(testPageId),
        "_test_raw_json",
        JSON.stringify(testSettings),
      ]);
      expect(updateResult.exitCode).toBe(0);

      // Read back - should be stored as raw JSON string
      const getResult = await wpCli([
        "--allow-root",
        "post",
        "meta",
        "get",
        String(testPageId),
        "_test_raw_json",
      ]);
      expect(getResult.exitCode).toBe(0);

      // Without --format=json, the raw JSON string is stored as-is
      expect(getResult.stdout).toContain('{"test_key":"raw_json_test"}');
    });
  });
});
