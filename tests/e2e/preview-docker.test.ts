/**
 * E2E Tests: preview commands with real Docker
 *
 * These tests actually spin up and manage Docker containers to test:
 * - preview start
 * - preview stop
 * - Data persistence across preview stop/start
 *
 * Note: These tests require Docker to be available and will use ports 8889/3307
 * to avoid conflicts with the main test environment on 8888/3306
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { join } from "path";
import { rm, mkdir } from "fs/promises";
import { waitForWordPress } from "./util";

const CLI_PATH = join(import.meta.dir, "../../dist/elementor-cli");
const TEST_DIR = join(import.meta.dir, "test-preview-env");
const CONFIG_PATH = join(TEST_DIR, ".elementor-cli.yaml");
const COMPOSE_PATH = join(TEST_DIR, "docker-compose.recovery.yml");
const ENV_PATH = join(TEST_DIR, ".env");
const PREVIEW_COMPOSE_ARGS = [
  "--compose-file",
  "docker-compose.recovery.yml",
  "--env-file",
  ".env",
  "--project-name",
  "elementor-cli-preview-test",
];

/**
 * Run the CLI with given arguments
 */
async function runCli(
  args: string[],
  options: { cwd?: string; input?: string } = {},
): Promise<{
  stdout: string;
  stderr: string;
  output: string;
  exitCode: number;
}> {
  const proc = spawn({
    cmd: [CLI_PATH, ...args],
    cwd: options.cwd || TEST_DIR,
    env: {
      ...process.env,
      ELEMENTOR_CLI_CONFIG: CONFIG_PATH,
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: options.input ? "pipe" : undefined,
  });

  // Send input if provided
  if (options.input && proc.stdin) {
    proc.stdin.write(options.input);
    proc.stdin.end();
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // Combine stdout and stderr for easier assertions
  const output = stdout + stderr;

  return { stdout, stderr, output, exitCode };
}

/**
 * Run docker compose directly
 */
async function dockerCompose(
  args: string[],
): Promise<{ stdout: string; exitCode: number }> {
  const proc = spawn({
    // Use the main compose file and the generated .env file
    cmd: [
      "docker",
      "compose",
      "-f",
      COMPOSE_PATH,
      "--env-file",
      ENV_PATH,
      "--project-name",
      "elementor-cli-preview-test",
      ...args,
    ],
    cwd: TEST_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

describe("E2E: preview commands with Docker", () => {
  beforeAll(async () => {
    // Build the CLI first
    const buildProc = spawn({
      cmd: ["bun", "run", "build"],
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    await buildProc.exited;

    // Create test directory
    await mkdir(TEST_DIR, { recursive: true });

    // Create a .env file to configure the docker-compose template
    const envContent = `
COMPOSE_PROJECT_NAME=env-project-should-be-overridden
WORDPRESS_PORT=8889
MYSQL_PORT=3307
`;
    await Bun.write(ENV_PATH, envContent);

    // Create test config
    const configContent = `
defaultSite: test
sites:
  test:
    url: http://localhost:8889
    username: admin
    appPassword: test123
staging:
  path: .
  service: wordpress
  url: http://localhost:8889
  wpCommand: wp
pagesDir: .elementor-cli/pages
`;
    await Bun.write(CONFIG_PATH, configContent);

    // Create a nonstandard Compose file for the preview environment
    const composeContent = `services:
  wordpress:
    image: wordpress:6.7-php8.2
    container_name: elementor-cli-preview-test-wp
    ports:
      - "\${WORDPRESS_PORT}:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress
      WORDPRESS_DB_NAME: wordpress
      WORDPRESS_DEBUG: 1
    volumes:
      - wordpress_data:/var/www/html
    depends_on:
      - db

  db:
    image: mysql:8.0
    container_name: elementor-cli-preview-test-db
    command: --default-authentication-plugin=mysql_native_password
    ports:
      - "\${MYSQL_PORT}:3306"
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: wordpress
      MYSQL_ROOT_PASSWORD: rootpassword
    volumes:
      - db_data:/var/lib/mysql

volumes:
  wordpress_data:
  db_data:
`;
    await Bun.write(COMPOSE_PATH, composeContent);

    // Clean up any existing containers from previous runs
    await dockerCompose(["down", "-v"]);
  }, 60000);

  afterAll(async () => {
    // Clean up containers and volumes
    await dockerCompose(["down", "-v"]);

    // Remove test directory
    await rm(TEST_DIR, { recursive: true, force: true });
  }, 30000);

  describe("preview lifecycle", () => {
    test("preview start spins up containers", async () => {
      const { output, exitCode } = await runCli([
        "preview",
        "start",
        ...PREVIEW_COMPOSE_ARGS,
      ]);

      expect(output).toContain("started");
      expect(exitCode).toBe(0);

      const projectNetwork = spawn({
        cmd: ["docker", "network", "inspect", "elementor-cli-preview-test_default"],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await projectNetwork.exited).toBe(0);

      // Wait for WordPress to be ready
      const isReady = await waitForWordPress(8889, 120000); // Increased timeout
      expect(isReady).toBe(true);
    }, 120000);

    test("preview status shows running containers", async () => {
      const { output, exitCode } = await runCli([
        "preview",
        "status",
        ...PREVIEW_COMPOSE_ARGS,
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Running: Yes");
      expect(output).toContain("http://localhost:8889");
    }, 30000);

    test("can create a marker file to test persistence", async () => {
      // Create a marker file in the WordPress volume
      const proc = spawn({
        cmd: [
          "docker",
          "exec",
          "elementor-cli-preview-test-wp",
          "touch",
          "/var/www/html/test-marker.txt",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    }, 10000);

    test("preview stop preserves data by default", async () => {
      const { output, exitCode } = await runCli([
        "preview",
        "stop",
        ...PREVIEW_COMPOSE_ARGS,
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("stopped");

      // Verify containers are stopped
      const { stdout } = await dockerCompose(["ps"]);
      expect(stdout).not.toContain("Up");
    }, 30000);

    test("preview start after stop preserves data", async () => {
      // Start again
      const { exitCode } = await runCli([
        "preview",
        "start",
        ...PREVIEW_COMPOSE_ARGS,
      ]);
      expect(exitCode).toBe(0);

      // Wait for WordPress
      const isReady = await waitForWordPress(8889, 120000);
      expect(isReady).toBe(true);

      // Check if marker file still exists
      const checkProc = spawn({
        cmd: [
          "docker",
          "exec",
          "elementor-cli-preview-test-wp",
          "test",
          "-f",
          "/var/www/html/test-marker.txt",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      const checkExitCode = await checkProc.exited;
      expect(checkExitCode).toBe(0); // File exists
    }, 120000);

    test("preview stop after restart", async () => {
      const { output, exitCode } = await runCli([
        "preview",
        "stop",
        ...PREVIEW_COMPOSE_ARGS,
      ]);

      expect(exitCode).toBe(0);
      expect(output).toContain("stopped");
    }, 30000);
  });
});
