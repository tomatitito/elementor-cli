import { Command } from "commander";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { readConfig, getSiteConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { confirmAction } from "../utils/prompts.js";
import { DockerManager } from "../services/docker-manager.js";

const DUMPS_DIR = ".elementor-cli/dumps";

export const dbCommand = new Command("db").description(
  "Database backup and restore operations"
);

// db dump
dbCommand
  .command("dump")
  .description("Create a database dump from staging or remote site")
  .option("-o, --output <file>", "Output file path")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .option("--ssh <connection>", "SSH connection string (user@host) for remote dump")
  .option("--ssh-path <path>", "WordPress path on remote server (default: ~/public_html)")
  .option("-s, --site <name>", "Site name (used for output filename with --ssh)")
  .addHelpText(
    "after",
    `
Examples:
  # Dump from local staging (Docker)
  $ elementor-cli db dump                       Dump to default location
  $ elementor-cli db dump --output backup.sql   Dump to specific file

  # Dump from remote site via SSH
  $ elementor-cli db dump --ssh user@example.com
  $ elementor-cli db dump --ssh user@example.com --ssh-path /var/www/html
  $ elementor-cli db dump --ssh user@example.com --site production -o prod-backup.sql

The dump is saved to:
  .elementor-cli/dumps/<site>-<timestamp>.sql

SSH Requirements:
  - SSH access to the remote server
  - WP-CLI installed on the remote server
  - WordPress installation in --ssh-path or ~/public_html

See also:
  elementor-cli db restore    Restore a database dump
  elementor-cli db list       List available dumps
`
  )
  .action(async (options) => {
    try {
      let sql: string;
      let siteName: string = "staging";

      if (options.ssh) {
        // SSH mode: dump from remote server
        if (options.site) {
          siteName = options.site;
        } else {
          // Try to infer site name from SSH host
          const host = options.ssh.split("@").pop() || "remote";
          siteName = host.replace(/\./g, "-");
        }

        const wpPath = options.sshPath || "~/public_html";
        const spinner = logger.spinner(`Connecting to ${options.ssh}...`);

        sql = await runSshDump(options.ssh, wpPath, spinner);

        if (!sql || sql.trim().length === 0) {
          spinner.fail("Database dump is empty");
          process.exit(1);
        }

        spinner.succeed(`Database dump received from ${options.ssh}`);
      } else {
        // Local staging mode: dump from Docker
        const docker = await DockerManager.create(options.composeFile);

        // Check if staging is running
        const status = await docker.getStatus();
        if (!status.running) {
          logger.error("Staging environment is not running.");
          logger.info("Run 'elementor-cli preview start' first.");
          logger.info("For remote sites, use: --ssh user@host");
          process.exit(1);
        }

        const spinner = logger.spinner("Creating database dump...");

        // Get dump from WP-CLI
        sql = await docker.dbDump();
        spinner.succeed("Database dump created");
      }

      // Determine output path
      let outputPath: string;
      if (options.output) {
        outputPath = options.output;
      } else {
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        await mkdir(`${process.cwd()}/${DUMPS_DIR}`, { recursive: true });
        outputPath = `${DUMPS_DIR}/${siteName}-${timestamp}.sql`;
      }

      // Write dump to file
      await Bun.write(`${process.cwd()}/${outputPath}`, sql);

      logger.success(`Database dump saved: ${outputPath}`);
      logger.dim(`Size: ${formatBytes(sql.length)}`);
    } catch (error) {
      logger.error(`Failed to create dump: ${error}`);
      process.exit(1);
    }
  });

async function runSshDump(
  sshConnection: string,
  wpPath: string,
  spinner: { text: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use WP-CLI on the remote server to export the database
    const sshCommand = `cd ${wpPath} && wp db export --skip-ssl -`;

    spinner.text = `Running database export on ${sshConnection}...`;

    const proc = spawn("ssh", [sshConnection, sshCommand], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      reject(new Error(`SSH connection failed: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        // Check for common errors
        if (stderr.includes("wp: command not found")) {
          reject(new Error("WP-CLI is not installed on the remote server"));
        } else if (stderr.includes("Permission denied")) {
          reject(new Error("SSH permission denied. Check your SSH key or credentials."));
        } else if (stderr.includes("No such file or directory")) {
          reject(new Error(`WordPress not found at ${wpPath}. Use --ssh-path to specify the correct path.`));
        } else {
          reject(new Error(stderr || `SSH command failed with code ${code}`));
        }
      }
    });
  });
}

// db restore
dbCommand
  .command("restore <file>")
  .description("Restore a database dump to staging")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .option("-f, --force", "Skip confirmation")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli db restore .elementor-cli/dumps/staging-2024-01-27.sql
  $ elementor-cli db restore backup.sql --force

WARNING: This will overwrite the staging database!

See also:
  elementor-cli db dump     Create a database dump
  elementor-cli db list     List available dumps
`
  )
  .action(async (file, options) => {
    try {
      const docker = await DockerManager.create(options.composeFile);

      // Check if file exists
      const sqlFile = Bun.file(file);
      if (!(await sqlFile.exists())) {
        logger.error(`File not found: ${file}`);
        process.exit(1);
      }

      // Check if staging is running
      const status = await docker.getStatus();
      if (!status.running) {
        logger.error("Staging environment is not running.");
        logger.info("Run 'elementor-cli preview start' first.");
        process.exit(1);
      }

      if (!options.force) {
        const confirmed = await confirmAction(
          "This will overwrite the staging database. Continue?"
        );
        if (!confirmed) {
          logger.info("Cancelled.");
          return;
        }
      }

      const spinner = logger.spinner("Restoring database...");

      const sql = await sqlFile.text();
      await docker.dbRestore(sql);

      spinner.succeed("Database restored successfully.");
      logger.dim(`Restored from: ${file}`);
    } catch (error) {
      logger.error(`Failed to restore database: ${error}`);
      process.exit(1);
    }
  });

// db list
dbCommand
  .command("list")
  .description("List available database dumps")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli db list

See also:
  elementor-cli db dump       Create a database dump
  elementor-cli db restore    Restore a database dump
`
  )
  .action(async () => {
    try {
      const dumpsDir = `${process.cwd()}/${DUMPS_DIR}`;

      const glob = new Bun.Glob("*.sql");
      const dumps: Array<{ name: string; size: number; modified: Date }> = [];

      try {
        for await (const file of glob.scan({ cwd: dumpsDir })) {
          const fullPath = `${dumpsDir}/${file}`;
          const bunFile = Bun.file(fullPath);
          const stat = await Bun.file(fullPath).stat();
          if (stat) {
            dumps.push({
              name: file,
              size: bunFile.size,
              modified: new Date(stat.mtime),
            });
          }
        }
      } catch {
        // Directory doesn't exist
      }

      if (dumps.length === 0) {
        logger.info("No database dumps found.");
        logger.dim(`Dumps are stored in: ${DUMPS_DIR}/`);
        return;
      }

      // Sort by modified date, newest first
      dumps.sort((a, b) => b.modified.getTime() - a.modified.getTime());

      logger.heading("Available Database Dumps");
      console.log(
        "File".padEnd(50) +
          "Size".padEnd(12) +
          "Created"
      );
      console.log("─".repeat(80));

      for (const dump of dumps) {
        console.log(
          dump.name.padEnd(50) +
            formatBytes(dump.size).padEnd(12) +
            formatDate(dump.modified.toISOString())
        );
      }

      console.log("");
      logger.dim(`${dumps.length} dump(s) found in ${DUMPS_DIR}/`);
    } catch (error) {
      logger.error(`Failed to list dumps: ${error}`);
      process.exit(1);
    }
  });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
