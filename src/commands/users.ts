import { Command } from "commander";
import {
  UsersOperationalError,
  collectUsers,
  formatUsersHuman,
  usersReportJson,
  validateRole,
  validateSiteName,
  writeUsersReport,
} from "../services/users.js";
import { createWpCliTransport } from "../services/wp-cli-transport.js";
import { getSiteConfig } from "../utils/config-store.js";

interface UsersListOptions {
  site: string;
  role?: string;
  json?: boolean;
  output?: string;
  includeEmail?: boolean;
}

function safeError(error: unknown): string {
  if (error instanceof UsersOperationalError) return error.message;
  return "Unable to list users: site configuration or WP-CLI connection failed.";
}

export const usersCommand = new Command("users").description(
  "Read WordPress users through a configured WP-CLI transport",
);

usersCommand
  .command("list")
  .description("List a site's users using a fixed safe field allowlist")
  .requiredOption("-s, --site <name>", "Explicit site name")
  .option("--role <role>", "Only include users with this role")
  .option("--include-email", "Include user email addresses")
  .option("--json", "Print stable JSON")
  .option("-o, --output <path>", "Write stable JSON to a local file")
  .action(async (options: UsersListOptions) => {
    try {
      const siteName = validateSiteName(options.site);
      const role = validateRole(options.role);
      const site = await getSiteConfig(siteName);
      if (!site.config.wpCli) {
        throw new UsersOperationalError(
          "invalid-input",
          "The selected site has no WP-CLI transport configured.",
        );
      }
      const report = await collectUsers(
        createWpCliTransport(site.config.wpCli),
        siteName,
        { includeEmail: options.includeEmail, role },
      );
      if (options.output) await writeUsersReport(options.output, report);
      if (options.json) process.stdout.write(usersReportJson(report));
      else if (!options.output) process.stdout.write(formatUsersHuman(report));
      else console.log("Users JSON written.");
      process.exitCode = 0;
    } catch (error) {
      const message = safeError(error);
      if (options.json) {
        console.error(
          JSON.stringify({
            schemaVersion: 1,
            command: "users list",
            status: "error",
            error: message,
          }),
        );
      } else {
        console.error(`Error: ${message}`);
      }
      process.exitCode = 2;
    }
  });
