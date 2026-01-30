import { Command } from "commander";
import { getSiteConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { confirmAction } from "../utils/prompts.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { listTemplates } from "../services/template-library.js";
import { TemplateStore } from "../services/template-store.js";

export const pagesCommand = new Command("pages").description(
  "List and manage pages"
);

// pages list
pagesCommand
  .command("list")
  .description("List all Elementor pages on remote site")
  .option("-s, --site <name>", "Site name from config")
  .option(
    "--status <status>",
    "Filter by status (publish, draft, private, all)",
    "all"
  )
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli pages list
  $ elementor-cli pages list --site production
  $ elementor-cli pages list --status draft

See also:
  elementor-cli pages info     Show page details
  elementor-cli pull           Download a page
`
  )
  .action(async (options) => {
    try {
      const { name: siteName, config } = await getSiteConfig(options.site);
      const spinner = logger.spinner(`Fetching pages from ${siteName}...`);

      const client = new WordPressClient(config);
      const pages = await client.listPages({ status: options.status });

      spinner.stop();

      const elementorPages = pages.filter((p) => client.isElementorPage(p));

      if (elementorPages.length === 0) {
        logger.info("No Elementor pages found.");
        return;
      }

      logger.heading(`Elementor Pages (${siteName})`);
      console.log(
        "ID".padEnd(8) +
          "Title".padEnd(40) +
          "Status".padEnd(12) +
          "Modified"
      );
      console.log("─".repeat(75));

      for (const page of elementorPages) {
        const rawTitle = page.title.raw || page.title.rendered;
        const title =
          rawTitle.slice(0, 38) + (rawTitle.length > 38 ? "…" : "");
        console.log(
          String(page.id).padEnd(8) +
            title.padEnd(40) +
            page.status.padEnd(12) +
            formatDate(page.modified)
        );
      }

      logger.dim(`\n${elementorPages.length} Elementor page(s) found.`);
    } catch (error) {
      logger.error(`Failed to list pages: ${error}`);
      process.exit(1);
    }
  });

// pages info
pagesCommand
  .command("info <page-id>")
  .description("Show page details")
  .option("-s, --site <name>", "Site name from config")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli pages info 42
  $ elementor-cli pages info 42 --site production

See also:
  elementor-cli pages list     List all pages
  elementor-cli pull           Download a page
`
  )
  .action(async (pageId, options) => {
    try {
      const { name: siteName, config } = await getSiteConfig(options.site);
      const spinner = logger.spinner(`Fetching page ${pageId}...`);

      const client = new WordPressClient(config);
      const page = await client.getPage(parseInt(pageId, 10));

      spinner.stop();

      logger.heading(`Page: ${page.title.raw || page.title.rendered}`);
      console.log(`  ID:       ${page.id}`);
      console.log(`  Slug:     ${page.slug}`);
      console.log(`  Status:   ${page.status}`);
      console.log(`  Template: ${page.template || "default"}`);
      console.log(`  Modified: ${formatDate(page.modified)}`);
      console.log(`  URL:      ${page.link}`);

      const isElementor = client.isElementorPage(page);
      console.log(`  Elementor: ${isElementor ? "Yes" : "No"}`);

      if (isElementor && page.meta._elementor_data) {
        try {
          const elements = JSON.parse(page.meta._elementor_data);
          console.log(`  Elements: ${countElements(elements)} total`);
        } catch {
          console.log(`  Elements: (unable to parse)`);
        }
      }
    } catch (error) {
      logger.error(`Failed to get page info: ${error}`);
      process.exit(1);
    }
  });

// pages create
pagesCommand
  .command("create <title>")
  .description("Create a new Elementor page")
  .option("-s, --site <name>", "Site name from config")
  .option("--status <status>", "Page status (draft, publish)", "draft")
  .option("-t, --template <name>", "Use a template (run 'pages templates' to list)")
  .option("--page-template <template>", "WordPress page template (e.g., elementor_canvas, elementor_header_footer)")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli pages create "My New Page"
  $ elementor-cli pages create "Landing Page" --status publish
  $ elementor-cli pages create "About Us" --site production
  $ elementor-cli pages create "Home" --template landing-page
  $ elementor-cli pages create "Features" --template three-column-features
  $ elementor-cli pages create "Canvas Page" --page-template elementor_canvas

WordPress page templates:
  default                 Theme default template
  elementor_canvas        Full-width, no header/footer
  elementor_header_footer Elementor content with theme header/footer

Available content templates:
  blank                   Empty page with no content
  hero-section            Full-width hero with heading, text, and CTA
  two-column              Two-column layout with image and text
  three-column-features   Three-column grid for features/services
  contact-form            Contact information section
  landing-page            Full landing page with hero, features, CTA

Run 'elementor-cli pages templates' for full template list.

See also:
  elementor-cli pages list       List all pages
  elementor-cli pages templates  List available templates
  elementor-cli pull             Download a page
`
  )
  .action(async (title, options) => {
    try {
      const { name: siteName, config } = await getSiteConfig(options.site);

      // Get template if specified (supports built-in, global, and project templates)
      let elementorData: string | undefined;
      let pageSettings: Record<string, unknown> | undefined;

      if (options.template) {
        const store = new TemplateStore();
        const template = await store.getWithFreshIds(options.template);
        if (!template) {
          logger.error(`Template "${options.template}" not found.`);
          logger.info("Run 'elementor-cli templates list' to see available templates.");
          process.exit(1);
        }
        elementorData = JSON.stringify(template.elements);
        pageSettings = template.settings as Record<string, unknown>;
        logger.dim(`Using template: ${template.name} (${template.source})`);
      }

      const spinner = logger.spinner(`Creating page "${title}"...`);

      const client = new WordPressClient(config);
      const page = await client.createPage({
        title,
        status: options.status,
        template: options.pageTemplate,
        elementorData,
        pageSettings,
      });

      spinner.succeed(`Created page "${title}" (ID: ${page.id})`);
      logger.dim(`Edit URL: ${config.url}/wp-admin/post.php?post=${page.id}&action=elementor`);
    } catch (error) {
      logger.error(`Failed to create page: ${error}`);
      process.exit(1);
    }
  });

// pages templates
pagesCommand
  .command("templates")
  .description("List available page templates")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli pages templates

Use templates when creating pages:
  $ elementor-cli pages create "Home" --template landing-page

See also:
  elementor-cli pages create     Create a new page
  elementor-cli templates list   Full template management
`
  )
  .action(async () => {
    const store = new TemplateStore();
    const templates = await store.listAll();

    logger.heading("Available Page Templates");
    console.log("");

    // Group by source
    const builtIn = templates.filter((t) => t.source === "built-in");
    const project = templates.filter((t) => t.source === "project");
    const global = templates.filter((t) => t.source === "global");

    if (builtIn.length > 0) {
      console.log("Built-in:");
      for (const t of builtIn) {
        console.log(`  ${t.slug.padEnd(24)} ${t.description || ""}`);
      }
      console.log("");
    }

    if (project.length > 0) {
      console.log("Custom (project):");
      for (const t of project) {
        console.log(`  ${t.slug.padEnd(24)} ${t.description || ""}`);
      }
      console.log("");
    }

    if (global.length > 0) {
      console.log("Custom (global):");
      for (const t of global) {
        console.log(`  ${t.slug.padEnd(24)} ${t.description || ""}`);
      }
      console.log("");
    }

    logger.dim("Usage: elementor-cli pages create <title> --template <template-name>");
    logger.dim("For more template options: elementor-cli templates --help");
  });

// pages delete
pagesCommand
  .command("delete <page-id>")
  .description("Delete a page")
  .option("-s, --site <name>", "Site name from config")
  .option("-f, --force", "Skip confirmation and permanently delete")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli pages delete 42
  $ elementor-cli pages delete 42 --force
  $ elementor-cli pages delete 42 --site production

See also:
  elementor-cli pages list     List all pages
`
  )
  .action(async (pageId, options) => {
    try {
      const { name: siteName, config } = await getSiteConfig(options.site);

      if (!options.force) {
        const confirmed = await confirmAction(
          `Delete page ${pageId} from ${siteName}? This cannot be undone.`
        );
        if (!confirmed) {
          logger.info("Cancelled.");
          return;
        }
      }

      const spinner = logger.spinner(`Deleting page ${pageId}...`);

      const client = new WordPressClient(config);
      await client.deletePage(parseInt(pageId, 10), true);

      spinner.succeed(`Deleted page ${pageId}`);
    } catch (error) {
      logger.error(`Failed to delete page: ${error}`);
      process.exit(1);
    }
  });

function countElements(elements: unknown[]): number {
  let count = 0;
  for (const el of elements) {
    count++;
    if (
      typeof el === "object" &&
      el !== null &&
      "elements" in el &&
      Array.isArray((el as { elements: unknown[] }).elements)
    ) {
      count += countElements((el as { elements: unknown[] }).elements);
    }
  }
  return count;
}
