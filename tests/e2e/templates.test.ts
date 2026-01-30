/**
 * E2E Tests: templates commands
 *
 * Tests for:
 * - templates list
 * - templates save
 * - templates import-html
 * - templates info
 * - templates preview
 * - templates delete
 * - templates export
 * - pages create --template (with custom templates)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { spawn } from "bun";
import { join } from "path";
import { mkdirSync, rmSync, existsSync } from "fs";
import {
  setupTestEnvironment,
  type TestEnvironment,
  createTestConfig,
} from "./setup";

const CLI_PATH = join(import.meta.dir, "../../src/index.ts");
const CONFIG_PATH = join(import.meta.dir, "test-config.yaml");
const FIXTURES_PATH = join(import.meta.dir, "fixtures");
const PROJECT_TEMPLATES_PATH = join(import.meta.dir, "test-project/.elementor-cli/templates");
const GLOBAL_TEMPLATES_PATH = join(import.meta.dir, "test-global-templates");

let env: TestEnvironment;

/**
 * Run the CLI with given arguments
 */
async function runCli(
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; output: string; exitCode: number }> {
  const proc = spawn({
    cmd: ["bun", "run", CLI_PATH, ...args],
    cwd: options?.cwd ?? join(import.meta.dir, "test-project"),
    env: {
      ...process.env,
      ELEMENTOR_CLI_CONFIG: CONFIG_PATH,
      ELEMENTOR_CLI_GLOBAL_TEMPLATES: GLOBAL_TEMPLATES_PATH,
      ...options?.env,
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

/**
 * Create a test project directory with template directories
 */
function setupTestDirectories(): void {
  const testProjectPath = join(import.meta.dir, "test-project");

  // Clean up existing directories
  if (existsSync(testProjectPath)) {
    rmSync(testProjectPath, { recursive: true });
  }
  if (existsSync(GLOBAL_TEMPLATES_PATH)) {
    rmSync(GLOBAL_TEMPLATES_PATH, { recursive: true });
  }

  // Create directories
  mkdirSync(PROJECT_TEMPLATES_PATH, { recursive: true });
  mkdirSync(GLOBAL_TEMPLATES_PATH, { recursive: true });
}

/**
 * Clean up test directories
 */
function cleanupTestDirectories(): void {
  const testProjectPath = join(import.meta.dir, "test-project");

  if (existsSync(testProjectPath)) {
    rmSync(testProjectPath, { recursive: true });
  }
  if (existsSync(GLOBAL_TEMPLATES_PATH)) {
    rmSync(GLOBAL_TEMPLATES_PATH, { recursive: true });
  }
}

/**
 * Create a sample custom template file
 */
async function createCustomTemplate(
  name: string,
  location: "project" | "global",
  content?: object
): Promise<void> {
  const templateDir = location === "project" ? PROJECT_TEMPLATES_PATH : GLOBAL_TEMPLATES_PATH;
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const templatePath = join(templateDir, `${slug}.json`);

  const template = content ?? {
    name,
    slug,
    description: `Test template: ${name}`,
    source: location,
    elements: [
      {
        id: "test123",
        elType: "container",
        settings: {},
        elements: [
          {
            id: "heading1",
            elType: "widget",
            widgetType: "heading",
            settings: {
              title: "Test Heading",
            },
            elements: [],
          },
        ],
      },
    ],
    settings: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await Bun.write(templatePath, JSON.stringify(template, null, 2));
}

describe("E2E: templates commands", () => {
  beforeAll(async () => {
    // Setup test environment
    env = await setupTestEnvironment();

    // Create test config pointing to our test WordPress instance
    await createTestConfig(CONFIG_PATH, env.credentials);

    // Setup test directories
    setupTestDirectories();
  }, 180000); // 3 minute timeout for setup

  afterAll(async () => {
    // Clean up config file
    try {
      await Bun.write(CONFIG_PATH, "");
    } catch {
      // Ignore cleanup errors
    }

    // Clean up test directories
    cleanupTestDirectories();
  });

  describe("templates list", () => {
    beforeEach(() => {
      setupTestDirectories();
    });

    test("lists built-in templates", async () => {
      const { stdout, exitCode } = await runCli(["templates", "list"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Templates");
      // Should show built-in templates
      expect(stdout).toContain("blank");
      expect(stdout).toContain("hero-section");
    });

    test("lists custom project templates", async () => {
      await createCustomTemplate("My Project Template", "project");

      const { stdout, exitCode } = await runCli(["templates", "list"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("My Project Template");
      expect(stdout).toContain("project");
    });

    test("lists custom global templates", async () => {
      await createCustomTemplate("My Global Template", "global");

      const { stdout, exitCode } = await runCli(["templates", "list"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("My Global Template");
      expect(stdout).toContain("global");
    });

    test("filters by source (--source)", async () => {
      await createCustomTemplate("Project Only", "project");
      await createCustomTemplate("Global Only", "global");

      const projectResult = await runCli(["templates", "list", "--source", "project"]);
      expect(projectResult.exitCode).toBe(0);
      expect(projectResult.stdout).toContain("Project Only");
      expect(projectResult.stdout).not.toContain("Global Only");
      expect(projectResult.stdout).not.toContain("blank"); // built-in

      const globalResult = await runCli(["templates", "list", "--source", "global"]);
      expect(globalResult.exitCode).toBe(0);
      expect(globalResult.stdout).toContain("Global Only");
      expect(globalResult.stdout).not.toContain("Project Only");

      const builtInResult = await runCli(["templates", "list", "--source", "built-in"]);
      expect(builtInResult.exitCode).toBe(0);
      expect(builtInResult.stdout).toContain("blank");
      expect(builtInResult.stdout).not.toContain("Project Only");
    });

    test("outputs JSON format (--json)", async () => {
      await createCustomTemplate("JSON Test Template", "project");

      const { stdout, exitCode } = await runCli(["templates", "list", "--json"]);

      expect(exitCode).toBe(0);

      const templates = JSON.parse(stdout);
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);

      const jsonTemplate = templates.find((t: { name: string }) => t.name === "JSON Test Template");
      expect(jsonTemplate).toBeDefined();
      expect(jsonTemplate.source).toBe("project");
    });

    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli(["templates", "list", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("List");
      expect(stdout).toContain("--source");
      expect(stdout).toContain("--json");
    });
  });

  describe("templates save", () => {
    beforeEach(() => {
      setupTestDirectories();
    });

    test("saves page as project template", async () => {
      const { output, exitCode } = await runCli([
        "templates",
        "save",
        String(env.pages.simple),
        "--name",
        "Saved Page Template",
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Saved Page Template");
      expect(output).toContain("Saved template");

      // Verify template file exists
      const templatePath = join(PROJECT_TEMPLATES_PATH, "saved-page-template.json");
      expect(existsSync(templatePath)).toBe(true);

      // Verify template content
      const content = await Bun.file(templatePath).json();
      expect(content.name).toBe("Saved Page Template");
      expect(content.source).toBe("project");
      expect(Array.isArray(content.elements)).toBe(true);
    });

    test("saves page as global template (--global)", async () => {
      const { output, exitCode } = await runCli([
        "templates",
        "save",
        String(env.pages.simple),
        "--name",
        "Global Saved Template",
        "--global",
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Global Saved Template");

      // Verify template file exists in global directory
      const templatePath = join(GLOBAL_TEMPLATES_PATH, "global-saved-template.json");
      expect(existsSync(templatePath)).toBe(true);

      const content = await Bun.file(templatePath).json();
      expect(content.source).toBe("global");
    });

    test("saves template with description", async () => {
      const { output, exitCode } = await runCli([
        "templates",
        "save",
        String(env.pages.simple),
        "--name",
        "Described Template",
        "--description",
        "A template with a description",
        "--site",
        "test",
      ]);

      expect(exitCode).toBe(0);

      const templatePath = join(PROJECT_TEMPLATES_PATH, "described-template.json");
      const content = await Bun.file(templatePath).json();
      expect(content.description).toBe("A template with a description");
    });

    test("requires --name option", async () => {
      const { exitCode, stderr } = await runCli([
        "templates",
        "save",
        String(env.pages.simple),
        "--site",
        "test",
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("name");
    });

    test("fails for non-existent page", async () => {
      const { exitCode } = await runCli([
        "templates",
        "save",
        "999999",
        "--name",
        "Should Fail",
        "--site",
        "test",
      ]);

      expect(exitCode).not.toBe(0);
    });
  });

  describe("templates import-html", () => {
    beforeEach(() => {
      setupTestDirectories();
    });

    test("converts simple HTML file", async () => {
      const htmlPath = join(FIXTURES_PATH, "simple.html");

      const { output, exitCode } = await runCli([
        "templates",
        "import-html",
        htmlPath,
        "--name",
        "Simple Import",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Simple Import");
      expect(output).toContain("Imported template");

      // Verify template was created
      const templatePath = join(PROJECT_TEMPLATES_PATH, "simple-import.json");
      expect(existsSync(templatePath)).toBe(true);

      const content = await Bun.file(templatePath).json();
      expect(content.name).toBe("Simple Import");
      expect(Array.isArray(content.elements)).toBe(true);
      expect(content.elements.length).toBeGreaterThan(0);
    });

    test("handles headings (h1-h6)", async () => {
      const htmlPath = join(FIXTURES_PATH, "simple.html");

      const { exitCode } = await runCli([
        "templates",
        "import-html",
        htmlPath,
        "--name",
        "Heading Test",
      ]);

      expect(exitCode).toBe(0);

      const templatePath = join(PROJECT_TEMPLATES_PATH, "heading-test.json");
      const content = await Bun.file(templatePath).json();

      // Find heading widget in elements
      const hasHeading = JSON.stringify(content.elements).includes("heading");
      expect(hasHeading).toBe(true);
    });

    test("handles hero section with image and buttons", async () => {
      const htmlPath = join(FIXTURES_PATH, "hero-section.html");

      const { output, exitCode } = await runCli([
        "templates",
        "import-html",
        htmlPath,
        "--name",
        "Hero Import",
      ]);

      expect(exitCode).toBe(0);

      const templatePath = join(PROJECT_TEMPLATES_PATH, "hero-import.json");
      const content = await Bun.file(templatePath).json();

      const elementsStr = JSON.stringify(content.elements);
      expect(elementsStr).toContain("heading");
      expect(elementsStr).toContain("image");
      expect(elementsStr).toContain("button");
    });

    test("saves as global template with --global", async () => {
      const htmlPath = join(FIXTURES_PATH, "simple.html");

      const { exitCode } = await runCli([
        "templates",
        "import-html",
        htmlPath,
        "--name",
        "Global HTML Import",
        "--global",
      ]);

      expect(exitCode).toBe(0);

      const templatePath = join(GLOBAL_TEMPLATES_PATH, "global-html-import.json");
      expect(existsSync(templatePath)).toBe(true);

      const content = await Bun.file(templatePath).json();
      expect(content.source).toBe("global");
    });

    test("uses filename as default template name", async () => {
      const htmlPath = join(FIXTURES_PATH, "contact-form.html");

      const { output, exitCode } = await runCli([
        "templates",
        "import-html",
        htmlPath,
      ]);

      expect(exitCode).toBe(0);

      // Should use "contact-form" as the name
      const templatePath = join(PROJECT_TEMPLATES_PATH, "contact-form.json");
      expect(existsSync(templatePath)).toBe(true);
    });

    test("fails for non-existent HTML file", async () => {
      const { exitCode, stderr } = await runCli([
        "templates",
        "import-html",
        "/nonexistent/path/file.html",
      ]);

      expect(exitCode).not.toBe(0);
    });
  });

  describe("templates info", () => {
    beforeEach(async () => {
      setupTestDirectories();
      await createCustomTemplate("Info Test Template", "project");
    });

    test("shows template details", async () => {
      const { stdout, exitCode } = await runCli([
        "templates",
        "info",
        "info-test-template",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Info Test Template");
      expect(stdout).toContain("Slug:");
      expect(stdout).toContain("Source:");
      expect(stdout).toContain("project");
    });

    test("shows element count", async () => {
      const { stdout, exitCode } = await runCli([
        "templates",
        "info",
        "info-test-template",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Elements:");
    });

    test("shows creation date", async () => {
      const { stdout, exitCode } = await runCli([
        "templates",
        "info",
        "info-test-template",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Created:");
    });

    test("shows built-in template info", async () => {
      const { stdout, exitCode } = await runCli([
        "templates",
        "info",
        "hero-section",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Hero Section");
      expect(stdout).toContain("built-in");
    });

    test("fails for non-existent template", async () => {
      const { exitCode, output } = await runCli([
        "templates",
        "info",
        "non-existent-template",
      ]);

      expect(exitCode).not.toBe(0);
      expect(output).toContain("not found");
    });
  });

  describe("templates preview", () => {
    beforeEach(async () => {
      setupTestDirectories();
      await createCustomTemplate("Preview Test Template", "project");
    });

    test("starts server on specified port", async () => {
      // Start preview in background
      const proc = spawn({
        cmd: ["bun", "run", CLI_PATH, "templates", "preview", "preview-test-template", "--port", "3099", "--no-open"],
        cwd: join(import.meta.dir, "test-project"),
        env: {
          ...process.env,
          ELEMENTOR_CLI_CONFIG: CONFIG_PATH,
          ELEMENTOR_CLI_GLOBAL_TEMPLATES: GLOBAL_TEMPLATES_PATH,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for server to start
      await Bun.sleep(2000);

      // Try to fetch the preview page
      try {
        const response = await fetch("http://localhost:3099", {
          signal: AbortSignal.timeout(5000),
        });
        expect(response.ok).toBe(true);

        const html = await response.text();
        expect(html).toContain("Test Heading"); // From our template
      } finally {
        // Kill the server process
        proc.kill();
        await proc.exited;
      }
    });

    test("fails for non-existent template", async () => {
      const { exitCode, output } = await runCli([
        "templates",
        "preview",
        "non-existent-template",
        "--no-open",
      ]);

      expect(exitCode).not.toBe(0);
      expect(output).toContain("not found");
    });
  });

  describe("templates delete", () => {
    beforeEach(async () => {
      setupTestDirectories();
    });

    test("deletes project template with --force", async () => {
      await createCustomTemplate("Delete Me", "project");

      const templatePath = join(PROJECT_TEMPLATES_PATH, "delete-me.json");
      expect(existsSync(templatePath)).toBe(true);

      const { output, exitCode } = await runCli([
        "templates",
        "delete",
        "delete-me",
        "--force",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Deleted");
      expect(existsSync(templatePath)).toBe(false);
    });

    test("deletes global template with --force", async () => {
      await createCustomTemplate("Delete Global", "global");

      const templatePath = join(GLOBAL_TEMPLATES_PATH, "delete-global.json");
      expect(existsSync(templatePath)).toBe(true);

      const { output, exitCode } = await runCli([
        "templates",
        "delete",
        "delete-global",
        "--force",
      ]);

      expect(exitCode).toBe(0);
      expect(existsSync(templatePath)).toBe(false);
    });

    test("fails for built-in templates", async () => {
      const { exitCode, output } = await runCli([
        "templates",
        "delete",
        "hero-section",
        "--force",
      ]);

      expect(exitCode).not.toBe(0);
      expect(output).toContain("built-in");
    });

    test("fails for non-existent template", async () => {
      const { exitCode, output } = await runCli([
        "templates",
        "delete",
        "non-existent-template",
        "--force",
      ]);

      expect(exitCode).not.toBe(0);
      expect(output).toContain("not found");
    });
  });

  describe("templates export", () => {
    beforeEach(async () => {
      setupTestDirectories();
      await createCustomTemplate("Export Test Template", "project");
    });

    test("exports template to JSON file", async () => {
      const outputPath = join(import.meta.dir, "test-project", "exported.json");

      const { output, exitCode } = await runCli([
        "templates",
        "export",
        "export-test-template",
        "--output",
        outputPath,
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Exported");
      expect(existsSync(outputPath)).toBe(true);

      const content = await Bun.file(outputPath).json();
      expect(content.name).toBe("Export Test Template");
    });

    test("uses template name as default filename", async () => {
      const { output, exitCode } = await runCli([
        "templates",
        "export",
        "export-test-template",
      ]);

      expect(exitCode).toBe(0);

      const defaultPath = join(import.meta.dir, "test-project", "export-test-template.json");
      expect(existsSync(defaultPath)).toBe(true);
    });

    test("exports built-in template", async () => {
      const outputPath = join(import.meta.dir, "test-project", "hero-exported.json");

      const { exitCode } = await runCli([
        "templates",
        "export",
        "hero-section",
        "--output",
        outputPath,
      ]);

      expect(exitCode).toBe(0);
      expect(existsSync(outputPath)).toBe(true);
    });

    test("fails for non-existent template", async () => {
      const { exitCode, output } = await runCli([
        "templates",
        "export",
        "non-existent-template",
      ]);

      expect(exitCode).not.toBe(0);
      expect(output).toContain("not found");
    });
  });

  describe("pages create --template (custom templates)", () => {
    beforeEach(async () => {
      setupTestDirectories();
    });

    test("uses project template when available", async () => {
      await createCustomTemplate("My Custom Layout", "project");

      const title = `Custom Template Page ${Date.now()}`;
      const { output, exitCode } = await runCli([
        "pages",
        "create",
        title,
        "--site",
        "test",
        "--template",
        "my-custom-layout",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain(title);
      expect(output).toContain("My Custom Layout");
      expect(output).toContain("project"); // Should indicate template source
    });

    test("falls back to global template", async () => {
      await createCustomTemplate("Global Layout", "global");

      const title = `Global Template Page ${Date.now()}`;
      const { output, exitCode } = await runCli([
        "pages",
        "create",
        title,
        "--site",
        "test",
        "--template",
        "global-layout",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain(title);
      expect(output).toContain("Global Layout");
    });

    test("project template takes precedence over global", async () => {
      // Create templates with same slug in both locations
      await createCustomTemplate("Same Name Template", "project", {
        name: "Same Name Template",
        slug: "same-name-template",
        description: "Project version",
        source: "project",
        elements: [],
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await createCustomTemplate("Same Name Template", "global", {
        name: "Same Name Template",
        slug: "same-name-template",
        description: "Global version",
        source: "global",
        elements: [],
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const title = `Precedence Test ${Date.now()}`;
      const { output, exitCode } = await runCli([
        "pages",
        "create",
        title,
        "--site",
        "test",
        "--template",
        "same-name-template",
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("project"); // Should use project template
    });

    test("falls back to built-in template", async () => {
      const title = `Built-in Template Page ${Date.now()}`;
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
      expect(output).toContain(title);
      expect(output).toContain("Hero Section");
    });

    test("fails with invalid template name", async () => {
      const { exitCode, stderr } = await runCli([
        "pages",
        "create",
        "Invalid Template Page",
        "--site",
        "test",
        "--template",
        "non-existent-template-xyz",
      ]);

      expect(exitCode).not.toBe(0);
    });
  });
});
