import { spawn } from "node:child_process";
import type { ContainerConfig } from "../types/config.js";

/**
 * Runs WP-CLI commands inside a container (Docker or Podman)
 */
export class ContainerCli {
  private runtime: "docker" | "podman";
  private containerName: string;

  constructor(config: ContainerConfig) {
    this.runtime = config.runtime;
    this.containerName = config.name;
  }

  /**
   * Execute a WP-CLI command inside the container
   */
  async execWpCli(command: string[]): Promise<string> {
    const args = [
      "exec",
      this.containerName,
      "wp",
      "--allow-root",
      ...command,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.runtime, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        reject(
          new Error(`Failed to run ${this.runtime} exec: ${error.message}`)
        );
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(
            new Error(
              stderr || `${this.runtime} exec exited with code ${code}`
            )
          );
        }
      });
    });
  }

  /**
   * Flush all Elementor CSS caches
   */
  async flushElementorCss(): Promise<void> {
    await this.execWpCli(["elementor", "flush-css"]);
  }
}
