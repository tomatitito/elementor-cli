import { Command } from "commander";
import { getSiteConfig, readConfig } from "../utils/config-store.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { LocalStore } from "../services/local-store.js";
import { ElementorParser } from "../services/elementor-parser.js";
import { logger } from "../utils/logger.js";
import { writeFile } from "node:fs/promises";
import type { ElementorElement, PageSettings } from "../types/elementor.js";

interface ElementorTemplate {
  version: string;
  title: string;
  type: "page" | "section" | "container";
  content: ElementorElement[];
  page_settings: PageSettings;
  metadata: {
    created: string;
    site?: string;
    elementor_cli_version: string;
  };
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Try using xclip on Linux, pbcopy on macOS
    const { spawn } = await import("node:child_process");

    const cmd =
      process.platform === "darwin"
        ? { name: "pbcopy", args: [] }
        : process.platform === "linux"
          ? { name: "xclip", args: ["-selection", "clipboard"] }
          : null;

    if (!cmd) {
      return false;
    }

    return new Promise((resolve) => {
      const proc = spawn(cmd.name, cmd.args, { stdio: ["pipe", "inherit", "inherit"] });
      proc.stdin.write(text);
      proc.stdin.end();
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

export const exportCommand = new Command("export")
  .description("Export page as Elementor-compatible JSON template")
  .argument("<page-id>", "Page ID to export")
  .option("-s, --site <name>", "Site name from config")
  .option("-o, --output <file>", "Save to file (default: <page-slug>.json)")
  .option("-c, --clipboard", "Copy to clipboard instead of saving to file")
  .option("--local", "Export from local storage instead of remote")
  .option("--raw", "Export raw elements without template wrapper")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli export 42                     Export page 42 to file
  $ elementor-cli export 42 -o my-template.json Save to specific file
  $ elementor-cli export 42 --clipboard         Copy to clipboard
  $ elementor-cli export 42 --local             Export from local storage
  $ elementor-cli export 42 --raw               Export raw elements only

Export formats:
  - Default: Elementor template format (importable via Templates > Import)
  - Raw: Just the elements array (for manual editing or API use)

The template can be imported in WordPress:
  1. Go to Templates > Saved Templates
  2. Click Import Templates
  3. Select the exported JSON file

See also:
  elementor-cli pull    Download page from WordPress
  elementor-cli push    Upload local changes
`
  )
  .action(async (pageId, options) => {
    try {
      const config = await readConfig();
      const { name: siteName, config: siteConfig } = await getSiteConfig(options.site);
      const id = parseInt(pageId, 10);

      if (isNaN(id)) {
        logger.error("Invalid page ID");
        process.exit(1);
      }

      const spinner = logger.spinner(`Exporting page ${id}...`);

      let elements: ElementorElement[];
      let settings: PageSettings;
      let title: string;
      let slug: string;

      if (options.local) {
        // Export from local storage
        const store = await LocalStore.create();
        const localData = await store.loadPage(siteName, id);

        if (!localData) {
          spinner.fail(`Page ${id} not found in local storage`);
          logger.info("Pull it first with: elementor-cli pull " + id);
          process.exit(1);
        }

        elements = localData.elements;
        settings = localData.settings;
        title = localData.meta.title;
        slug = localData.meta.slug;
      } else {
        // Export from remote
        const client = new WordPressClient(siteConfig);
        const parser = new ElementorParser();

        const page = await client.getPage(id);

        if (!client.isElementorPage(page)) {
          spinner.fail(`Page ${id} is not an Elementor page`);
          process.exit(1);
        }

        const pageData = parser.parseWPPage(page);
        elements = pageData.elementor_data;
        settings = pageData.page_settings;
        title = pageData.title;
        slug = pageData.slug;
      }

      let exportData: string;
      let description: string;

      if (options.raw) {
        // Export raw elements only
        exportData = JSON.stringify(elements, null, 2);
        description = "raw elements";
      } else {
        // Export as Elementor template
        const template: ElementorTemplate = {
          version: "0.4",
          title: title,
          type: "page",
          content: elements,
          page_settings: settings,
          metadata: {
            created: new Date().toISOString(),
            site: siteName,
            elementor_cli_version: "0.2.2",
          },
        };
        exportData = JSON.stringify(template, null, 2);
        description = "template";
      }

      if (options.clipboard) {
        const success = await copyToClipboard(exportData);
        if (success) {
          spinner.succeed(`Copied ${description} to clipboard (${exportData.length} chars)`);
        } else {
          spinner.fail("Failed to copy to clipboard");
          logger.info("Clipboard commands (pbcopy/xclip) may not be available");
          logger.info("Use --output to save to a file instead");
          process.exit(1);
        }
      } else {
        // Save to file
        const filename = options.output || `${slug}.json`;
        await writeFile(filename, exportData, "utf-8");
        spinner.succeed(`Exported ${description} to ${filename}`);
        logger.dim(`  Title: ${title}`);
        logger.dim(`  Elements: ${countElements(elements)}`);
        logger.dim(`  Size: ${(exportData.length / 1024).toFixed(1)} KB`);
      }
    } catch (error) {
      logger.error(`Export failed: ${error}`);
      process.exit(1);
    }
  });

function countElements(elements: ElementorElement[]): number {
  let count = 0;
  for (const el of elements) {
    count++;
    if (el.elements && el.elements.length > 0) {
      count += countElements(el.elements);
    }
  }
  return count;
}
