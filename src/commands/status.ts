import { Command } from "commander";
import chalk from "chalk";
import { getSiteConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { WordPressClient } from "../services/wordpress-client.js";
import type { ElementorElement } from "../types/elementor.js";

interface UrlCount {
  host: string;
  count: number;
  matches: boolean;
}

interface CssMetadata {
  status?: string;
  time?: number;
  fonts?: string[];
  icons?: string[];
}

interface StatusResult {
  pageId: number;
  title: string;
  css: {
    status: string;
    generatedAt?: string;
    version?: string | number;
    isStale: boolean;
  };
  data: {
    lastModified: string;
    elementCount: number;
  };
  urls: UrlCount[];
  siteUrl: string;
}

function extractUrls(data: unknown): string[] {
  const urls: string[] = [];

  if (typeof data === "string") {
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    const matches = data.match(urlRegex);
    if (matches) {
      urls.push(...matches);
    }
  } else if (Array.isArray(data)) {
    for (const item of data) {
      urls.push(...extractUrls(item));
    }
  } else if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      urls.push(...extractUrls(value));
    }
  }

  return urls;
}

function countElements(elements: ElementorElement[]): number {
  let count = 0;
  for (const element of elements) {
    count++;
    if (element.elements && element.elements.length > 0) {
      count += countElements(element.elements);
    }
  }
  return count;
}

function parseHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return "";
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  } else {
    return "just now";
  }
}

export const statusCommand = new Command("status")
  .description("Show CSS metadata, generation timestamps, and URL analysis for a page")
  .argument("<page-id>", "Page ID to check")
  .option("-s, --site <name>", "Site name from config")
  .option("--json", "Output results as JSON", false)
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli status 42                Show status for page 42
  $ elementor-cli status 42 --site prod    Use specific site config
  $ elementor-cli status 42 --json         Output as JSON

What it shows:
  - CSS cache status (generated, stale, or missing)
  - CSS generation timestamp
  - Page data modification timestamp
  - URL analysis (matching and mismatching URLs)

See also:
  elementor-cli audit             Full audit with asset checking
  elementor-cli regenerate-css    Invalidate CSS cache
  elementor-cli search-replace    Fix URL mismatches
`
  )
  .action(async (pageIdStr: string, options) => {
    try {
      const pageId = parseInt(pageIdStr, 10);
      if (isNaN(pageId)) {
        logger.error(`Invalid page ID: ${pageIdStr}`);
        process.exit(1);
      }

      const { config: siteConfig } = await getSiteConfig(options.site);
      const client = new WordPressClient(siteConfig);
      const siteHost = parseHost(siteConfig.url);

      const spinner = logger.spinner(`Fetching status for page ${pageId}...`);

      const page = await client.getPage(pageId);

      if (!client.isElementorPage(page)) {
        spinner.fail(`Page ${pageId} is not an Elementor page.`);
        process.exit(1);
      }

      const title =
        typeof page.title === "object" ? page.title.rendered : String(page.title);

      // Parse CSS metadata
      let cssStatus = "not_generated";
      let cssGeneratedAt: string | undefined;
      let cssVersion: string | number | undefined;
      let cssTime: number | undefined;

      const cssMetaRaw = page.meta?._elementor_css;
      if (cssMetaRaw) {
        try {
          const cssMeta: CssMetadata =
            typeof cssMetaRaw === "string" ? JSON.parse(cssMetaRaw) : cssMetaRaw;
          cssStatus = cssMeta.status || "unknown";
          cssTime = cssMeta.time;
          if (cssTime) {
            cssGeneratedAt = new Date(cssTime * 1000).toISOString();
          }
        } catch {
          cssStatus = "parse_error";
        }
      }

      // Parse Elementor data
      let elements: ElementorElement[] = [];
      if (page.meta?._elementor_data) {
        try {
          elements = JSON.parse(page.meta._elementor_data);
        } catch {
          // Ignore parse errors
        }
      }

      // Extract URLs
      const allUrls = extractUrls(page.meta?._elementor_data || "");

      // Also extract from page settings
      if (page.meta?._elementor_page_settings) {
        const settingsData =
          typeof page.meta._elementor_page_settings === "string"
            ? page.meta._elementor_page_settings
            : JSON.stringify(page.meta._elementor_page_settings);
        allUrls.push(...extractUrls(settingsData));
      }

      // Count URLs by host
      const hostCounts = new Map<string, number>();
      for (const url of allUrls) {
        const host = parseHost(url);
        if (host) {
          hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
        }
      }

      const urlCounts: UrlCount[] = Array.from(hostCounts.entries())
        .map(([host, count]) => ({
          host,
          count,
          matches: host === siteHost,
        }))
        .sort((a, b) => b.count - a.count);

      // Check if CSS is stale
      const pageModified = new Date(page.modified);
      const cssGenerated = cssTime ? new Date(cssTime * 1000) : null;
      const isStale = cssGenerated ? pageModified > cssGenerated : true;

      spinner.stop();

      const result: StatusResult = {
        pageId,
        title,
        css: {
          status: cssStatus,
          generatedAt: cssGeneratedAt,
          version: cssVersion,
          isStale,
        },
        data: {
          lastModified: page.modified,
          elementCount: countElements(elements),
        },
        urls: urlCounts,
        siteUrl: siteConfig.url,
      };

      // Output results
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log("");
      logger.heading(`Page ${pageId}: "${title}"`);

      // CSS Status section
      console.log(chalk.bold("CSS Status:"));
      console.log(`  Status: ${cssStatus === "file" ? chalk.green(cssStatus) : chalk.yellow(cssStatus)}`);

      if (cssGeneratedAt) {
        const cssDate = new Date(cssGeneratedAt);
        console.log(
          `  Generated: ${formatDate(cssGeneratedAt)} (${formatRelativeTime(cssDate)})`
        );
      } else {
        console.log(chalk.dim("  Generated: Never"));
      }

      console.log("");

      // Data Status section
      console.log(chalk.bold("Data Status:"));
      console.log(
        `  Last modified: ${formatDate(page.modified)} (${formatRelativeTime(pageModified)})`
      );
      console.log(`  Elements: ${countElements(elements)}`);

      if (isStale) {
        console.log(chalk.yellow("  ⚠ CSS may be stale (data is newer than CSS)"));
      } else {
        console.log(chalk.green("  ✓ CSS is up to date"));
      }

      console.log("");

      // URL Analysis section
      console.log(chalk.bold("URL Analysis:"));
      console.log(`  Site URL: ${siteConfig.url}`);

      if (urlCounts.length === 0) {
        console.log(chalk.dim("  No URLs found in page data"));
      } else {
        console.log("  Found URLs:");
        for (const { host, count, matches } of urlCounts) {
          const status = matches ? chalk.green("✓") : chalk.yellow("⚠ mismatch");
          console.log(`    - ${host} (${count} occurrence${count === 1 ? "" : "s"}) ${status}`);
        }
      }

      console.log("");

      // Summary with recommendations
      const hasMismatchedUrls = urlCounts.some((u) => !u.matches);

      if (isStale || hasMismatchedUrls) {
        console.log(chalk.bold("Recommendations:"));
        if (isStale) {
          console.log(
            chalk.dim("  • Run 'elementor-cli regenerate-css " + pageId + "' to refresh CSS")
          );
        }
        if (hasMismatchedUrls) {
          console.log(
            chalk.dim("  • Run 'elementor-cli audit " + pageId + "' to see URL details")
          );
          console.log(
            chalk.dim("  • Run 'elementor-cli search-replace' to fix URL mismatches")
          );
        }
      } else {
        logger.success("No issues detected");
      }
    } catch (error) {
      logger.error(`Failed to get status: ${error}`);
      process.exit(1);
    }
  });
