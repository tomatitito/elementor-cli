import { parse, stringify } from "yaml";
import { ConfigSchema, type Config, type SiteConfig } from "../types/config.js";

const CONFIG_FILE = ".elementor-cli.yaml";

export async function getConfigPath(): Promise<string> {
  // Support custom config path via environment variable (useful for testing)
  const envPath = process.env.ELEMENTOR_CLI_CONFIG;
  if (envPath) {
    return envPath;
  }
  return `${process.cwd()}/${CONFIG_FILE}`;
}

export async function configExists(): Promise<boolean> {
  const path = await getConfigPath();
  const file = Bun.file(path);
  return file.exists();
}

export async function readConfig(): Promise<Config> {
  const path = await getConfigPath();
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return ConfigSchema.parse({});
  }

  const content = await file.text();
  const parsed = parse(content);
  return ConfigSchema.parse(parsed);
}

export async function writeConfig(config: Config): Promise<void> {
  const path = await getConfigPath();
  const content = stringify(config);
  await Bun.write(path, content);
}

export async function getSiteConfig(siteName?: string): Promise<{ name: string; config: SiteConfig }> {
  const config = await readConfig();

  const name = siteName || config.defaultSite;
  if (!name) {
    throw new Error("No site specified and no default site configured. Run 'elementor-cli config add' first.");
  }

  const siteConfig = config.sites[name];
  if (!siteConfig) {
    throw new Error(`Site '${name}' not found in config. Available sites: ${Object.keys(config.sites).join(", ") || "none"}`);
  }

  return { name, config: siteConfig };
}

export async function addSite(name: string, site: SiteConfig): Promise<void> {
  const config = await readConfig();
  config.sites[name] = site;
  if (!config.defaultSite) {
    config.defaultSite = name;
  }
  await writeConfig(config);
}

export async function removeSite(name: string): Promise<boolean> {
  const config = await readConfig();
  if (!config.sites[name]) {
    return false;
  }
  delete config.sites[name];
  if (config.defaultSite === name) {
    const sites = Object.keys(config.sites);
    config.defaultSite = sites.length > 0 ? sites[0] : undefined;
  }
  await writeConfig(config);
  return true;
}

export async function setDefaultSite(name: string): Promise<void> {
  const config = await readConfig();
  if (!config.sites[name]) {
    throw new Error(`Site '${name}' not found in config.`);
  }
  config.defaultSite = name;
  await writeConfig(config);
}

export async function listSites(): Promise<Array<{ name: string; url: string; isDefault: boolean }>> {
  const config = await readConfig();
  return Object.entries(config.sites).map(([name, site]) => ({
    name,
    url: site.url,
    isDefault: name === config.defaultSite,
  }));
}
