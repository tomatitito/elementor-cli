/**
 * E2E Tests: pages commands
 *
 * Tests for:
 * - pages list
 * - pages info
 * - pages create
 * - pages delete
 * - pages templates
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { join } from "path";
import {
  setupTestEnvironment,
  globalTeardown,
  type TestEnvironment,
  createTestConfig,
} from "./setup";

const CLI_PATH = join(import.meta.dir, "../../src/index.ts");
const CONFIG_PATH = join(import.meta.dir, "test-config.yaml");

let env: TestEnvironment;

/**
 * Run the CLI with given arguments
 */
async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; output: string; exitCode: number }> {
  const proc = spawn({
    cmd: ["bun", "run", CLI_PATH, ...args],
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

describe("E2E: pages commands", () => {
  beforeAll(async () => {
    // Setup test environment
    env = await setupTestEnvironment();

    // Create test config pointing to our test WordPress instance
    await createTestConfig(CONFIG_PATH, env.credentials);
  }, 180000); // 3 minute timeout for setup

  afterAll(async () => {
    // Clean up config file
    try {
      await Bun.write(CONFIG_PATH, "");
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("pages list", () => {
    test("lists Elementor pages", async () => {
      const { stdout, exitCode } = await runCli([
        "pages",
        "list",
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Elementor Pages");
      // Should show at least our test pages
      expect(stdout).toContain("Test Page Simple");
    });

    test("filters pages by status", async () => {
      const { stdout, exitCode } = await runCli([
        "pages",
        "list",
        "--site",
        "test",
        "--status",
        "draft",
      ]);

      expect(exitCode).toBe(0);
      // Should show the draft page
      expect(stdout).toContain("Test Page Draft");
    });

    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli(["pages", "list", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("List all Elementor pages");
      expect(stdout).toContain("Examples:");
    });
  });

  describe("pages info", () => {
    test("shows page details", async () => {
      const { stdout, exitCode } = await runCli([
        "pages",
        "info",
        String(env.pages.simple),
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Test Page Simple");
      expect(stdout).toContain("ID:");
      expect(stdout).toContain("Status:");
      expect(stdout).toContain("Elementor: Yes");
    });

    test("shows template information", async () => {
      const { stdout, exitCode } = await runCli([
        "pages",
        "info",
        String(env.pages.simple),
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Template:");
      expect(stdout).toContain("elementor_canvas");
    });

    test("shows element count", async () => {
      const { stdout, exitCode } = await runCli([
        "pages",
        "info",
        String(env.pages.complex),
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Elements:");
    });

    test("fails for non-existent page", async () => {
      const { stderr, exitCode } = await runCli([
        "pages",
        "info",
        "999999",
        "--site",
        "test",
      ]);

      expect(exitCode).not.toBe(0);
    });
  });

  describe("pages create", () => {
    test("creates a new draft page", async () => {
      const title = `Test Create ${Date.now()}`;
      const { output, exitCode } = await runCli([
        "pages",
        "create",
        title,
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain(`Created page "${title}"`);
      expect(output).toContain("ID:");
    });

    test("creates a published page", async () => {
      const title = `Published Page ${Date.now()}`;
      const { output, exitCode } = await runCli([
        "pages",
        "create",
        title,
        "--site",
        "test",
        "--status",
        "publish",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain(`Created page "${title}"`);
    });

    test("creates page with template", async () => {
      const title = `Template Page ${Date.now()}`;
      const { output, exitCode } = await runCli([
        "pages",
        "create",
        title,
        "--site",
        "test",
        "--template",
        "hero-section",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain(`Created page "${title}"`);
      expect(output).toContain("Using template: Hero Section");
    });

    test("creates page with WordPress page template", async () => {
      const title = `Canvas Page ${Date.now()}`;
      const { output, exitCode } = await runCli([
        "pages",
        "create",
        title,
        "--site",
        "test",
        "--page-template",
        "elementor_canvas",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain(`Created page "${title}"`);
    });

    test("fails with invalid template", async () => {
      const { stderr, exitCode } = await runCli([
        "pages",
        "create",
        "Invalid Template Page",
        "--site",
        "test",
        "--template",
        "non-existent-template",
      ]);

      expect(exitCode).not.toBe(0);
    });
  });

  describe("pages delete", () => {
    test("deletes a page with --force", async () => {
      // First create a page to delete
      const title = `Delete Me ${Date.now()}`;
      const createResult = await runCli([
        "pages",
        "create",
        title,
        "--site",
        "test",
      ]);
      expect(createResult.exitCode).toBe(0);

      // Extract page ID from output (spinner output goes to stderr)
      const match = createResult.output.match(/ID: (\d+)/);
      expect(match).not.toBeNull();
      const pageId = match![1];

      // Delete the page
      const { output, exitCode } = await runCli([
        "pages",
        "delete",
        pageId,
        "--site",
        "test",
        "--force",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain(`Deleted page ${pageId}`);
    });

    test("fails for non-existent page", async () => {
      const { exitCode } = await runCli([
        "pages",
        "delete",
        "999999",
        "--site",
        "test",
        "--force",
      ]);

      expect(exitCode).not.toBe(0);
    });
  });

  describe("pages templates", () => {
    test("lists available templates", async () => {
      const { stdout, exitCode } = await runCli(["pages", "templates"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Available Page Templates");
      expect(stdout).toContain("blank");
      expect(stdout).toContain("hero-section");
      expect(stdout).toContain("landing-page");
    });
  });
});
