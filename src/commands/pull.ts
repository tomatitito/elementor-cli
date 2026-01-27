import { Command } from "commander";
import { getSiteConfig } from "../utils/config-store.js";
import { logger } from "../utils/logger.js";
import { confirmAction } from "../utils/prompts.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { LocalStore } from "../services/local-store.js";
import { ElementorParser } from "../services/elementor-parser.js";

export const pullCommand = new Command("pull")
  .description("Download Elementor pages from WordPress to local storage")
  .argument("[page-ids...]", "Page ID(s) to pull")
  .option("-s, --site <name>", "Site name from config")
  .option("-a, --all", "Pull all Elementor pages")
  .option("-f, --force", "Overwrite local changes without confirmation")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli pull 42                    Pull single page
  $ elementor-cli pull 42 156 203            Pull multiple pages
  $ elementor-cli pull --all                 Pull all Elementor pages
  $ elementor-cli pull 42 --force            Overwrite local changes
  $ elementor-cli pull 42 --site production  Pull from specific site

See also:
  elementor-cli pages list     List available pages
  elementor-cli push           Upload local changes
  elementor-cli diff           Compare local vs remote
`
  )
  .action(async (pageIds: string[], options) => {
    try {
      const { name: siteName, config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);
      const store = await LocalStore.create();
      const parser = new ElementorParser();

      let pagesToPull: number[] = [];

      if (options.all) {
        const spinner = logger.spinner("Fetching page list...");
        const pages = await client.listPages();
        const elementorPages = pages.filter((p) => client.isElementorPage(p));
        pagesToPull = elementorPages.map((p) => p.id);
        spinner.stop();

        if (pagesToPull.length === 0) {
          logger.info("No Elementor pages found on the remote site.");
          return;
        }

        logger.info(`Found ${pagesToPull.length} Elementor page(s) to pull.`);
      } else if (pageIds.length > 0) {
        pagesToPull = pageIds.map((id) => parseInt(id, 10));
      } else {
        logger.error("Please specify page ID(s) or use --all flag.");
        process.exit(1);
      }

      let pulled = 0;
      let skipped = 0;

      for (const pageId of pagesToPull) {
        // Check if local version exists
        const exists = await store.pageExists(siteName, pageId);

        if (exists && !options.force) {
          const localData = await store.loadPage(siteName, pageId);
          if (localData) {
            const confirm = await confirmAction(
              `Local copy of page ${pageId} exists. Overwrite?`
            );
            if (!confirm) {
              logger.dim(`Skipped page ${pageId}`);
              skipped++;
              continue;
            }
          }
        }

        const spinner = logger.spinner(`Pulling page ${pageId}...`);

        try {
          const wpPage = await client.getPage(pageId);

          if (!client.isElementorPage(wpPage)) {
            spinner.warn(`Page ${pageId} is not an Elementor page. Skipped.`);
            skipped++;
            continue;
          }

          const pageData = parser.parseWPPage(wpPage);
          await store.savePage(siteName, pageData);

          const dir = store.getPageDir(siteName, pageId);
          spinner.succeed(`Pulled page ${pageId}: "${pageData.title}"`);
          logger.dim(`  Saved to: ${dir}`);
          pulled++;
        } catch (error) {
          spinner.fail(`Failed to pull page ${pageId}: ${error}`);
        }
      }

      console.log("");
      logger.success(
        `Pulled ${pulled} page(s)${skipped > 0 ? `, skipped ${skipped}` : ""}`
      );
    } catch (error) {
      logger.error(`Pull failed: ${error}`);
      process.exit(1);
    }
  });
