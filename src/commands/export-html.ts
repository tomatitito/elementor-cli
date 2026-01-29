import { Command } from "commander";
import { getSiteConfig, readConfig } from "../utils/config-store.js";
import { logger } from "../utils/logger.js";
import { DockerManager } from "../services/docker-manager.js";
import { mkdir, writeFile } from "node:fs/promises";

export const exportHtmlCommand = new Command("export-html")
  .description("Export page as static HTML")
  .argument("<page-id>", "Page ID to export")
  .option("-o, --output <file>", "Output file path (default: <page-slug>.html)")
  .option("-c, --compose-file <path>", "Path to docker-compose.yml")
  .option("--include-assets", "Download and include CSS/JS assets locally", false)
  .option("--base-url <url>", "Base URL for asset references")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli export-html 42
  $ elementor-cli export-html 42 -o homepage.html
  $ elementor-cli export-html 42 --include-assets

This command:
  1. Fetches the rendered HTML from staging WordPress
  2. Optionally downloads referenced CSS/JS assets
  3. Saves as a standalone HTML file

Requirements:
  - Staging environment must be running
  - Page must be synced to staging first

Use cases:
  - Create static backups of pages
  - Generate HTML for non-WordPress hosting
  - Offline previews

See also:
  elementor-cli preview sync     Sync page to staging first
  elementor-cli export           Export as Elementor JSON template
`
  )
  .action(async (pageId, options) => {
    try {
      const id = parseInt(pageId, 10);
      if (isNaN(id)) {
        logger.error("Invalid page ID");
        process.exit(1);
      }

      const config = await readConfig();
      const docker = await DockerManager.create(options.composeFile);

      // Check if staging is running
      const status = await docker.getStatus();
      if (!status.running) {
        logger.error("Staging environment is not running.");
        logger.info("Run 'elementor-cli preview start' first.");
        process.exit(1);
      }

      const spinner = logger.spinner(`Fetching page ${id} HTML...`);

      // Get the staging URL
      const stagingUrl = docker.getUrl();
      const pageUrl = `${stagingUrl}/?p=${id}`;

      // Fetch the rendered HTML
      const response = await fetch(pageUrl);
      if (!response.ok) {
        spinner.fail(`Failed to fetch page: HTTP ${response.status}`);
        process.exit(1);
      }

      let html = await response.text();

      // Get page title from HTML for default filename
      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : `page-${id}`;
      const slug = pageTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);

      // If base URL is specified, replace staging URLs with base URL
      if (options.baseUrl) {
        const baseUrl = options.baseUrl.replace(/\/$/, "");
        html = html.split(stagingUrl).join(baseUrl);
        spinner.text = `Replacing URLs with ${baseUrl}...`;
      }

      // If including assets, download CSS and JS
      if (options.includeAssets) {
        spinner.text = "Downloading assets...";

        const assetsDir = options.output
          ? options.output.replace(/\.html$/, "") + "_assets"
          : `${slug}_assets`;

        await mkdir(assetsDir, { recursive: true });

        // Find CSS links
        const cssLinks = html.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["'][^>]*>/gi);
        let cssCount = 0;
        for (const match of cssLinks) {
          const cssUrl = match[1];
          if (cssUrl.startsWith(stagingUrl) || cssUrl.startsWith("/")) {
            try {
              const fullUrl = cssUrl.startsWith("/")
                ? `${stagingUrl}${cssUrl}`
                : cssUrl;
              const cssResponse = await fetch(fullUrl);
              if (cssResponse.ok) {
                const cssContent = await cssResponse.text();
                const cssFilename = `style-${cssCount++}.css`;
                await writeFile(`${assetsDir}/${cssFilename}`, cssContent);
                html = html.replace(cssUrl, `${assetsDir}/${cssFilename}`);
              }
            } catch {
              // Skip failed asset downloads
            }
          }
        }

        // Find JS scripts
        const jsScripts = html.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*)["'][^>]*>/gi);
        let jsCount = 0;
        for (const match of jsScripts) {
          const jsUrl = match[1];
          if (jsUrl.startsWith(stagingUrl) || jsUrl.startsWith("/")) {
            try {
              const fullUrl = jsUrl.startsWith("/")
                ? `${stagingUrl}${jsUrl}`
                : jsUrl;
              const jsResponse = await fetch(fullUrl);
              if (jsResponse.ok) {
                const jsContent = await jsResponse.text();
                const jsFilename = `script-${jsCount++}.js`;
                await writeFile(`${assetsDir}/${jsFilename}`, jsContent);
                html = html.replace(jsUrl, `${assetsDir}/${jsFilename}`);
              }
            } catch {
              // Skip failed asset downloads
            }
          }
        }

        logger.dim(`  Downloaded ${cssCount} CSS and ${jsCount} JS files to ${assetsDir}/`);
      }

      // Add meta comment
      const exportComment = `\n<!-- Exported by elementor-cli from page ID ${id} on ${new Date().toISOString()} -->\n`;
      html = html.replace(/<head>/i, `<head>${exportComment}`);

      // Determine output path
      const outputPath = options.output || `${slug}.html`;

      // Write HTML file
      await writeFile(outputPath, html, "utf-8");

      spinner.succeed(`Exported page to ${outputPath}`);
      logger.dim(`  Title: ${pageTitle}`);
      logger.dim(`  Size: ${(html.length / 1024).toFixed(1)} KB`);
    } catch (error) {
      logger.error(`Export failed: ${error}`);
      process.exit(1);
    }
  });
