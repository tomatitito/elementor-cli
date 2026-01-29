import { Command } from "commander";
import { mkdir, chmod, access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { logger } from "../utils/logger.js";
import pkg from "../../package.json";

const GITHUB_REPO = "tomatitito/elementor-cli";
const INSTALL_DIR = `${homedir()}/.local/bin`;
const BINARY_NAME = "elementor-cli";

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

function getPlatformBinaryName(): string {
  const platform = process.platform;
  const arch = process.arch;

  let os: string;
  if (platform === "darwin") {
    os = "darwin";
  } else if (platform === "linux") {
    os = "linux";
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  let archName: string;
  if (arch === "x64") {
    archName = "x64";
  } else if (arch === "arm64") {
    archName = "arm64";
  } else {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  return `elementor-cli-${os}-${archName}`;
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = version.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a);
  const vB = parseVersion(b);

  if (vA.major !== vB.major) return vA.major - vB.major;
  if (vA.minor !== vB.minor) return vA.minor - vB.minor;
  return vA.patch - vB.patch;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "elementor-cli",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("No releases found. The project may not have any releases yet.");
    }
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<GitHubRelease>;
}

async function downloadBinary(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await Bun.write(destPath, buffer);
}

async function isPathInPath(dir: string): Promise<boolean> {
  const pathEnv = process.env.PATH || "";
  return pathEnv.split(":").includes(dir);
}

async function ensureInstallDir(): Promise<void> {
  try {
    await access(INSTALL_DIR, constants.W_OK);
  } catch {
    await mkdir(INSTALL_DIR, { recursive: true });
  }
}

export const updateCommand = new Command("update")
  .description("Check for updates and install the latest version")
  .option("-c, --check", "Only check for updates without installing")
  .option("-v, --version <version>", "Install a specific version (e.g., v0.3.0)")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli update                   Install latest version
  $ elementor-cli update --check           Check for updates without installing
  $ elementor-cli update --version v0.3.0  Install specific version

The binary will be installed to ~/.local/bin/elementor-cli.
Make sure ~/.local/bin is in your PATH.
`
  )
  .action(async (options) => {
    try {
      const currentVersion = pkg.version;
      logger.info(`Current version: ${currentVersion}`);

      // Fetch release info
      const spinner = logger.spinner("Checking for updates...");

      let release: GitHubRelease;
      try {
        if (options.version) {
          // Fetch specific version
          const tag = options.version.startsWith("v") ? options.version : `v${options.version}`;
          const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`;
          const response = await fetch(url, {
            headers: {
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "elementor-cli",
            },
          });
          if (!response.ok) {
            throw new Error(`Version ${options.version} not found`);
          }
          release = await response.json() as GitHubRelease;
        } else {
          release = await fetchLatestRelease();
        }
      } catch (error) {
        spinner.fail(`Failed to check for updates: ${error}`);
        process.exit(1);
      }

      const latestVersion = release.tag_name.replace(/^v/, "");
      spinner.stop();
      logger.info(`Latest version: ${latestVersion}`);

      // Compare versions
      const comparison = compareVersions(latestVersion, currentVersion);

      if (comparison <= 0 && !options.version) {
        logger.success("You're already on the latest version!");
        return;
      }

      if (options.check) {
        if (comparison > 0) {
          logger.info(`\nA new version is available: ${latestVersion}`);
          logger.dim("Run 'elementor-cli update' to install it.");
        }
        return;
      }

      // Find the right binary for this platform
      const binaryName = getPlatformBinaryName();
      const tarballName = `${binaryName}.tar.gz`;
      const asset = release.assets.find((a) => a.name === tarballName);

      if (!asset) {
        logger.error(`No binary available for your platform (${binaryName})`);
        logger.dim("Available assets:");
        for (const a of release.assets) {
          logger.dim(`  - ${a.name}`);
        }
        process.exit(1);
      }

      // Download the binary
      const downloadSpinner = logger.spinner(`Downloading ${tarballName}...`);

      try {
        await ensureInstallDir();
        const tempTarPath = `${INSTALL_DIR}/${tarballName}`;
        await downloadBinary(asset.browser_download_url, tempTarPath);

        downloadSpinner.text = "Extracting...";

        // Extract the tarball
        const { spawn } = await import("node:child_process");
        await new Promise<void>((resolve, reject) => {
          const proc = spawn("tar", ["xzf", tarballName, "-C", INSTALL_DIR], {
            cwd: INSTALL_DIR,
            stdio: "pipe",
          });
          proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`tar extraction failed with code ${code}`));
          });
          proc.on("error", reject);
        });

        // Rename the extracted binary to elementor-cli
        const extractedName = binaryName;
        const finalPath = `${INSTALL_DIR}/${BINARY_NAME}`;
        const extractedPath = `${INSTALL_DIR}/${extractedName}`;

        // Remove old binary if it exists
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(finalPath);
        } catch {
          // File might not exist
        }

        // Rename extracted binary
        const { rename } = await import("node:fs/promises");
        await rename(extractedPath, finalPath);

        // Set executable permissions
        await chmod(finalPath, 0o755);

        // Cleanup tarball
        const { unlink } = await import("node:fs/promises");
        await unlink(tempTarPath).catch(() => {});

        downloadSpinner.succeed(`Installed to ${finalPath}`);

        // Check if install dir is in PATH
        const inPath = await isPathInPath(INSTALL_DIR);
        if (!inPath) {
          console.log("");
          logger.warn(`${INSTALL_DIR} is not in your PATH.`);
          logger.info("Add this to your shell profile (~/.bashrc or ~/.zshrc):");
          logger.dim(`  export PATH="${INSTALL_DIR}:$PATH"`);
        }

        console.log("");
        logger.success(`Updated to version ${latestVersion}!`);

        // Show release notes if available
        if (release.body) {
          console.log("");
          logger.heading("What's New");
          // Show first few lines of release notes
          const lines = release.body.split("\n").slice(0, 10);
          for (const line of lines) {
            console.log(`  ${line}`);
          }
          if (release.body.split("\n").length > 10) {
            logger.dim("  ...");
          }
        }
      } catch (error) {
        downloadSpinner.fail(`Installation failed: ${error}`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Update failed: ${error}`);
      process.exit(1);
    }
  });
