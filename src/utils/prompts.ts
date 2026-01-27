import { input, password, confirm, select } from "@inquirer/prompts";

export async function promptSiteConfig() {
  const name = await input({
    message: "Site name (identifier):",
    default: "production",
    validate: (value) => {
      if (!value.trim()) return "Site name is required";
      if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        return "Site name can only contain letters, numbers, dashes, and underscores";
      }
      return true;
    },
  });

  const url = await input({
    message: "WordPress site URL:",
    validate: (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return "Please enter a valid URL";
      }
    },
  });

  const username = await input({
    message: "WordPress username:",
    validate: (value) => (value.trim() ? true : "Username is required"),
  });

  const appPassword = await password({
    message: "Application password:",
    validate: (value) => (value.trim() ? true : "Application password is required"),
  });

  return { name, url, username, appPassword };
}

export async function confirmAction(message: string): Promise<boolean> {
  return confirm({ message, default: false });
}

export async function selectFromList<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>
): Promise<T> {
  return select({ message, choices });
}
