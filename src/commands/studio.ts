import { Command } from "commander";
import { spawn } from "node:child_process";
import { createStudioServer } from "../studio/server.js";
import { logger } from "../utils/logger.js";

export const studioCommand = new Command("studio")
  .description("Start the web-based Studio UI for side-by-side page editing")
  .option("-p, --port <port>", "Port to run the server on", "3000")
  .option("-s, --site <name>", "Site name from config")
  .option("--no-open", "Don't open browser automatically")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli studio                    Start Studio on port 3000
  $ elementor-cli studio --port 8000        Use custom port
  $ elementor-cli studio --site production  Use specific site config
  $ elementor-cli studio --no-open          Don't open browser

The Studio provides:
  - Side-by-side view of production and staging
  - Quick sync, pull, and push operations
  - CSS regeneration controls
  - Real-time staging status monitoring

Prerequisites:
  - Configure a site: elementor-cli config add
  - For staging preview: elementor-cli preview start

See also:
  elementor-cli preview    Manage staging environment
  elementor-cli sync       Sync pages to staging
  elementor-cli push       Push changes to production
`
  )
  .action(async (options) => {
    try {
      const port = parseInt(options.port, 10);

      if (isNaN(port) || port < 1 || port > 65535) {
        logger.error("Invalid port number. Must be between 1 and 65535.");
        process.exit(1);
      }

      const spinner = logger.spinner("Starting Studio server...");

      const studio = await createStudioServer({
        port,
        site: options.site,
      });

      spinner.succeed(`Studio running at ${studio.url}`);
      logger.info("\nPress Ctrl+C to stop the server.\n");

      // Open browser if not disabled
      if (options.open !== false) {
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";

        spawn(openCmd, [studio.url], { detached: true, stdio: "ignore" }).unref();
      }

      // Handle shutdown
      process.on("SIGINT", () => {
        logger.info("\nShutting down Studio...");
        studio.stop();
        process.exit(0);
      });

      process.on("SIGTERM", () => {
        studio.stop();
        process.exit(0);
      });

      // Keep the process running
      await new Promise(() => {});
    } catch (error) {
      logger.error(`Failed to start Studio: ${error}`);
      process.exit(1);
    }
  });
