/**
 * E2E Test Setup Utilities
 *
 * Provides helpers for spinning up WordPress + Elementor containers,
 * waiting for services to be ready, and cleaning up after tests.
 */

import { spawn, type Subprocess } from "bun";
import { join } from "path";

const E2E_DIR = import.meta.dir;
const COMPOSE_FILE = join(E2E_DIR, "docker-compose.yml");
const TEST_URL = "http://localhost:8888";

export interface TestCredentials {
  username: string;
  password: string;
  url: string;
}

export interface TestPages {
  simple: number;
  complex: number;
  draft: number;
  nonElementor: number;
}

export interface TestEnvironment {
  url: string;
  credentials: TestCredentials;
  pages: TestPages;
  cleanup: () => Promise<void>;
}

/**
 * Execute a command and return the output
 */
async function exec(
  cmd: string,
  args: string[],
  options?: { cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawn({
    cmd: [cmd, ...args],
    cwd: options?.cwd ?? E2E_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Check if a URL is accessible
 */
async function isUrlAccessible(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok || response.status === 302;
  } catch {
    return false;
  }
}

/**
 * Wait for a condition to be true
 */
async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number; message?: string } = {}
): Promise<void> {
  const { timeout = 120000, interval = 2000, message = "condition" } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await Bun.sleep(interval);
  }

  throw new Error(`Timeout waiting for ${message} after ${timeout}ms`);
}

/**
 * Start the e2e test environment
 */
export async function startTestEnvironment(): Promise<void> {
  console.log("Starting e2e test environment...");

  // Start containers
  const { exitCode, stderr } = await exec("docker", [
    "compose",
    "-f",
    COMPOSE_FILE,
    "up",
    "-d",
  ]);

  if (exitCode !== 0) {
    throw new Error(`Failed to start containers: ${stderr}`);
  }

  // Wait for WordPress to be accessible
  console.log("Waiting for WordPress to be ready...");
  await waitFor(() => isUrlAccessible(TEST_URL), {
    timeout: 120000,
    message: "WordPress to be accessible",
  });

  // Wait for seed script to complete (check for test-pages.json via docker cp)
  console.log("Waiting for seed script to complete...");
  await waitFor(
    async () => {
      const { exitCode } = await exec("docker", [
        "cp",
        "elementor-cli-test-wp:/var/www/html/wp-content/test-pages.json",
        "/tmp/test-pages-check.json",
      ]);
      return exitCode === 0;
    },
    {
      timeout: 180000,
      interval: 5000,
      message: "seed script to complete",
    }
  );

  console.log("E2E test environment is ready!");
}

/**
 * Stop the e2e test environment
 */
export async function stopTestEnvironment(
  removeVolumes: boolean = false
): Promise<void> {
  console.log("Stopping e2e test environment...");

  const args = ["compose", "-f", COMPOSE_FILE, "down"];
  if (removeVolumes) {
    args.push("-v");
  }

  await exec("docker", args);
  console.log("E2E test environment stopped.");
}

/**
 * Get test credentials from the running container
 */
export async function getTestCredentials(): Promise<TestCredentials> {
  const tempFile = "/tmp/test-credentials.txt";
  const { exitCode } = await exec("docker", [
    "cp",
    "elementor-cli-test-wp:/var/www/html/wp-content/test-credentials.txt",
    tempFile,
  ]);

  if (exitCode !== 0) {
    throw new Error("Failed to get test credentials");
  }

  const content = await Bun.file(tempFile).text();
  const [username, password] = content.trim().split(":");

  return {
    username,
    password,
    url: TEST_URL,
  };
}

/**
 * Get test page IDs from the running container
 */
export async function getTestPages(): Promise<TestPages> {
  const tempFile = "/tmp/test-pages.json";
  const { exitCode } = await exec("docker", [
    "cp",
    "elementor-cli-test-wp:/var/www/html/wp-content/test-pages.json",
    tempFile,
  ]);

  if (exitCode !== 0) {
    throw new Error("Failed to get test page IDs");
  }

  const content = await Bun.file(tempFile).text();
  return JSON.parse(content);
}

/**
 * Check if the test environment is running
 */
export async function isTestEnvironmentRunning(): Promise<boolean> {
  const { stdout } = await exec("docker", [
    "compose",
    "-f",
    COMPOSE_FILE,
    "ps",
    "--format",
    "json",
  ]);

  if (!stdout) return false;

  try {
    // Docker compose ps --format json returns one JSON object per line
    const lines = stdout.split("\n").filter((line) => line.trim());
    const containers = lines.map((line) => JSON.parse(line));
    const wpContainer = containers.find(
      (c: { Name: string }) => c.Name === "elementor-cli-test-wp"
    );
    return wpContainer?.State === "running";
  } catch {
    return false;
  }
}

/**
 * Execute WP-CLI command in the test container
 */
export async function wpCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return exec("docker", [
    "exec",
    "elementor-cli-test-wp",
    "wp",
    "--path=/var/www/html",
    ...args,
  ]);
}

/**
 * Create a temporary config file for testing
 */
export async function createTestConfig(
  configPath: string,
  credentials: TestCredentials
): Promise<void> {
  const config = `
sites:
  test:
    url: "${credentials.url}"
    username: "${credentials.username}"
    appPassword: "${credentials.password}"
defaultSite: test
`;

  await Bun.write(configPath, config);
}

/**
 * Setup the full test environment and return helpers
 */
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  // Start containers if not running
  if (!(await isTestEnvironmentRunning())) {
    await startTestEnvironment();
  }

  const credentials = await getTestCredentials();
  const pages = await getTestPages();

  return {
    url: TEST_URL,
    credentials,
    pages,
    cleanup: async () => {
      await stopTestEnvironment(true);
    },
  };
}

/**
 * Global setup for all e2e tests - call once at the start
 */
export async function globalSetup(): Promise<TestEnvironment> {
  console.log("\n=== E2E Test Global Setup ===\n");
  return setupTestEnvironment();
}

/**
 * Global teardown for all e2e tests - call once at the end
 */
export async function globalTeardown(removeVolumes: boolean = true): Promise<void> {
  console.log("\n=== E2E Test Global Teardown ===\n");
  await stopTestEnvironment(removeVolumes);
}
