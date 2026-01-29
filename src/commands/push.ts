import { Command } from "commander";
import { getSiteConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { confirmAction } from "../utils/prompts.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { LocalStore } from "../services/local-store.js";
import { ElementorParser } from "../services/elementor-parser.js";

export const pushCommand = new Command("push")
  .description("Upload local changes to WordPress")
  .argument("[page-ids...]", "Page ID(s) to push")
  .option("-s, --site <name>", "Site name from config")
  .option("-a, --all", "Push all locally modified pages")
  .option("-f, --force", "Force push even if remote has changed")
  .option("-n, --dry-run", "Show what would be pushed without making changes")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli push 42                    Push single page
  $ elementor-cli push 42 156                Push multiple pages
  $ elementor-cli push --all                 Push all local pages
  $ elementor-cli push 42 --force            Overwrite remote changes
  $ elementor-cli push 42 --dry-run          Preview changes
  $ elementor-cli push 42 --site production  Push to specific site

Safety features:
  - Compares timestamps to detect conflicts
  - Requires --force if remote has been modified
  - WordPress creates a revision before overwriting

See also:
  elementor-cli pull           Download pages
  elementor-cli diff           Compare local vs remote
  elementor-cli revisions      View/restore backups
`
  )
  .action(async (pageIds: string[], options) => {
    try {
      const { name: siteName, config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);
      const store = await LocalStore.create();
      const parser = new ElementorParser();

      let pagesToPush: number[] = [];

      if (options.all) {
        pagesToPush = await store.listLocalPages(siteName);
        if (pagesToPush.length === 0) {
          logger.info("No local pages found to push.");
          return;
        }
        logger.info(`Found ${pagesToPush.length} local page(s) to push.`);
      } else if (pageIds.length > 0) {
        pagesToPush = pageIds.map((id) => parseInt(id, 10));
      } else {
        logger.error("Please specify page ID(s) or use --all flag.");
        process.exit(1);
      }

      let pushed = 0;
      let skipped = 0;
      let conflicts = 0;

      for (const pageId of pagesToPush) {
        // Load local data
        const localData = await store.loadPage(siteName, pageId);
        if (!localData) {
          logger.warn(`Page ${pageId} not found locally. Skipped.`);
          skipped++;
          continue;
        }

        const spinner = logger.spinner(`Checking page ${pageId}...`);

        try {
          // Get remote page to check for conflicts
          const remotePage = await client.getPage(pageId);
          const remoteModified = new Date(remotePage.modified);
          const localPulledAt = localData.page.remote_modified
            ? new Date(localData.page.remote_modified)
            : null;

          // Check for conflict
          if (localPulledAt && remoteModified > localPulledAt && !options.force) {
            spinner.stop();
            logger.warn(
              `Page ${pageId} has been modified on remote since last pull.`
            );
            logger.dim(`  Remote modified: ${formatDate(remotePage.modified)}`);
            logger.dim(
              `  Local pulled:    ${formatDate(localData.page.remote_modified || "")}`
            );

            const confirm = await confirmAction(
              "Force push and overwrite remote changes?"
            );
            if (!confirm) {
              logger.dim(`Skipped page ${pageId}`);
              conflicts++;
              continue;
            }
          }

          if (options.dryRun) {
            spinner.stop();
            logger.info(`Would push page ${pageId}: "${localData.meta.title}"`);

            // Show diff summary
            const remoteData = parser.parseWPPage(remotePage);
            const diff = parser.diffElements(
              localData.elements,
              remoteData.elementor_data
            );

            if (diff.added.length || diff.removed.length || diff.modified.length) {
              logger.dim(
                `  Changes: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.modified.length} modified`
              );
            } else {
              logger.dim(`  No element changes detected.`);
            }

            skipped++;
            continue;
          }

          spinner.text = `Pushing page ${pageId}...`;

          // Update page
          await client.updatePage(pageId, {
            title: localData.meta.title,
            slug: localData.meta.slug,
            status: localData.meta.status,
            elementorData: parser.serializeElements(localData.elements),
            pageSettings: localData.settings,
          });

          // Update local page data with current values and new remote timestamp
          const updatedPage = await client.getPage(pageId);
          localData.page.remote_modified = updatedPage.modified;
          localData.page.elementor_data = localData.elements;
          localData.page.page_settings = localData.settings;
          localData.page.title = localData.meta.title;
          localData.page.slug = localData.meta.slug;
          localData.page.status = localData.meta.status;
          await store.savePage(siteName, localData.page);

          spinner.succeed(`Pushed page ${pageId}: "${localData.meta.title}"`);
          pushed++;
        } catch (error) {
          spinner.fail(`Failed to push page ${pageId}: ${error}`);
        }
      }

      console.log("");
      if (options.dryRun) {
        logger.info(
          `Dry run complete. ${pagesToPush.length} page(s) would be pushed.`
        );
      } else {
        logger.success(
          `Pushed ${pushed} page(s)${skipped > 0 ? `, skipped ${skipped}` : ""}${conflicts > 0 ? `, ${conflicts} conflict(s)` : ""}`
        );
      }
    } catch (error) {
      logger.error(`Push failed: ${error}`);
      process.exit(1);
    }
  });
