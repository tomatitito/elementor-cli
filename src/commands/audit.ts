import { Command } from "commander";
import chalk from "chalk";
import { getSiteConfig, readConfig } from "../utils/config-store.js";
import { logger } from "../utils/logger.js";
import { WordPressClient } from "../services/wordpress-client.js";
import type { ElementorElement } from "../types/elementor.js";

interface AuditResult {
  urlMismatches: UrlMismatch[];
  missingAssets: MissingAsset[];
  cssStatus: CssStatus | null;
}

interface UrlMismatch {
  location: string;
  url: string;
  expectedHost: string;
  actualHost: string;
}

interface MissingAsset {
  location: string;
  url: string;
  error: string;
}

interface CssStatus {
  isStale: boolean;
  cssTimestamp?: string;
  dataTimestamp?: string;
  status?: string;
}

function extractUrls(data: unknown, path: string = ""): Array<{ location: string; url: string }> {
  const urls: Array<{ location: string; url: string }> = [];

  if (typeof data === "string") {
    // Match URLs in strings
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    const matches = data.match(urlRegex);
    if (matches) {
      for (const url of matches) {
        urls.push({ location: path, url });
      }
    }
  } else if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      urls.push(...extractUrls(data[i], `${path}[${i}]`));
    }
  } else if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      urls.push(...extractUrls(value, path ? `${path}.${key}` : key));
    }
  }

  return urls;
}

function buildElementPath(element: ElementorElement): string {
  const type = element.elType;
  const widgetType = element.widgetType;
  if (widgetType) {
    return `widget[${widgetType}]`;
  }
  return `${type}[${element.id.slice(0, 7)}]`;
}

function extractUrlsFromElements(
  elements: ElementorElement[],
  parentPath: string = ""
): Array<{ location: string; url: string }> {
  const urls: Array<{ location: string; url: string }> = [];

  for (const element of elements) {
    const elementPath = parentPath
      ? `${parentPath} > ${buildElementPath(element)}`
      : buildElementPath(element);

    // Extract URLs from settings
    const settingsUrls = extractUrls(element.settings, "");
    for (const { location, url } of settingsUrls) {
      urls.push({
        location: location ? `${elementPath}.${location}` : elementPath,
        url,
      });
    }

    // Recurse into child elements
    if (element.elements && element.elements.length > 0) {
      urls.push(...extractUrlsFromElements(element.elements, elementPath));
    }
  }

  return urls;
}

function parseHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return "";
  }
}

async function checkAssetAccessibility(
  url: string
): Promise<{ accessible: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { accessible: true };
    }
    return { accessible: false, error: `HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { accessible: false, error: message };
  }
}

function isAssetUrl(url: string): boolean {
  const assetExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".webp",
    ".ico",
    ".pdf",
    ".mp4",
    ".webm",
    ".mp3",
    ".wav",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
  ];
  const lowerUrl = url.toLowerCase();
  return assetExtensions.some((ext) => lowerUrl.includes(ext));
}

export const auditCommand = new Command("audit")
  .description("Detect URL mismatches, missing assets, and CSS issues in a page")
  .argument("<page-id>", "Page ID to audit")
  .option("-s, --site <name>", "Site name from config")
  .option("--check-assets", "Check if referenced assets are accessible", false)
  .option("--json", "Output results as JSON", false)
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli audit 42                    Audit page 42
  $ elementor-cli audit 42 --check-assets     Also verify assets are accessible
  $ elementor-cli audit 42 --site prod        Use specific site config
  $ elementor-cli audit 42 --json             Output as JSON

What it checks:
  - URL mismatches: URLs pointing to wrong domain/port
  - Missing assets: Images/files that return 404 (with --check-assets)
  - CSS status: Whether Elementor CSS cache is stale

See also:
  elementor-cli regenerate-css   Invalidate CSS cache
  elementor-cli push             Upload local changes
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

      const spinner = logger.spinner(`Auditing page ${pageId}...`);

      // Fetch the page
      const page = await client.getPage(pageId);

      if (!client.isElementorPage(page)) {
        spinner.fail(`Page ${pageId} is not an Elementor page.`);
        process.exit(1);
      }

      spinner.text = "Analyzing page data...";

      const title =
        typeof page.title === "object" ? page.title.rendered : page.title;

      // Parse Elementor data
      let elements: ElementorElement[] = [];
      if (page.meta?._elementor_data) {
        try {
          elements = JSON.parse(page.meta._elementor_data);
        } catch {
          spinner.fail("Failed to parse Elementor data.");
          process.exit(1);
        }
      }

      // Extract all URLs from elements
      const allUrls = extractUrlsFromElements(elements);

      // Also extract from page settings
      let pageSettings: Record<string, unknown> = {};
      if (page.meta?._elementor_page_settings) {
        try {
          pageSettings =
            typeof page.meta._elementor_page_settings === "string"
              ? JSON.parse(page.meta._elementor_page_settings)
              : page.meta._elementor_page_settings;
        } catch {
          // Ignore parse errors for settings
        }
      }
      const settingsUrls = extractUrls(pageSettings, "page_settings");
      allUrls.push(...settingsUrls);

      // Deduplicate URLs
      const seenUrls = new Set<string>();
      const uniqueUrls = allUrls.filter(({ url }) => {
        if (seenUrls.has(url)) return false;
        seenUrls.add(url);
        return true;
      });

      const result: AuditResult = {
        urlMismatches: [],
        missingAssets: [],
        cssStatus: null,
      };

      // Check for URL mismatches
      for (const { location, url } of uniqueUrls) {
        const urlHost = parseHost(url);
        if (urlHost && urlHost !== siteHost) {
          result.urlMismatches.push({
            location,
            url,
            expectedHost: siteHost,
            actualHost: urlHost,
          });
        }
      }

      // Check asset accessibility if requested
      if (options.checkAssets) {
        spinner.text = "Checking asset accessibility...";
        const assetUrls = uniqueUrls.filter(({ url }) => isAssetUrl(url));

        for (const { location, url } of assetUrls) {
          const { accessible, error } = await checkAssetAccessibility(url);
          if (!accessible) {
            result.missingAssets.push({
              location,
              url,
              error: error || "Unknown error",
            });
          }
        }
      }

      // Check CSS status
      spinner.text = "Checking CSS cache status...";
      const cssMetaRaw = page.meta?._elementor_css;
      if (cssMetaRaw) {
        try {
          const cssMeta =
            typeof cssMetaRaw === "string" ? JSON.parse(cssMetaRaw) : cssMetaRaw;
          const cssTime = cssMeta?.time;
          const cssStatus = cssMeta?.status;
          const pageModified = page.modified;

          if (cssTime && pageModified) {
            const cssDate = new Date(cssTime * 1000);
            const modifiedDate = new Date(pageModified);

            result.cssStatus = {
              isStale: modifiedDate > cssDate,
              cssTimestamp: cssDate.toISOString(),
              dataTimestamp: modifiedDate.toISOString(),
              status: cssStatus,
            };
          } else {
            result.cssStatus = {
              isStale: false,
              status: cssStatus || "unknown",
            };
          }
        } catch {
          result.cssStatus = {
            isStale: true,
            status: "parse_error",
          };
        }
      } else {
        result.cssStatus = {
          isStale: true,
          status: "not_generated",
        };
      }

      spinner.stop();

      // Output results
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log("");
      logger.heading(`Audit: ${title} (ID: ${pageId})`);

      // URL mismatches
      if (result.urlMismatches.length > 0) {
        console.log(chalk.yellow("⚠ URL mismatches found:\n"));
        for (const mismatch of result.urlMismatches) {
          console.log(chalk.dim(`  ${mismatch.location}:`));
          console.log(
            `    ${chalk.red(mismatch.actualHost)} ${chalk.dim("(expected:")} ${chalk.green(mismatch.expectedHost)}${chalk.dim(")")}`
          );
          console.log(chalk.dim(`    ${mismatch.url}\n`));
        }
      } else {
        console.log(chalk.green("✓ No URL mismatches found\n"));
      }

      // Missing assets
      if (options.checkAssets) {
        const assetUrls = uniqueUrls.filter(({ url }) => isAssetUrl(url));
        if (result.missingAssets.length > 0) {
          console.log(
            chalk.yellow(
              `⚠ ${result.missingAssets.length} missing/inaccessible asset(s):\n`
            )
          );
          for (const asset of result.missingAssets) {
            console.log(chalk.dim(`  ${asset.location}:`));
            console.log(`    ${chalk.red(asset.error)}: ${asset.url}\n`);
          }
        } else {
          console.log(
            chalk.green(`✓ All ${assetUrls.length} assets accessible\n`)
          );
        }
      } else {
        const assetCount = uniqueUrls.filter(({ url }) => isAssetUrl(url)).length;
        console.log(
          chalk.dim(
            `ℹ Found ${assetCount} asset URL(s). Use --check-assets to verify accessibility.\n`
          )
        );
      }

      // CSS status
      if (result.cssStatus) {
        if (result.cssStatus.status === "not_generated") {
          console.log(chalk.yellow("⚠ CSS has not been generated yet\n"));
        } else if (result.cssStatus.status === "parse_error") {
          console.log(chalk.yellow("⚠ Could not parse CSS metadata\n"));
        } else if (result.cssStatus.isStale) {
          console.log(chalk.yellow("⚠ CSS may be stale (data updated after CSS generation)"));
          console.log(chalk.dim(`  CSS generated: ${result.cssStatus.cssTimestamp}`));
          console.log(chalk.dim(`  Data modified: ${result.cssStatus.dataTimestamp}\n`));
        } else {
          console.log(chalk.green("✓ CSS cache is up to date\n"));
        }
      }

      // Summary
      const issueCount =
        result.urlMismatches.length + result.missingAssets.length;
      const hasStaleCSS = result.cssStatus?.isStale || false;

      if (issueCount > 0 || hasStaleCSS) {
        console.log(
          chalk.yellow(
            `Found ${issueCount} issue(s)${hasStaleCSS ? " + stale CSS" : ""}`
          )
        );
        if (result.urlMismatches.length > 0) {
          console.log(
            chalk.dim(
              "Tip: Use 'elementor-cli search-replace' to fix URL mismatches"
            )
          );
        }
        if (hasStaleCSS) {
          console.log(
            chalk.dim(
              "Tip: Use 'elementor-cli regenerate-css' to refresh CSS cache"
            )
          );
        }
        process.exit(1);
      } else {
        logger.success("No issues found");
      }
    } catch (error) {
      logger.error(`Audit failed: ${error}`);
      process.exit(1);
    }
  });
