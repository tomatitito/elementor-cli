#!/usr/bin/env bun
import { Command } from "commander";
import { configCommand } from "./commands/config.js";
import { pagesCommand } from "./commands/pages.js";
import { pullCommand } from "./commands/pull.js";
import { pushCommand } from "./commands/push.js";
import { diffCommand } from "./commands/diff.js";
import { previewCommand } from "./commands/preview.js";
import { dbCommand } from "./commands/db.js";
import { revisionsCommand } from "./commands/revisions.js";
import { regenerateCssCommand } from "./commands/regenerate-css.js";
import { auditCommand } from "./commands/audit.js";
import { searchReplaceCommand } from "./commands/search-replace.js";
import { statusCommand } from "./commands/status.js";
import { studioCommand } from "./commands/studio.js";
import { exportCommand } from "./commands/export.js";
import { exportHtmlCommand } from "./commands/export-html.js";
import { updateCommand } from "./commands/update.js";
import pkg from "../package.json";

const program = new Command();

program
  .name("elementor-cli")
  .description("Manage Elementor pages from the command line")
  .version(pkg.version)
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli config init                    Initialize configuration
  $ elementor-cli config add production          Add a site
  $ elementor-cli pages list                     List all Elementor pages
  $ elementor-cli pull 42                        Download page with ID 42
  $ elementor-cli push 42                        Upload local changes
  $ elementor-cli preview start                  Start local staging
  $ elementor-cli diff 42                        Compare local vs remote

Documentation: https://github.com/YOUR_USERNAME/elementor-cli
`
  );

program.addCommand(configCommand);
program.addCommand(pagesCommand);
program.addCommand(pullCommand);
program.addCommand(pushCommand);
program.addCommand(diffCommand);
program.addCommand(previewCommand);
program.addCommand(dbCommand);
program.addCommand(revisionsCommand);
program.addCommand(regenerateCssCommand);
program.addCommand(auditCommand);
program.addCommand(searchReplaceCommand);
program.addCommand(statusCommand);
program.addCommand(studioCommand);
program.addCommand(exportCommand);
program.addCommand(exportHtmlCommand);
program.addCommand(updateCommand);

program.parse();
