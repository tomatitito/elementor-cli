import { Command } from "commander";
import { getSiteConfig, readConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { confirmAction } from "../utils/prompts.js";
import { LocalStore } from "../services/local-store.js";

export const stagesCommand = new Command("stages").description(
  "Manage local staging pages"
);

// stages list
stagesCommand
  .command("list")
  .description("List locally stored pages for the staging site")
  .option("-s, --site <name>", "Site name from config", "staging")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli stages list
  $ elementor-cli stages list --site production

See also:
  elementor-cli stages delete   Delete a local page
  elementor-cli pages list      List remote pages
`
  )
  .action(async (options) => {
    try {
      const siteName = options.site;
      const store = await LocalStore.create();
      const pageIds = await store.listLocalPages(siteName);

      if (pageIds.length === 0) {
        logger.info(`No local pages found for site "${siteName}".`);
        return;
      }

      logger.heading(`Local Pages (${siteName})`);
      console.log(
        "ID".padEnd(8) +
          "Title".padEnd(40) +
          "Status".padEnd(12) +
          "Pulled At"
      );
      console.log("─".repeat(75));

      for (const pageId of pageIds) {
        const meta = await store.loadMeta(siteName, pageId);
        const pulledAt = await store.getPulledAt(siteName, pageId);

        const title = meta?.title || "(no title)";
        const displayTitle = title.slice(0, 38) + (title.length > 38 ? "…" : "");
        const status = meta?.status || "unknown";
        const pulledDate = pulledAt ? formatDate(pulledAt) : "N/A";

        console.log(
          String(pageId).padEnd(8) +
            displayTitle.padEnd(40) +
            status.padEnd(12) +
            pulledDate
        );
      }

      logger.dim(`\n${pageIds.length} local page(s) found.`);
    } catch (error) {
      logger.error(`Failed to list local pages: ${error}`);
      process.exit(1);
    }
  });

// stages delete
stagesCommand
  .command("delete <page-id>")
  .description("Delete a locally stored page")
  .option("-s, --site <name>", "Site name from config", "staging")
  .option("-f, --force", "Skip confirmation")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli stages delete 42
  $ elementor-cli stages delete 42 --force
  $ elementor-cli stages delete 42 --site production

See also:
  elementor-cli stages list     List local pages
`
  )
  .action(async (pageId, options) => {
    try {
      const siteName = options.site;
      const store = await LocalStore.create();
      const id = parseInt(pageId, 10);

      const exists = await store.pageExists(siteName, id);
      if (!exists) {
        logger.error(`Local page ${id} not found for site "${siteName}".`);
        process.exit(1);
      }

      if (!options.force) {
        const confirmed = await confirmAction(
          `Delete local page ${id}? This removes the local files only.`
        );
        if (!confirmed) {
          logger.info("Cancelled.");
          return;
        }
      }

      const deleted = await store.deletePage(siteName, id);
      if (deleted) {
        logger.success(`Deleted local page ${id}`);
      } else {
        logger.error(`Failed to delete local page ${id}`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Failed to delete local page: ${error}`);
      process.exit(1);
    }
  });
