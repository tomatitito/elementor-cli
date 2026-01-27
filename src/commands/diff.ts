import { Command } from "commander";
import chalk from "chalk";
import { getSiteConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { LocalStore } from "../services/local-store.js";
import { ElementorParser } from "../services/elementor-parser.js";
import type { ElementorElement } from "../types/elementor.js";

export const diffCommand = new Command("diff")
  .description("Compare local changes with remote")
  .argument("<page-id>", "Page ID to compare")
  .option("-s, --site <name>", "Site name from config")
  .option("--format <format>", "Output format (text, json, summary)", "text")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli diff 42
  $ elementor-cli diff 42 --site production
  $ elementor-cli diff 42 --format json
  $ elementor-cli diff 42 --format summary

Output formats:
  text     Human-readable diff (default)
  json     JSON diff structure
  summary  Brief change counts

See also:
  elementor-cli pull           Download pages
  elementor-cli push           Upload changes
  elementor-cli revisions      View history
`
  )
  .action(async (pageId: string, options) => {
    try {
      const id = parseInt(pageId, 10);
      const { name: siteName, config } = await getSiteConfig(options.site);
      const client = new WordPressClient(config);
      const store = await LocalStore.create();
      const parser = new ElementorParser();

      // Load local data
      const localData = await store.loadPage(siteName, id);
      if (!localData) {
        logger.error(`Page ${id} not found locally. Run 'elementor-cli pull ${id}' first.`);
        process.exit(1);
      }

      const spinner = logger.spinner("Fetching remote page...");

      // Get remote page
      const remotePage = await client.getPage(id);
      const remoteData = parser.parseWPPage(remotePage);

      spinner.stop();

      // Compare elements
      const diff = parser.diffElements(localData.elements, remoteData.elementor_data);

      // Compare settings
      const settingsDiff = compareSettings(localData.settings, remoteData.page_settings);

      // Compare meta
      const metaDiff = compareSettings(localData.meta, {
        title: remoteData.title,
        slug: remoteData.slug,
        status: remoteData.status,
      });

      const hasChanges =
        diff.added.length > 0 ||
        diff.removed.length > 0 ||
        diff.modified.length > 0 ||
        settingsDiff.length > 0 ||
        metaDiff.length > 0;

      if (options.format === "json") {
        console.log(
          JSON.stringify(
            {
              pageId: id,
              site: siteName,
              hasChanges,
              elements: diff,
              settings: settingsDiff,
              meta: metaDiff,
            },
            null,
            2
          )
        );
        return;
      }

      if (options.format === "summary") {
        logger.heading(`Page ${id}: ${localData.meta.title}`);
        if (!hasChanges) {
          logger.info("No changes detected.");
          return;
        }

        console.log(`Elements: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.modified.length} modified`);
        console.log(`Settings: ${settingsDiff.length} changed`);
        console.log(`Meta: ${metaDiff.length} changed`);
        return;
      }

      // Default: text format
      logger.heading(`Diff: ${localData.meta.title} (ID: ${id})`);
      logger.dim(`Site: ${siteName}`);
      logger.dim(`Local pulled: ${formatDate(localData.page.pulled_at || "")}`);
      logger.dim(`Remote modified: ${formatDate(remoteData.remote_modified || "")}`);
      console.log("");

      if (!hasChanges) {
        logger.success("No changes between local and remote.");
        return;
      }

      // Show meta changes
      if (metaDiff.length > 0) {
        console.log(chalk.bold("Meta:"));
        for (const change of metaDiff) {
          console.log(
            `  ${chalk.yellow("~")} ${change.key}: ${chalk.red(String(change.remote))} → ${chalk.green(String(change.local))}`
          );
        }
        console.log("");
      }

      // Show settings changes
      if (settingsDiff.length > 0) {
        console.log(chalk.bold("Settings:"));
        for (const change of settingsDiff) {
          console.log(
            `  ${chalk.yellow("~")} ${change.key}: ${chalk.red(formatValue(change.remote))} → ${chalk.green(formatValue(change.local))}`
          );
        }
        console.log("");
      }

      // Show element changes
      if (diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0) {
        console.log(chalk.bold("Elements:"));

        for (const id of diff.added) {
          const el = parser.findElement(localData.elements, id);
          console.log(
            `  ${chalk.green("+")} Added: ${formatElement(el)}`
          );
        }

        for (const id of diff.removed) {
          const el = parser.findElement(remoteData.elementor_data, id);
          console.log(
            `  ${chalk.red("-")} Removed: ${formatElement(el)}`
          );
        }

        for (const id of diff.modified) {
          const localEl = parser.findElement(localData.elements, id);
          console.log(
            `  ${chalk.yellow("~")} Modified: ${formatElement(localEl)}`
          );
        }
      }
    } catch (error) {
      logger.error(`Diff failed: ${error}`);
      process.exit(1);
    }
  });

interface SettingChange {
  key: string;
  local: unknown;
  remote: unknown;
}

function compareSettings(
  local: Record<string, unknown>,
  remote: Record<string, unknown>
): SettingChange[] {
  const changes: SettingChange[] = [];
  const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

  for (const key of allKeys) {
    const localVal = local[key];
    const remoteVal = remote[key];

    if (JSON.stringify(localVal) !== JSON.stringify(remoteVal)) {
      changes.push({ key, local: localVal, remote: remoteVal });
    }
  }

  return changes;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "(not set)";
  if (typeof value === "object") {
    return JSON.stringify(value).slice(0, 50);
  }
  return String(value);
}

function formatElement(el: ElementorElement | null): string {
  if (!el) return "(unknown)";

  if (el.elType === "widget") {
    const label =
      el.widgetType === "heading"
        ? (el.settings.title as string)?.slice(0, 30)
        : el.widgetType === "button"
          ? (el.settings.text as string)?.slice(0, 30)
          : null;

    return `widget[${el.widgetType}]${label ? ` "${label}"` : ""} (${el.id})`;
  }

  return `${el.elType} (${el.id})`;
}
