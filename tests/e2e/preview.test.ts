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
});
