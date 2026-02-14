import { Command } from "commander";
import { getSiteConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { confirmAction } from "../utils/prompts.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { LocalStore } from "../services/local-store.js";
import { ElementorParser } from "../services/elementor-parser.js";
import { RevisionManager } from "../services/revision-manager.js";
import { ContainerCli } from "../services/container-cli.js";

export const pushCommand = new Command("push")
  .description("Upload local changes to WordPress")
  .argument("[page-ids...]", "Page ID(s) to push")
  .option("-s, --site <name>", "Site name from config")
  .option("-a, --all", "Push all locally modified pages")
  .option("-f, --force", "Force push even if remote has changed")
  .option("-n, --dry-run", "Show what would be pushed without making changes")
  .option("-u, --undo", "Undo the last push by restoring the previous revision")
  .option("--no-flush", "Skip CSS cache invalidation after push")
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
  $ elementor-cli push 42 --undo             Undo last push for page
  $ elementor-cli push 42 --undo --dry-run   Preview what undo would restore
  $ elementor-cli push 42 --no-flush         Push without CSS cache invalidation

Safety features:
  - Compares timestamps to detect conflicts
  - Requires --force if remote has been modified
  - WordPress creates a revision before overwriting
  - Use --undo to revert a push to the previous revision

Cache invalidation:
  - Automatically invalidates Elementor CSS cache after push
  - For container sites, also runs 'wp elementor flush-css'
  - Use --no-flush to skip cache invalidation

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

      // Undo mode: restore pages to the revision created before the last push
      if (options.undo) {
        const manager = new RevisionManager(client);
        let restored = 0;
        let skipped = 0;

        for (const pageId of pagesToPush) {
          const spinner = logger.spinner(`Fetching revisions for page ${pageId}...`);

          try {
            const revisions = await manager.listRevisions(pageId);

            // Find the most recent revision with Elementor data
            const revision = revisions.find((rev) => rev.hasElementorData);
            if (!revision) {
              spinner.fail(`No revision with Elementor data found for page ${pageId}.`);
              skipped++;
              continue;
            }

            spinner.stop();
            logger.info(
              `Page ${pageId}: found revision ${revision.id} from ${formatDate(revision.date)}`
            );

            if (options.dryRun) {
              // Show what the undo would restore
              const currentPage = await client.getPage(pageId);
              const currentData = parser.parseWPPage(currentPage);
              const diff = parser.diffElements(
                currentData.elementor_data,
                revision.elementorData
              );

              if (diff.added.length || diff.removed.length || diff.modified.length) {
                logger.dim(
                  `  Would revert: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.modified.length} modified`
                );
              } else {
                logger.dim(`  No differences between current and revision.`);
              }

              skipped++;
              continue;
            }

            if (!options.force) {
              const confirmed = await confirmAction(
                `Restore page ${pageId} to revision ${revision.id}? Current remote content will be overwritten.`
              );
              if (!confirmed) {
                logger.dim(`Skipped page ${pageId}`);
                skipped++;
                continue;
              }
            }

            const restoreSpinner = logger.spinner(`Restoring page ${pageId} to revision ${revision.id}...`);

            await manager.restoreRevision(pageId, revision.id);

            // Update local store with the restored state
            const restoredPage = await client.getPage(pageId);
            const restoredData = parser.parseWPPage(restoredPage);
            await store.savePage(siteName, restoredData);

            restoreSpinner.succeed(
              `Restored page ${pageId} to revision ${revision.id} (${formatDate(revision.date)})`
            );
            restored++;
          } catch (error) {
            spinner.fail(`Failed to undo push for page ${pageId}: ${error}`);
          }
        }

        console.log("");
        if (options.dryRun) {
          logger.info(
            `Dry run complete. ${pagesToPush.length} page(s) would be restored.`
          );
        } else {
          logger.success(
            `Restored ${restored} page(s)${skipped > 0 ? `, skipped ${skipped}` : ""}`
          );
        }
        return;
      }

      let pushed = 0;
      let skipped = 0;
      let conflicts = 0;
      const pushedPageIds: number[] = [];

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
            template: localData.meta.template,
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
          localData.page.template = localData.meta.template;
          await store.savePage(siteName, localData.page);

          spinner.succeed(`Pushed page ${pageId}: "${localData.meta.title}"`);
          pushed++;
          pushedPageIds.push(pageId);
        } catch (error) {
          spinner.fail(`Failed to push page ${pageId}: ${error}`);
        }
      }

      // Flush CSS cache for pushed pages
      if (pushedPageIds.length > 0 && options.flush !== false) {
        const flushSpinner = logger.spinner("Invalidating CSS cache...");

        try {
          // Invalidate CSS via REST API for each pushed page
          for (const pageId of pushedPageIds) {
            await client.invalidateCss(pageId);
          }

          // If site has container config, also run wp elementor flush-css
          if (config.container) {
            const containerCli = new ContainerCli(config.container);
            await containerCli.flushElementorCss();
            flushSpinner.succeed(
              `Invalidated CSS cache (REST API + container flush)`
            );
          } else {
            flushSpinner.succeed(`Invalidated CSS cache`);
          }
        } catch (error) {
          flushSpinner.warn(`CSS cache invalidation failed: ${error}`);
          logger.dim(
            "  Changes were pushed but CSS may be stale. Run 'elementor-cli regenerate-css' manually."
          );
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
