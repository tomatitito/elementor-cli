import { spawn } from "node:child_process";
import { mkdir, access, constants } from "node:fs/promises";
import { readConfig } from "../utils/config-store.js";
import type { StagingConfig } from "../types/config.js";

export interface DockerStatus {
  running: boolean;
  services: Array<{
    name: string;
    status: string;
    ports: string[];
  }>;
}

export class DockerManager {
  private composePath: string;
  private service: string;
  private url: string;

  constructor(config: StagingConfig) {
    this.composePath = config.path;
    this.service = config.service;
    this.url = config.url;
  }

  static async create(composeFile?: string): Promise<DockerManager> {
    const config = await readConfig();

    if (composeFile) {
      return new DockerManager({
        ...config.staging,
        path: composeFile.replace(/\/docker-compose\.ya?ml$/, ""),
      });
    }

    return new DockerManager(config.staging);
  }

  getComposeDir(): string {
    return `${process.cwd()}/${this.composePath}`;
  }

  getComposeFilePath(): string {
    return `${this.getComposeDir()}/docker-compose.yml`;
  }

  getUrl(): string {
    return this.url;
  }

  async composeFileExists(): Promise<boolean> {
    try {
      await access(this.getComposeFilePath(), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async runCommand(
    args: string[],
    options: { capture?: boolean } = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", ["compose", ...args], {
        cwd: this.getComposeDir(),
        stdio: options.capture ? ["pipe", "pipe", "pipe"] : "inherit",
      });

      let stdout = "";
      let stderr = "";

      if (options.capture) {
        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });
        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
      }

      proc.on("error", (error) => {
        reject(new Error(`Failed to run docker compose: ${error.message}`));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `docker compose exited with code ${code}`));
        }
      });
    });
  }

  async start(): Promise<void> {
    await this.runCommand(["up", "-d"]);
  }

  async stop(): Promise<void> {
    await this.runCommand(["down"]);
  }

  async getStatus(): Promise<DockerStatus> {
    try {
      const output = await this.runCommand(["ps", "--format", "json"], {
        capture: true,
      });

      if (!output) {
        return { running: false, services: [] };
      }

      const services: DockerStatus["services"] = [];

      // docker compose ps --format json outputs one JSON object per line
      for (const line of output.split("\n")) {
        if (!line.trim()) continue;
        try {
          const container = JSON.parse(line);
          services.push({
            name: container.Service || container.Name,
            status: container.State || container.Status,
            ports: container.Publishers
              ? container.Publishers.map(
                  (p: { PublishedPort: number; TargetPort: number }) =>
                    `${p.PublishedPort}:${p.TargetPort}`
                )
              : [],
          });
        } catch {
          // Skip unparseable lines
        }
      }

      return {
        running: services.some((s) => s.status === "running"),
        services,
      };
    } catch {
      return { running: false, services: [] };
    }
  }

  async execWpCli(command: string[]): Promise<string> {
    const args = ["exec", this.service, "wp", "--allow-root", ...command];
    return this.runCommand(args, { capture: true });
  }

  async updatePostMeta(
    postId: number,
    metaKey: string,
    metaValue: string
  ): Promise<void> {
    await this.execWpCli([
      "post",
      "meta",
      "update",
      String(postId),
      metaKey,
      metaValue,
    ]);
  }

  async flushElementorCss(): Promise<void> {
    try {
      await this.execWpCli(["elementor", "flush-css"]);
    } catch {
      // Elementor WP-CLI might not be available, that's okay
    }
  }

  async createPage(
    title: string,
    status: string = "publish"
  ): Promise<number> {
    const output = await this.execWpCli([
      "post",
      "create",
      "--post_type=page",
      `--post_title=${title}`,
      `--post_status=${status}`,
      "--porcelain",
    ]);
    return parseInt(output.trim(), 10);
  }

  async updatePost(
    postId: number,
    data: { title?: string; status?: string; slug?: string }
  ): Promise<void> {
    const args = ["post", "update", String(postId)];

    if (data.title) args.push(`--post_title=${data.title}`);
    if (data.status) args.push(`--post_status=${data.status}`);
    if (data.slug) args.push(`--post_name=${data.slug}`);

    await this.execWpCli(args);
  }

  async initCompose(): Promise<void> {
    const dir = this.getComposeDir();
    await mkdir(dir, { recursive: true });

    const composeContent = `services:
  wordpress:
    image: wordpress:latest
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wordpress_data:/var/www/html
    depends_on:
      - db

  db:
    image: mysql:8.0
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

    await Bun.write(this.getComposeFilePath(), composeContent);
  }

  async dbDump(): Promise<string> {
    return this.execWpCli(["db", "export", "--skip-ssl", "-"]);
  }

  async hideAdminBar(): Promise<void> {
    try {
      await this.execWpCli(["option", "update", "show_admin_bar_front", "0"]);
    } catch {
      // Option might not exist yet, that's okay
    }
  }

  async dbRestore(sql: string): Promise<void> {
    // Write SQL to temp file and import
    const tempFile = `/tmp/elementor-cli-restore-${Date.now()}.sql`;
    await Bun.write(tempFile, sql);

    // Get the project directory name (last segment of path) for the container name
    const projectName = this.composePath.split("/").filter(Boolean).pop() || "staging";
    const containerName = `${projectName}-${this.service}-1`;

    // Copy file into container and import
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "docker",
        ["cp", tempFile, `${containerName}:/tmp/restore.sql`],
        { stdio: "inherit" }
      );
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Failed to copy SQL file to container`));
      });
    });

    // Use mysql directly with --skip-ssl to avoid SSL errors with containerized MySQL
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "docker",
        [
          "exec",
          containerName,
          "bash",
          "-c",
          "mysql -h db -u wordpress -pwordpress --skip-ssl wordpress < /tmp/restore.sql",
        ],
        { stdio: "inherit" }
      );
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Failed to import database`));
      });
    });

    // Cleanup temp file
    const { unlink } = await import("node:fs/promises");
    await unlink(tempFile).catch(() => {});
  }
}
