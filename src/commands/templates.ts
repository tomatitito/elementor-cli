import { Command } from "commander";
import { basename } from "node:path";
import { getSiteConfig } from "../utils/config-store.js";
import { logger, formatDate } from "../utils/logger.js";
import { confirmAction } from "../utils/prompts.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { TemplateStore } from "../services/template-store.js";
import { HtmlConverter } from "../services/html-converter.js";
import { TemplatePreview } from "../services/template-preview.js";
import type { TemplateSource, TemplateFile } from "../types/template.js";

export const templatesCommand = new Command("templates").description(
  "Manage page templates (save, import, preview)"
);

// templates list
templatesCommand
  .command("list")
  .description("List all available templates (built-in + custom)")
  .option("--source <type>", "Filter by source: built-in, global, project, custom")
  .option("--json", "Output as JSON")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli templates list
  $ elementor-cli templates list --source project
  $ elementor-cli templates list --json

See also:
  elementor-cli templates info      Show template details
  elementor-cli templates save      Save page as template
`
  )
  .action(async (options) => {
    try {
      const store = new TemplateStore();

      let templates;
      if (options.source === "custom") {
        templates = await store.listCustom();
      } else if (options.source) {
        templates = await store.listBySource(options.source as TemplateSource);
      } else {
        templates = await store.listAll();
      }

      if (options.json) {
        console.log(JSON.stringify(templates, null, 2));
        return;
      }

      if (templates.length === 0) {
        logger.info("No templates found.");
        return;
      }

      // Group by source for display
      const bySource = {
        "built-in": templates.filter((t) => t.source === "built-in"),
        global: templates.filter((t) => t.source === "global"),
        project: templates.filter((t) => t.source === "project"),
      };

      logger.heading("Templates");
      console.log("");

      if (bySource["built-in"].length > 0 && (!options.source || options.source === "built-in")) {
        console.log("Built-in:");
        for (const t of bySource["built-in"]) {
          console.log(`  ${t.slug.padEnd(24)} ${t.description || ""}`);
        }
        console.log("");
      }

      if (bySource.project.length > 0 && (!options.source || options.source === "project" || options.source === "custom")) {
        console.log("Custom (project):");
        for (const t of bySource.project) {
          const info = t.sourcePageId ? ` [from page ${t.sourcePageId}]` : "";
          console.log(`  ${t.slug.padEnd(24)} ${t.description || ""}${info}`);
        }
        console.log("");
      }

      if (bySource.global.length > 0 && (!options.source || options.source === "global" || options.source === "custom")) {
        console.log("Custom (global):");
        for (const t of bySource.global) {
          const info = t.sourcePageId ? ` [from page ${t.sourcePageId}]` : "";
          console.log(`  ${t.slug.padEnd(24)} ${t.description || ""}${info}`);
        }
        console.log("");
      }

      logger.dim(`${templates.length} template(s) found.`);
    } catch (error) {
      logger.error(`Failed to list templates: ${error}`);
      process.exit(1);
    }
  });

// templates save
templatesCommand
  .command("save <page-id>")
  .description("Save an existing page as a reusable template")
  .requiredOption("-n, --name <name>", "Template name")
  .option("-d, --description <desc>", "Template description")
  .option("-g, --global", "Save as global template (default: project)")
  .option("-s, --site <name>", "Site name from config")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli templates save 42 --name "My Hero Section"
  $ elementor-cli templates save 42 --name "Landing Page" --global
  $ elementor-cli templates save 42 --name "Contact Form" --description "Simple contact form layout"

See also:
  elementor-cli templates list    List all templates
  elementor-cli templates info    Show template details
`
  )
  .action(async (pageId, options) => {
    try {
      const { name: siteName, config } = await getSiteConfig(options.site);
      const spinner = logger.spinner(`Fetching page ${pageId} from ${siteName}...`);

      const client = new WordPressClient(config);
      const page = await client.getPage(parseInt(pageId, 10));

      if (!client.isElementorPage(page)) {
        spinner.stop();
        logger.error("This page is not an Elementor page.");
        process.exit(1);
      }

      const elementorData = JSON.parse(page.meta._elementor_data || "[]");
      const pageSettings = page.meta._elementor_page_settings
        ? JSON.parse(page.meta._elementor_page_settings)
        : {};

      const templateFile: TemplateFile = {
        name: options.name,
        slug: options.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
        description: options.description || "",
        elements: elementorData,
        settings: pageSettings,
        sourcePageId: parseInt(pageId, 10),
      };

      const store = new TemplateStore();
      await store.save(templateFile, !!options.global);

      const location = options.global ? "global" : "project";
      spinner.succeed(`Saved template "${options.name}" (${location})`);
    } catch (error) {
      logger.error(`Failed to save template: ${error}`);
      process.exit(1);
    }
  });

// templates import-html
templatesCommand
  .command("import-html <file>")
  .description("Convert an HTML file to an Elementor template")
  .option("-n, --name <name>", "Template name (default: filename)")
  .option("-d, --description <desc>", "Template description")
  .option("-g, --global", "Save as global template (default: project)")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli templates import-html landing.html
  $ elementor-cli templates import-html hero.html --name "Custom Hero" --global

Supported HTML conversions:
  <h1>-<h6>     -> heading widget
  <p>, <div>    -> text-editor widget
  <img>         -> image widget
  <a> (button)  -> button widget
  <section>     -> container element
  <ul>, <ol>    -> text-editor widget (preserves list)
  <video>       -> video widget

See also:
  elementor-cli templates list    List all templates
  elementor-cli templates info    Show template details
`
  )
  .action(async (file, options) => {
    try {
      const spinner = logger.spinner(`Converting ${file}...`);

      const converter = new HtmlConverter();
      const elements = await converter.convertFile(file);

      if (elements.length === 0) {
        spinner.stop();
        logger.warn("No convertible elements found in the HTML file.");
        return;
      }

      // Default name from filename
      const defaultName = basename(file, ".html")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const name = options.name || defaultName;

      const templateFile: TemplateFile = {
        name,
        slug: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
        description: options.description || `Converted from ${basename(file)}`,
        elements,
        settings: {},
      };

      const store = new TemplateStore();
      await store.save(templateFile, !!options.global);

      const location = options.global ? "global" : "project";
      spinner.succeed(`Imported template "${name}" (${location}) with ${countElements(elements)} element(s)`);
    } catch (error) {
      logger.error(`Failed to import HTML: ${error}`);
      process.exit(1);
    }
  });

// templates info
templatesCommand
  .command("info <template-name>")
  .description("Show template details")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli templates info hero-section
  $ elementor-cli templates info "My Custom Template"

See also:
  elementor-cli templates list      List all templates
  elementor-cli templates preview   Preview template
`
  )
  .action(async (templateName) => {
    try {
      const store = new TemplateStore();
      const template = await store.get(templateName);

      if (!template) {
        logger.error(`Template "${templateName}" not found.`);
        logger.info("Run 'elementor-cli templates list' to see available templates.");
        process.exit(1);
      }

      logger.heading(`Template: ${template.name}`);
      console.log(`  Slug:        ${template.slug}`);
      console.log(`  Source:      ${template.source}`);
      console.log(`  Description: ${template.description || "(none)"}`);

      if (template.sourcePageId) {
        console.log(`  Source Page: ${template.sourcePageId}`);
      }

      if (template.created_at) {
        console.log(`  Created:     ${formatDate(template.created_at)}`);
      }

      if (template.updated_at) {
        console.log(`  Updated:     ${formatDate(template.updated_at)}`);
      }

      // Count elements
      const elementCount = countElements(template.elements);
      console.log(`  Elements:    ${elementCount}`);

      // Show settings count
      const settingsCount = Object.keys(template.settings || {}).length;
      if (settingsCount > 0) {
        console.log(`  Settings:    ${settingsCount} key(s)`);
      }
    } catch (error) {
      logger.error(`Failed to get template info: ${error}`);
      process.exit(1);
    }
  });

// templates preview
templatesCommand
  .command("preview <template-name>")
  .description("Render a template in the browser for visual inspection")
  .option("-p, --port <port>", "Port for preview server", "3001")
  .option("--no-open", "Don't open browser automatically")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli templates preview hero-section
  $ elementor-cli templates preview "My Template" --port 8080
  $ elementor-cli templates preview landing-page --no-open

Note: This is a simplified preview. For full Elementor rendering,
      sync the template to staging first.

See also:
  elementor-cli templates list    List all templates
  elementor-cli templates info    Show template details
`
  )
  .action(async (templateName, options) => {
    try {
      const store = new TemplateStore();
      const template = await store.get(templateName);

      if (!template) {
        logger.error(`Template "${templateName}" not found.`);
        logger.info("Run 'elementor-cli templates list' to see available templates.");
        process.exit(1);
      }

      const port = parseInt(options.port, 10);
      const preview = new TemplatePreview();

      // Handle SIGINT to clean up
      process.on("SIGINT", async () => {
        await preview.stop();
        process.exit(0);
      });

      await preview.start(template, {
        port,
        open: options.open !== false,
      });
    } catch (error) {
      logger.error(`Failed to preview template: ${error}`);
      process.exit(1);
    }
  });

// templates delete
templatesCommand
  .command("delete <template-name>")
  .description("Remove a custom template (cannot delete built-in templates)")
  .option("-f, --force", "Delete without confirmation")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli templates delete "My Old Template"
  $ elementor-cli templates delete "Unused Layout" --force

See also:
  elementor-cli templates list    List all templates
`
  )
  .action(async (templateName, options) => {
    try {
      const store = new TemplateStore();

      // Check if template exists
      const source = await store.getSource(templateName);
      if (!source) {
        logger.error(`Template "${templateName}" not found.`);
        process.exit(1);
      }

      if (source === "built-in") {
        logger.error("Cannot delete built-in templates.");
        process.exit(1);
      }

      if (!options.force) {
        const confirmed = await confirmAction(
          `Delete ${source} template "${templateName}"? This cannot be undone.`
        );
        if (!confirmed) {
          logger.info("Cancelled.");
          return;
        }
      }

      const result = await store.delete(templateName);
      if (result.deleted) {
        logger.success(`Deleted ${result.source} template "${templateName}".`);
      } else {
        logger.error(`Failed to delete template "${templateName}".`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Failed to delete template: ${error}`);
      process.exit(1);
    }
  });

// templates export
templatesCommand
  .command("export <template-name>")
  .description("Export a template to a JSON file")
  .option("-o, --output <file>", "Output file path")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli templates export hero-section
  $ elementor-cli templates export "My Template" --output my-template.json

See also:
  elementor-cli templates list    List all templates
  elementor-cli templates info    Show template details
`
  )
  .action(async (templateName, options) => {
    try {
      const store = new TemplateStore();
      const template = await store.get(templateName);

      if (!template) {
        logger.error(`Template "${templateName}" not found.`);
        logger.info("Run 'elementor-cli templates list' to see available templates.");
        process.exit(1);
      }

      const outputFile = options.output || `${template.slug}.json`;

      // Export in a format compatible with Elementor import
      const exportData = {
        name: template.name,
        slug: template.slug,
        description: template.description,
        elements: template.elements,
        settings: template.settings,
        source: template.source,
        sourcePageId: template.sourcePageId,
        created_at: template.created_at,
        updated_at: template.updated_at,
        exported_at: new Date().toISOString(),
      };

      await Bun.write(outputFile, JSON.stringify(exportData, null, 2));
      logger.success(`Exported template to ${outputFile}`);
    } catch (error) {
      logger.error(`Failed to export template: ${error}`);
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
