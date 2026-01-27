import { Command } from "commander";
import chalk from "chalk";
import { getSiteConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { confirmAction } from "../utils/prompts.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { RevisionManager } from "../services/revision-manager.js";
import { ElementorParser } from "../services/elementor-parser.js";

export const revisionsCommand = new Command("revisions").description(
  "View and restore page backups/revisions"
);

// revisions list
revisionsCommand
  .command("list <page-id>")
  .description("List revisions for a page")
  .option("-s, --site <name>", "Site name from config")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli revisions list 42
  $ elementor-cli revisions list 42 --site production

See also:
  elementor-cli revisions show      Show revision details
  elementor-cli revisions restore   Restore a revision
`
  )
  .action(async (pageId, options) => {
    try {
      const id = parseInt(pageId, 10);
      const { name: siteName, config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);
      const manager = new RevisionManager(client);

      const spinner = logger.spinner("Fetching revisions...");
      const revisions = await manager.listRevisions(id);
      spinner.stop();

      if (revisions.length === 0) {
        logger.info("No revisions found for this page.");
        return;
      }

      logger.heading(`Revisions for Page ${id}`);
      console.log(
        "ID".padEnd(10) +
          "Date".padEnd(25) +
          "Elementor".padEnd(12) +
          "Elements"
      );
      console.log("─".repeat(60));

      for (const rev of revisions) {
        const parser = new ElementorParser();
        const elementCount = rev.hasElementorData
          ? String(parser.countElements(rev.elementorData))
          : "-";

        console.log(
          String(rev.id).padEnd(10) +
            formatDate(rev.date).padEnd(25) +
            (rev.hasElementorData ? "Yes" : "No").padEnd(12) +
            elementCount
        );
      }

      console.log("");
      logger.dim(`${revisions.length} revision(s) found.`);
    } catch (error) {
      logger.error(`Failed to list revisions: ${error}`);
      process.exit(1);
    }
  });

// revisions show
revisionsCommand
  .command("show <page-id> <revision-id>")
  .description("Show revision details")
  .option("-s, --site <name>", "Site name from config")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli revisions show 42 156
  $ elementor-cli revisions show 42 156 --site production

See also:
  elementor-cli revisions list      List all revisions
  elementor-cli revisions diff      Compare revision to current
`
  )
  .action(async (pageId, revisionId, options) => {
    try {
      const id = parseInt(pageId, 10);
      const revId = parseInt(revisionId, 10);
      const { config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);
      const manager = new RevisionManager(client);
      const parser = new ElementorParser();

      const spinner = logger.spinner("Fetching revision...");
      const revision = await manager.getRevision(id, revId);
      spinner.stop();

      logger.heading(`Revision ${revId}`);
      console.log(`  Page ID:        ${revision.parent}`);
      console.log(`  Revision ID:    ${revision.id}`);
      console.log(`  Date:           ${formatDate(revision.date)}`);
      console.log(`  Has Elementor:  ${revision.hasElementorData ? "Yes" : "No"}`);

      if (revision.hasElementorData) {
        console.log(`  Elements:       ${parser.countElements(revision.elementorData)}`);

        const widgets = parser.getWidgets(revision.elementorData);
        if (widgets.length > 0) {
          console.log(`  Widgets:        ${widgets.length}`);

          const widgetTypes = new Map<string, number>();
          for (const w of widgets) {
            const type = w.widgetType || "unknown";
            widgetTypes.set(type, (widgetTypes.get(type) || 0) + 1);
          }

          for (const [type, count] of widgetTypes) {
            console.log(`    - ${type}: ${count}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to show revision: ${error}`);
      process.exit(1);
    }
  });

// revisions diff
revisionsCommand
  .command("diff <page-id> <revision-id>")
  .description("Compare revision to current page")
  .option("-s, --site <name>", "Site name from config")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli revisions diff 42 156
  $ elementor-cli revisions diff 42 156 --site production

See also:
  elementor-cli revisions list      List all revisions
  elementor-cli revisions restore   Restore a revision
`
  )
  .action(async (pageId, revisionId, options) => {
    try {
      const id = parseInt(pageId, 10);
      const revId = parseInt(revisionId, 10);
      const { config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);
      const manager = new RevisionManager(client);
      const parser = new ElementorParser();

      const spinner = logger.spinner("Comparing revision...");

      const [currentPage, revision] = await Promise.all([
        client.getPage(id),
        manager.getRevision(id, revId),
      ]);

      spinner.stop();

      const currentData = parser.parseWPPage(currentPage);

      if (!revision.hasElementorData) {
        logger.warn("Revision does not contain Elementor data.");
        return;
      }

      const diff = manager.diffWithCurrent(
        currentData.elementor_data,
        revision.elementorData
      );

      logger.heading(`Diff: Current vs Revision ${revId}`);

      const hasChanges =
        diff.added.length > 0 ||
        diff.removed.length > 0 ||
        diff.modified.length > 0;

      if (!hasChanges) {
        logger.success("No differences found.");
        return;
      }

      // "Added" means in current but not in revision (new since revision)
      if (diff.added.length > 0) {
        console.log(chalk.bold("\nAdded since revision:"));
        for (const elId of diff.added) {
          const el = parser.findElement(currentData.elementor_data, elId);
          console.log(
            `  ${chalk.green("+")} ${el?.elType}${el?.widgetType ? `[${el.widgetType}]` : ""} (${elId})`
          );
        }
      }

      // "Removed" means in revision but not in current (removed since revision)
      if (diff.removed.length > 0) {
        console.log(chalk.bold("\nRemoved since revision:"));
        for (const elId of diff.removed) {
          const el = parser.findElement(revision.elementorData, elId);
          console.log(
            `  ${chalk.red("-")} ${el?.elType}${el?.widgetType ? `[${el.widgetType}]` : ""} (${elId})`
          );
        }
      }

      if (diff.modified.length > 0) {
        console.log(chalk.bold("\nModified since revision:"));
        for (const elId of diff.modified) {
          const el = parser.findElement(currentData.elementor_data, elId);
          console.log(
            `  ${chalk.yellow("~")} ${el?.elType}${el?.widgetType ? `[${el.widgetType}]` : ""} (${elId})`
          );
        }
      }

      console.log("");
      logger.dim(
        `Summary: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.modified.length} modified`
      );
    } catch (error) {
      logger.error(`Failed to diff revision: ${error}`);
      process.exit(1);
    }
  });

// revisions restore
revisionsCommand
  .command("restore <page-id> <revision-id>")
  .description("Restore a revision to the page")
  .option("-s, --site <name>", "Site name from config")
  .option("-f, --force", "Skip confirmation")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli revisions restore 42 156
  $ elementor-cli revisions restore 42 156 --force
  $ elementor-cli revisions restore 42 156 --site production

WARNING: This will overwrite the current page content!

See also:
  elementor-cli revisions list   List all revisions
  elementor-cli revisions diff   Compare before restoring
`
  )
  .action(async (pageId, revisionId, options) => {
    try {
      const id = parseInt(pageId, 10);
      const revId = parseInt(revisionId, 10);
      const { name: siteName, config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);
      const manager = new RevisionManager(client);

      if (!options.force) {
        const confirmed = await confirmAction(
          `Restore page ${id} to revision ${revId}? Current content will be overwritten.`
        );
        if (!confirmed) {
          logger.info("Cancelled.");
          return;
        }
      }

      const spinner = logger.spinner("Restoring revision...");

      await manager.restoreRevision(id, revId);

      spinner.succeed(`Restored page ${id} to revision ${revId}`);
      logger.dim(`Site: ${siteName}`);
    } catch (error) {
      logger.error(`Failed to restore revision: ${error}`);
      process.exit(1);
    }
  });

// revisions create
revisionsCommand
  .command("create <page-id>")
  .description("Create a manual backup (revision)")
  .option("-s, --site <name>", "Site name from config")
  .option("-m, --message <message>", "Backup note")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli revisions create 42
  $ elementor-cli revisions create 42 --message "Before major changes"

See also:
  elementor-cli revisions list      List all revisions
  elementor-cli revisions restore   Restore a revision
`
  )
  .action(async (pageId, options) => {
    try {
      const id = parseInt(pageId, 10);
      const { name: siteName, config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);
      const manager = new RevisionManager(client);

      const spinner = logger.spinner("Creating backup...");

      await manager.createBackup(id);

      spinner.succeed(`Created backup for page ${id}`);
      logger.dim(`Site: ${siteName}`);

      if (options.message) {
        logger.dim(`Note: ${options.message}`);
      }
    } catch (error) {
      logger.error(`Failed to create backup: ${error}`);
      process.exit(1);
    }
  });
