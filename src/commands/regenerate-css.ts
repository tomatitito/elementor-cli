import { Command } from "commander";
import { getSiteConfig } from "../utils/config-store.js";
import { logger } from "../utils/logger.js";
import { WordPressClient } from "../services/wordpress-client.js";

export const regenerateCssCommand = new Command("regenerate-css")
  .description("Invalidate Elementor CSS cache to force regeneration")
  .argument("<page-ids...>", "Page ID(s) to regenerate CSS for")
  .option("-s, --site <name>", "Site name from config")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli regenerate-css 42               Regenerate CSS for page 42
  $ elementor-cli regenerate-css 42 156 203       Regenerate CSS for multiple pages
  $ elementor-cli regenerate-css 42 --site prod   Use specific site config

How it works:
  - Invalidates the _elementor_css post meta
  - Forces Elementor to rebuild CSS on next page load
  - Useful after URL changes or manual data edits

See also:
  elementor-cli push           Upload local changes
  elementor-cli preview sync   Sync to staging environment
`
  )
  .action(async (pageIds: string[], options) => {
    try {
      const { config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);

      const ids = pageIds.map((id) => parseInt(id, 10));
      let regenerated = 0;
      let failed = 0;

      for (const pageId of ids) {
        const spinner = logger.spinner(`Invalidating CSS for page ${pageId}...`);

        try {
          // Check page exists and is an Elementor page
          const page = await client.getPage(pageId);
          if (!client.isElementorPage(page)) {
            spinner.warn(`Page ${pageId} is not an Elementor page. Skipped.`);
            continue;
          }

          // Invalidate the CSS cache
          await client.invalidateCss(pageId);

          const title =
            typeof page.title === "object" ? page.title.rendered : page.title;
          spinner.succeed(`Invalidated CSS for page ${pageId}: "${title}"`);
          regenerated++;
        } catch (error) {
          spinner.fail(`Failed to invalidate CSS for page ${pageId}: ${error}`);
          failed++;
        }
      }

      console.log("");
      if (regenerated > 0) {
        logger.success(
          `Invalidated CSS for ${regenerated} page(s).${failed > 0 ? ` ${failed} failed.` : ""}`
        );
        logger.dim("CSS will be regenerated when pages are next viewed.");
      } else if (failed > 0) {
        logger.error(`Failed to invalidate CSS for ${failed} page(s).`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Failed to regenerate CSS: ${error}`);
      process.exit(1);
    }
  });
