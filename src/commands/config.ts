import { Command } from "commander";
import {
  configExists,
  writeConfig,
  readConfig,
  addSite,
  removeSite,
  setDefaultSite,
  listSites,
  getSiteConfig,
} from "../utils/config-store.js";
import { promptSiteConfig, confirmAction } from "../utils/prompts.js";
import { logger } from "../utils/logger.js";
import { ConfigSchema } from "../types/config.js";
import { WordPressClient } from "../services/wordpress-client.js";

export const configCommand = new Command("config").description(
  "Manage site connections and settings"
);

// config init
configCommand
  .command("init")
  .description("Initialize a new Elementor CLI configuration")
  .option("-f, --force", "Overwrite existing config file")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli config init              Interactive setup (recommended)
  $ elementor-cli config init --force      Overwrite existing config

See also:
  elementor-cli config add     Add a new site configuration
  elementor-cli config test    Test site connectivity
`
  )
  .action(async (options) => {
    try {
      if ((await configExists()) && !options.force) {
        logger.warn("Config file already exists. Use --force to overwrite.");
        return;
      }

      logger.heading("Elementor CLI Setup");

      const siteConfig = await promptSiteConfig();

      const config = ConfigSchema.parse({
        defaultSite: siteConfig.name,
        sites: {
          [siteConfig.name]: {
            url: siteConfig.url,
            username: siteConfig.username,
            appPassword: siteConfig.appPassword,
          },
        },
      });

      await writeConfig(config);
      logger.success(`Config saved to .elementor-cli.yaml`);
      logger.info(`Default site: ${siteConfig.name}`);
      logger.dim("Run 'elementor-cli config test' to verify the connection.");
    } catch (error) {
      logger.error(`Failed to initialize config: ${error}`);
      process.exit(1);
    }
  });

// config add
configCommand
  .command("add <name>")
  .description("Add a new site configuration")
  .option("-u, --url <url>", "WordPress site URL")
  .option("--username <username>", "Admin username")
  .option("--app-password <password>", "Application password")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli config add production    Interactive mode
  $ elementor-cli config add staging \\
      --url https://staging.example.com \\
      --username admin \\
      --app-password "xxxx xxxx xxxx xxxx"

See also:
  elementor-cli config list    List configured sites
  elementor-cli config test    Test site connectivity
`
  )
  .action(async (name, options) => {
    try {
      const config = await readConfig();
      if (config.sites[name]) {
        const overwrite = await confirmAction(
          `Site '${name}' already exists. Overwrite?`
        );
        if (!overwrite) {
          logger.info("Cancelled.");
          return;
        }
      }

      let url = options.url;
      let username = options.username;
      let appPassword = options.appPassword;

      if (!url || !username || !appPassword) {
        const prompted = await promptSiteConfig();
        url = url || prompted.url;
        username = username || prompted.username;
        appPassword = appPassword || prompted.appPassword;
      }

      await addSite(name, { url, username, appPassword });
      logger.success(`Site '${name}' added successfully.`);
    } catch (error) {
      logger.error(`Failed to add site: ${error}`);
      process.exit(1);
    }
  });

// config remove
configCommand
  .command("remove <name>")
  .description("Remove a site configuration")
  .option("-f, --force", "Skip confirmation")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli config remove staging
  $ elementor-cli config remove staging --force

See also:
  elementor-cli config list    List configured sites
`
  )
  .action(async (name, options) => {
    try {
      if (!options.force) {
        const confirmed = await confirmAction(
          `Remove site '${name}' from config?`
        );
        if (!confirmed) {
          logger.info("Cancelled.");
          return;
        }
      }

      const removed = await removeSite(name);
      if (removed) {
        logger.success(`Site '${name}' removed.`);
      } else {
        logger.warn(`Site '${name}' not found.`);
      }
    } catch (error) {
      logger.error(`Failed to remove site: ${error}`);
      process.exit(1);
    }
  });

// config list
configCommand
  .command("list")
  .description("List configured sites")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli config list
`
  )
  .action(async () => {
    try {
      const sites = await listSites();
      if (sites.length === 0) {
        logger.info(
          "No sites configured. Run 'elementor-cli config init' to add one."
        );
        return;
      }

      logger.heading("Configured Sites");
      for (const site of sites) {
        const defaultMark = site.isDefault ? " (default)" : "";
        console.log(`  ${site.name}${defaultMark}`);
        console.log(`    URL: ${site.url}`);
      }
    } catch (error) {
      logger.error(`Failed to list sites: ${error}`);
      process.exit(1);
    }
  });

// config use
configCommand
  .command("use <name>")
  .description("Set the default site")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli config use production
  $ elementor-cli config use staging

See also:
  elementor-cli config list    List configured sites
`
  )
  .action(async (name) => {
    try {
      await setDefaultSite(name);
      logger.success(`Default site set to '${name}'.`);
    } catch (error) {
      logger.error(`${error}`);
      process.exit(1);
    }
  });

// config set
configCommand
  .command("set <key> <value>")
  .description("Set a config value")
  .addHelpText(
    "after",
    `
Available keys:
  staging.path       Path to docker-compose.yml
  staging.service    WordPress service name in compose file
  staging.url        Local staging URL
  pagesDir           Directory for local page storage

Examples:
  $ elementor-cli config set staging.path ./docker
  $ elementor-cli config set staging.url http://localhost:3000
  $ elementor-cli config set pagesDir ./my-pages
`
  )
  .action(async (key, value) => {
    try {
      const config = await readConfig();

      const keys = key.split(".");
      let obj: Record<string, unknown> = config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (typeof obj[keys[i]] !== "object" || obj[keys[i]] === null) {
          obj[keys[i]] = {};
        }
        obj = obj[keys[i]] as Record<string, unknown>;
      }
      obj[keys[keys.length - 1]] = value;

      await writeConfig(config);
      logger.success(`Set ${key} = ${value}`);
    } catch (error) {
      logger.error(`Failed to set config: ${error}`);
      process.exit(1);
    }
  });

// config test
configCommand
  .command("test [name]")
  .description("Test connection to a WordPress site")
  .addHelpText(
    "after",
    `
Examples:
  $ elementor-cli config test              Test default site
  $ elementor-cli config test production   Test specific site

See also:
  elementor-cli config list    List configured sites
`
  )
  .action(async (name) => {
    try {
      const { name: siteName, config } = await getSiteConfig(name);
      const spinner = logger.spinner(`Testing connection to ${siteName}...`);

      const client = new WordPressClient(config);
      const user = await client.testConnection();

      spinner.succeed(`Connected to ${siteName} as '${user.name}'`);
      logger.dim(`Site URL: ${config.url}`);
    } catch (error) {
      logger.error(`Connection failed: ${error}`);
      process.exit(1);
    }
  });
