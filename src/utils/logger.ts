import chalk from "chalk";
import ora, { type Ora } from "ora";

export const logger = {
  info: (message: string) => {
    console.log(chalk.blue("ℹ"), message);
  },

  success: (message: string) => {
    console.log(chalk.green("✓"), message);
  },

  warn: (message: string) => {
    console.log(chalk.yellow("⚠"), message);
  },

  error: (message: string) => {
    console.log(chalk.red("✗"), message);
  },

  dim: (message: string) => {
    console.log(chalk.dim(message));
  },

  table: (data: Record<string, string | number>[]) => {
    if (data.length === 0) {
      console.log(chalk.dim("No data"));
      return;
    }
    console.table(data);
  },

  spinner: (text: string): Ora => {
    return ora({ text, color: "cyan" }).start();
  },

  heading: (text: string) => {
    console.log(chalk.bold.cyan(`\n${text}\n`));
  },
};

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
