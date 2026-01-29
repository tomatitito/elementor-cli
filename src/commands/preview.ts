import { Command } from "commander";
import { spawn } from "node:child_process";
import { readConfig, writeConfig } from "../utils/config-store.js";
import { logger } from "../utils/logger.js";
import { DockerManager } from "../services/docker-manager.js";
import { LocalStore } from "../services/local-store.js";
import { ElementorParser } from "../services/elementor-parser.js";

export const previewCommand = new Command("preview").description(
  "Local Docker staging environment for previewing changes"
);

// preview init
previewCommand
  .command("init")
  .description("Initialize a new staging environment (scaffolds docker-compose.yml)")
  .option("-p, --path <directory>", "Directory to create docker-compose.yml")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli preview init                    Create in .elementor-cli/staging/
  $ elementor-cli preview init --path ./docker    Create in ./docker/

The generated docker-compose.yml includes:
  - WordPress container on port 8080
  - MySQL 8.0 database
  - Persistent volumes for data

See also:
  elementor-cli preview start    Start the staging environment
  elementor-cli preview sync     Sync pages to staging
`
  )
  .action(async (options) => {
    try {
      const config = await readConfig();
      const path = options.path || config.staging.path;

      const docker = new DockerManager({
        ...config.staging,
        path,
      });

      if (await docker.composeFileExists()) {
        logger.warn(`docker-compose.yml already exists at ${docker.getComposeDir()}`);
        logger.info("Use 'elementor-cli preview start' to start the environment.");
        return;
      }

      const spinner = logger.spinner("Creating staging environment...");

      await docker.initCompose();

      // Update config with staging path
      config.staging.path = path;
      await writeConfig(config);

      spinner.succeed(`Created docker-compose.yml at ${docker.getComposeDir()}`);
      logger.info("\nNext steps:");
      logger.dim("  1. Run 'elementor-cli preview start' to start the containers");
      logger.dim("  2. Run 'elementor-cli preview sync <page-id>' to sync pages");
      logger.dim("  3. Run 'elementor-cli preview open' to open in browser");
    } catch (error) {
      logger.error(`Failed to initialize staging: ${error}`);
      process.exit(1);
    }
  });

// preview start
previewCommand
  .command("start")
  .description("Start staging environment (docker compose up -d)")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli preview start
  $ elementor-cli preview start --compose-file ./my-docker/docker-compose.yml

See also:
  elementor-cli preview stop      Stop the environment
  elementor-cli preview status    Check container status
`
  )
  .action(async (options) => {
    try {
      const docker = await DockerManager.create(options.composeFile);

      if (!(await docker.composeFileExists())) {
        logger.error(
          `docker-compose.yml not found at ${docker.getComposeDir()}`
        );
        logger.info("Run 'elementor-cli preview init' to create one.");
        process.exit(1);
      }

      logger.info("Starting staging environment...");
      await docker.start();

      // Hide admin bar for cleaner staging appearance
      try {
        await docker.hideAdminBar();
        logger.dim("Admin bar hidden for staging environment.");
      } catch {
        // WordPress might not be ready yet on first run
      }

      logger.success("Staging environment started!");
      logger.info(`\nAccess WordPress at: ${docker.getUrl()}`);
      logger.dim("Note: WordPress may need a minute to initialize on first run.");
    } catch (error) {
      logger.error(`Failed to start staging: ${error}`);
      process.exit(1);
    }
  });

// preview stop
previewCommand
  .command("stop")
  .description("Stop staging environment (docker compose down)")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli preview stop
  $ elementor-cli preview stop --compose-file ./my-docker/docker-compose.yml

See also:
  elementor-cli preview start     Start the environment
  elementor-cli preview status    Check container status
`
  )
  .action(async (options) => {
    try {
      const docker = await DockerManager.create(options.composeFile);

      logger.info("Stopping staging environment...");
      await docker.stop();

      logger.success("Staging environment stopped.");
    } catch (error) {
      logger.error(`Failed to stop staging: ${error}`);
      process.exit(1);
    }
  });

// preview status
previewCommand
  .command("status")
  .description("Show staging status (container status, URL)")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli preview status

See also:
  elementor-cli preview start     Start the environment
  elementor-cli preview stop      Stop the environment
`
  )
  .action(async (options) => {
    try {
      const docker = await DockerManager.create(options.composeFile);
      const status = await docker.getStatus();

      logger.heading("Staging Environment Status");
      console.log(`  Compose file: ${docker.getComposeFilePath()}`);
      console.log(`  URL: ${docker.getUrl()}`);
      console.log(`  Running: ${status.running ? "Yes" : "No"}`);

      if (status.services.length > 0) {
        console.log("\n  Services:");
        for (const svc of status.services) {
          const ports = svc.ports.length > 0 ? ` (${svc.ports.join(", ")})` : "";
          console.log(`    - ${svc.name}: ${svc.status}${ports}`);
        }
      }
    } catch (error) {
      logger.error(`Failed to get status: ${error}`);
      process.exit(1);
    }
  });

// preview sync
previewCommand
  .command("sync [page-id]")
  .description("Sync local page changes to staging WordPress")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .option("-s, --site <name>", "Site name for local pages")
  .option("-a, --all", "Sync all locally stored pages")
  .option("--no-rewrite-urls", "Disable URL rewriting from production to staging")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli preview sync 42              Sync single page
  $ elementor-cli preview sync --all           Sync all local pages
  $ elementor-cli preview sync 42 --site prod  Sync page from specific site
  $ elementor-cli preview sync 42 --no-rewrite-urls  Keep original URLs

This command:
  1. Reads local page data from .elementor-cli/pages/
  2. Rewrites asset URLs from production to staging (unless --no-rewrite-urls)
  3. Creates or updates the page in staging WordPress
  4. Updates Elementor meta (_elementor_data, _elementor_page_settings)
  5. Flushes Elementor CSS cache

See also:
  elementor-cli pull             Download pages from remote
  elementor-cli preview open     Open page in browser
`
  )
  .action(async (pageId, options) => {
    try {
      const docker = await DockerManager.create(options.composeFile);
      const store = await LocalStore.create();
      const parser = new ElementorParser();
      const config = await readConfig();

      const siteName = options.site || config.defaultSite;
      if (!siteName) {
        logger.error("No site specified and no default site configured.");
        process.exit(1);
      }

      // Get source site URL for URL rewriting
      const siteConfig = config.sites[siteName];
      const sourceUrl = siteConfig?.url;
      const targetUrl = config.staging.url;
      const shouldRewriteUrls = options.rewriteUrls !== false && sourceUrl && targetUrl;

      if (shouldRewriteUrls) {
        logger.dim(`URL rewriting enabled: ${sourceUrl} → ${targetUrl}`);
      }

      // Check if staging is running
      const status = await docker.getStatus();
      if (!status.running) {
        logger.error("Staging environment is not running.");
        logger.info("Run 'elementor-cli preview start' first.");
        process.exit(1);
      }

      let pagesToSync: number[] = [];

      if (options.all) {
        pagesToSync = await store.listLocalPages(siteName);
        if (pagesToSync.length === 0) {
          logger.info("No local pages found to sync.");
          return;
        }
        logger.info(`Found ${pagesToSync.length} page(s) to sync.`);
      } else if (pageId) {
        pagesToSync = [parseInt(pageId, 10)];
      } else {
        logger.error("Please specify a page ID or use --all flag.");
        process.exit(1);
      }

      let synced = 0;

      for (const id of pagesToSync) {
        const localData = await store.loadPage(siteName, id);
        if (!localData) {
          logger.warn(`Page ${id} not found locally. Skipped.`);
          continue;
        }

        const spinner = logger.spinner(`Syncing page ${id}...`);

        try {
          // Try to update existing page, or create new one
          try {
            await docker.updatePost(id, {
              title: localData.meta.title,
              slug: localData.meta.slug,
              status: localData.meta.status,
            });
          } catch {
            // Page doesn't exist in staging, create it
            const newId = await docker.createPage(
              localData.meta.title,
              localData.meta.status
            );
            logger.dim(`  Created new page in staging (ID: ${newId})`);
          }

          // Prepare elements and settings (with optional URL rewriting)
          let elements = localData.elements;
          let settings = localData.settings;

          if (shouldRewriteUrls) {
            elements = parser.rewriteUrls(elements, sourceUrl, targetUrl);
            settings = parser.rewriteSettingsUrls(settings, sourceUrl, targetUrl);
          }

          // Update Elementor meta
          await docker.updatePostMeta(
            id,
            "_elementor_edit_mode",
            "builder"
          );
          await docker.updatePostMeta(
            id,
            "_elementor_data",
            parser.serializeElements(elements)
          );
          await docker.updatePostMeta(
            id,
            "_elementor_page_settings",
            parser.serializeSettings(settings)
          );

          // Flush CSS cache
          await docker.flushElementorCss();

          spinner.succeed(`Synced page ${id}: "${localData.meta.title}"`);
          synced++;
        } catch (error) {
          spinner.fail(`Failed to sync page ${id}: ${error}`);
        }
      }

      console.log("");
      logger.success(`Synced ${synced} page(s) to staging.`);
      logger.info(`View at: ${docker.getUrl()}`);
    } catch (error) {
      logger.error(`Sync failed: ${error}`);
      process.exit(1);
    }
  });

// preview open
previewCommand
  .command("open [page-id]")
  .description("Open staging in browser")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli preview open          Open staging home page
  $ elementor-cli preview open 42       Open specific page

See also:
  elementor-cli preview status    Check staging status
  elementor-cli preview sync      Sync pages to staging
`
  )
  .action(async (pageId, options) => {
    try {
      const docker = await DockerManager.create(options.composeFile);

      let url = docker.getUrl();
      if (pageId) {
        url = `${url}/?p=${pageId}`;
      }

      logger.info(`Opening ${url}...`);

      // Open in browser based on OS
      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";

      spawn(openCmd, [url], { detached: true, stdio: "ignore" }).unref();
    } catch (error) {
      logger.error(`Failed to open browser: ${error}`);
      process.exit(1);
    }
  });
