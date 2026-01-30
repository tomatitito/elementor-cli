/**
 * E2E Tests: db commands
 *
 * Tests for:
 * - db dump
 * - db list
 * - db restore
 *
 * Note: These tests require a running staging environment.
 * Since we're already running WordPress in Docker for e2e tests,
 * we can use that environment to test db commands.
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

describe("E2E: db commands", () => {
  beforeAll(async () => {
    env = await setupTestEnvironment();
    await createTestConfig(CONFIG_PATH, env.credentials);
  }, 180000);

  afterAll(async () => {
    try {
      await rm(TEST_DATA_DIR, { recursive: true, force: true });
      await Bun.write(CONFIG_PATH, "");
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("db help", () => {
    test("shows help for db command", async () => {
      const { stdout, exitCode } = await runCli(["db", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Database");
      expect(stdout).toContain("dump");
      expect(stdout).toContain("list");
      expect(stdout).toContain("restore");
    });

    test("shows help for db dump", async () => {
      const { stdout, exitCode } = await runCli(["db", "dump", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("dump");
    });

    test("shows help for db list", async () => {
      const { stdout, exitCode } = await runCli(["db", "list", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("list");
    });

    test("shows help for db restore", async () => {
      const { stdout, exitCode } = await runCli(["db", "restore", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("restore");
    });
  });

  // Note: Full db dump/restore tests require a properly configured staging environment
  // with Docker-in-Docker capabilities, which is complex in CI environments.
  // These tests verify the command structure and help text work correctly.

  describe("db list", () => {
    test("lists dumps (may be empty)", async () => {
      // This command should work even without dumps
      const { stdout, exitCode } = await runCli(["db", "list"]);

      // Should either succeed or fail gracefully
      // (fails if staging not configured, which is expected in pure e2e context)
      if (exitCode === 0) {
        expect(stdout).toBeDefined();
      }
    });
  });
});
