import { homedir } from "node:os";

/**
 * Configuration file name
 */
export const CONFIG_FILE = ".elementor-cli.yaml";

/**
 * Base directory name for CLI data
 */
export const CLI_DIR = ".elementor-cli";

/**
 * Default path for pages directory (relative to project root)
 */
export const DEFAULT_PAGES_DIR = `${CLI_DIR}/pages`;

/**
 * Default path for staging directory (relative to project root)
 */
export const DEFAULT_STAGING_DIR = `${CLI_DIR}/staging`;

/**
 * Default path for templates directory (relative to project root)
 */
export const PROJECT_TEMPLATES_DIR = `${CLI_DIR}/templates`;

/**
 * Default path for database dumps directory (relative to project root)
 */
export const DUMPS_DIR = `${CLI_DIR}/dumps`;

/**
 * Global templates directory (user home)
 */
export const GLOBAL_TEMPLATES_DIR =
  process.env.ELEMENTOR_CLI_GLOBAL_TEMPLATES || `${homedir()}/${CLI_DIR}/templates`;
