import { Command } from "commander";
import chalk from "chalk";
import { getSiteConfig } from "../utils/config-store.js";
import { logger } from "../utils/logger.js";
import { WordPressClient } from "../services/wordpress-client.js";
import type { WPPage } from "../types/wordpress.js";

interface ReplacementResult {
  pageId: number;
  title: string;
  elementorDataCount: number;
  pageSettingsCount: number;
  totalCount: number;
}

function countAndReplace(
  data: string,
  search: string,
  replace: string,
  dryRun: boolean
): { result: string; count: number } {
  if (!data) {
    return { result: data, count: 0 };
  }

  // Count occurrences
  const regex = new RegExp(escapeRegExp(search), "g");
  const matches = data.match(regex);
  const count = matches ? matches.length : 0;

  if (dryRun || count === 0) {
    return { result: data, count };
  }

  // Perform replacement
  const result = data.replace(regex, replace);
  return { result, count };
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function processPage(
  client: WordPressClient,
  page: WPPage,
  search: string,
  replace: string,
  dryRun: boolean
): Promise<ReplacementResult | null> {
  const title =
    typeof page.title === "object" ? page.title.rendered : String(page.title);

  // Get elementor data
  const elementorData = page.meta?._elementor_data || "";
  const pageSettings =
    typeof page.meta?._elementor_page_settings === "string"
      ? page.meta._elementor_page_settings
      : JSON.stringify(page.meta?._elementor_page_settings || {});

  // Count and replace in elementor data
  const elementorResult = countAndReplace(elementorData, search, replace, dryRun);

  // Count and replace in page settings
  const settingsResult = countAndReplace(pageSettings, search, replace, dryRun);

  const totalCount = elementorResult.count + settingsResult.count;

  if (totalCount === 0) {
    return null;
  }

  // If not dry run, update the page
  if (!dryRun) {
    const updateData: {
      elementorData?: string;
      pageSettings?: Record<string, unknown>;
    } = {};

    if (elementorResult.count > 0) {
      updateData.elementorData = elementorResult.result;
    }

    if (settingsResult.count > 0) {
      try {
        updateData.pageSettings = JSON.parse(settingsResult.result);
      } catch {
        // If we can't parse it, skip updating settings
      }
    }

    await client.updatePage(page.id, updateData);

    // Invalidate CSS cache after making changes
    await client.invalidateCss(page.id);
  }

  return {
    pageId: page.id,
    title,
    elementorDataCount: elementorResult.count,
    pageSettingsCount: settingsResult.count,
    totalCount,
  };
}

export const searchReplaceCommand = new Command("search-replace")
  .description("Search and replace text in Elementor page data")
  .argument("<search>", "Text to search for")
  .argument("<replace>", "Text to replace with")
  .option("-p, --page <id>", "Page ID to update (required unless --all-pages)")
  .option("-s, --site <name>", "Site name from config")
  .option("-n, --dry-run", "Preview changes without applying them", false)
  .option("-a, --all-pages", "Apply to all Elementor pages", false)
  .option("--json", "Output results as JSON", false)
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli search-replace "localhost:8081" "localhost:8080" -p 42
  $ elementor-cli search-replace "staging.example.com" "example.com" -p 42 --dry-run
  $ elementor-cli search-replace "old-url" "new-url" --all-pages
  $ elementor-cli search-replace "http://" "https://" --all-pages --dry-run

Use cases:
  - Fix URL port mismatches after migration
  - Update domain names when moving environments
  - Replace asset URLs with CDN URLs
  - Fix protocol (http to https)

Notes:
  - Changes are made directly to the remote WordPress database
  - CSS cache is automatically invalidated after changes
  - Use --dry-run to preview changes before applying

See also:
  elementor-cli audit             Check for URL mismatches
  elementor-cli regenerate-css    Invalidate CSS cache
  elementor-cli pull              Download page for local editing
`
  )
  .action(async (search: string, replace: string, options) => {
    try {
      // Validate options
      if (!options.page && !options.allPages) {
        logger.error("You must specify either --page <id> or --all-pages");
        process.exit(1);
      }

      if (options.page && options.allPages) {
        logger.error("Cannot use both --page and --all-pages");
        process.exit(1);
      }

      if (search === replace) {
        logger.error("Search and replace strings are identical");
        process.exit(1);
      }

      const { config: siteConfig } = await getSiteConfig(options.site);
      const client = new WordPressClient(siteConfig);

      const spinner = logger.spinner(
        options.dryRun ? "Previewing changes..." : "Processing..."
      );

      const results: ReplacementResult[] = [];
      let pagesProcessed = 0;

      if (options.allPages) {
        // Fetch all pages
        const pages = await client.listPages({ status: "all" });
        const elementorPages = pages.filter((p) => client.isElementorPage(p));

        spinner.text = `Processing ${elementorPages.length} Elementor page(s)...`;

        for (const page of elementorPages) {
          // Need to fetch full page data for each
          const fullPage = await client.getPage(page.id);
          const result = await processPage(
            client,
            fullPage,
            search,
            replace,
            options.dryRun
          );
          pagesProcessed++;
          if (result) {
            results.push(result);
          }
          spinner.text = `Processing page ${pagesProcessed}/${elementorPages.length}...`;
        }
      } else {
        const pageId = parseInt(options.page, 10);
        if (isNaN(pageId)) {
          spinner.fail(`Invalid page ID: ${options.page}`);
          process.exit(1);
        }

        const page = await client.getPage(pageId);
        if (!client.isElementorPage(page)) {
          spinner.fail(`Page ${pageId} is not an Elementor page.`);
          process.exit(1);
        }

        const result = await processPage(
          client,
          page,
          search,
          replace,
          options.dryRun
        );
        pagesProcessed = 1;
        if (result) {
          results.push(result);
        }
      }

      spinner.stop();

      // Output results
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              dryRun: options.dryRun,
              search,
              replace,
              pagesProcessed,
              pagesWithMatches: results.length,
              results,
            },
            null,
            2
          )
        );
        return;
      }

      console.log("");

      if (options.dryRun) {
        logger.heading("Dry Run Results");
      } else {
        logger.heading("Search & Replace Results");
      }

      console.log(`Search:  ${chalk.red(search)}`);
      console.log(`Replace: ${chalk.green(replace)}\n`);

      if (results.length === 0) {
        console.log(chalk.dim(`No matches found in ${pagesProcessed} page(s).`));
        return;
      }

      let totalReplacements = 0;

      for (const result of results) {
        console.log(
          `${chalk.cyan(`Page ${result.pageId}:`)} ${result.title}`
        );
        if (result.elementorDataCount > 0) {
          console.log(
            chalk.dim(`  Elementor data: ${result.elementorDataCount} match(es)`)
          );
        }
        if (result.pageSettingsCount > 0) {
          console.log(
            chalk.dim(`  Page settings: ${result.pageSettingsCount} match(es)`)
          );
        }
        totalReplacements += result.totalCount;
      }

      console.log("");

      if (options.dryRun) {
        logger.info(
          `Would replace ${totalReplacements} occurrence(s) in ${results.length} page(s)`
        );
        console.log(chalk.dim("Run without --dry-run to apply changes."));
      } else {
        logger.success(
          `Replaced ${totalReplacements} occurrence(s) in ${results.length} page(s)`
        );
        console.log(chalk.dim("CSS cache has been invalidated for affected pages."));
      }
    } catch (error) {
      logger.error(`Search-replace failed: ${error}`);
      process.exit(1);
    }
  });
