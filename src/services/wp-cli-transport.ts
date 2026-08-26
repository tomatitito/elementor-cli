import { spawn } from "node:child_process";
import { constants, access, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import {
  type ComposeWpCliConfig,
  ComposeWpCliConfigSchema,
  type SshWpCliConfig,
  SshWpCliConfigSchema,
  type WpCliConfig,
  WpCliConfigSchema,
} from "../types/config.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type WpCliStdin = string | Uint8Array | Readable;

export interface WpCliExecOptions {
  stdin?: WpCliStdin;
  /** WP-CLI loads no regular plugins by default. Set false when a command needs them. */
  skipPlugins?: boolean;
  /** WP-CLI loads no theme by default. Set false when a command needs it. */
  skipThemes?: boolean;
}

export interface WpCliTransport {
  exec(args: string[], options?: WpCliExecOptions): Promise<CommandResult>;
}

export interface ProcessCommand {
  executable: string;
  args: string[];
  cwd?: string;
}

export type ProcessRunner = (
  command: ProcessCommand,
  stdin?: WpCliStdin,
) => Promise<CommandResult>;

export class WpCliTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WpCliTransportError";
  }
}

const SENSITIVE_OPTION =
  /(password|passwd|(?:^|[_-])pass|dbpass|db_password|secret|token|api[_-]?key|private[_-]?key)/i;

/** Redacts common credential forms before text is included in an error or log. */
export function redactWpCliSecrets(text: string, args: string[] = []): string {
  const secrets: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const equals = argument.indexOf("=");
    if (equals > 2 && SENSITIVE_OPTION.test(argument.slice(0, equals))) {
      secrets.push(argument.slice(equals + 1));
    } else if (SENSITIVE_OPTION.test(argument) && args[index + 1]) {
      secrets.push(args[index + 1]);
      index++;
    }
  }

  let redacted = text
    .replace(
      /((?:password|passwd|(?:\w+[_-])pass|dbpass|db_password|secret|token|api[_-]?key|private[_-]?key)\s*[=:]\s*)([^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, "$1[REDACTED]");

  for (const secret of secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function resolveProjectFile(
  projectRoot: string,
  configuredPath: string,
): string {
  if (!configuredPath || /[\0\r\n]/.test(configuredPath)) {
    throw new WpCliTransportError("Invalid project file path.");
  }
  const root = resolve(projectRoot);
  const resolved = resolve(root, configuredPath);
  const pathFromRoot = relative(root, resolved);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new WpCliTransportError(
      "Configured files must be inside the project root.",
    );
  }
  return resolved;
}

function wpGlobalArgs(args: string[], options: WpCliExecOptions): string[] {
  const globals: string[] = [];
  if (
    options.skipPlugins !== false &&
    !args.some((arg) => arg.startsWith("--skip-plugins"))
  ) {
    globals.push("--skip-plugins");
  }
  if (
    options.skipThemes !== false &&
    !args.some((arg) => arg.startsWith("--skip-themes"))
  ) {
    globals.push("--skip-themes");
  }
  return globals;
}

function validateArgs(args: string[]): void {
  if (
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string" || arg.includes("\0"))
  ) {
    throw new WpCliTransportError(
      "WP-CLI arguments must be strings without null bytes.",
    );
  }
}

function shellQuote(argument: string): string {
  return `'${argument.replace(/'/g, `'"'"'`)}'`;
}

export function buildSshWpCliCommand(
  configInput: SshWpCliConfig,
  args: string[],
  options: WpCliExecOptions = {},
): ProcessCommand {
  const config = SshWpCliConfigSchema.parse(configInput);
  validateArgs(args);
  const remoteArgs = [
    "wp",
    `--path=${config.path}`,
    ...wpGlobalArgs(args, options),
    ...args,
  ];
  return {
    executable: "ssh",
    args: [
      "-o",
      "StrictHostKeyChecking=yes",
      config.host,
      remoteArgs.map(shellQuote).join(" "),
    ],
  };
}

export function buildComposeWpCliCommand(
  configInput: ComposeWpCliConfig,
  projectRoot: string,
  args: string[],
  options: WpCliExecOptions = {},
): ProcessCommand {
  const config = ComposeWpCliConfigSchema.parse(configInput);
  validateArgs(args);
  const composeFile = resolveProjectFile(projectRoot, config.composeFile);
  const commandArgs = ["compose", "-f", composeFile];
  if (config.envFile) {
    commandArgs.push(
      "--env-file",
      resolveProjectFile(projectRoot, config.envFile),
    );
  }
  if (config.projectName) {
    commandArgs.push("--project-name", config.projectName);
  }
  commandArgs.push(config.mode, "-T");
  if (config.mode === "run") {
    commandArgs.push("--rm");
  }
  commandArgs.push(
    config.service,
    "wp",
    ...wpGlobalArgs(args, options),
    ...args,
  );
  return {
    executable: config.runtime,
    args: commandArgs,
    cwd: resolve(projectRoot),
  };
}

async function assertProjectFile(
  projectRoot: string,
  path: string,
): Promise<void> {
  const configured = resolveProjectFile(projectRoot, path);
  try {
    const [realRoot, realFile, fileStat] = await Promise.all([
      realpath(projectRoot),
      realpath(configured),
      stat(configured),
      access(configured, constants.R_OK),
    ]);
    if (!fileStat.isFile()) throw new Error("not a file");
    const pathFromRoot = relative(realRoot, realFile);
    if (
      pathFromRoot === ".." ||
      pathFromRoot.startsWith(
        `..${process.platform === "win32" ? "\\" : "/"}`,
      ) ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error("outside project root");
    }
  } catch {
    throw new WpCliTransportError(
      `Configured file is missing, unreadable, or outside the project root: ${path}`,
    );
  }
}

export const runWpCliProcess: ProcessRunner = (command, stdin) =>
  new Promise((resolveResult, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && !settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (exitCode) => {
      if (!settled) {
        settled = true;
        resolveResult({ stdout, stderr, exitCode: exitCode ?? 1 });
      }
    });

    if (stdin && typeof stdin === "object" && "pipe" in stdin) {
      stdin.pipe(child.stdin);
    } else {
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    }
  });

async function runSafely(
  runner: ProcessRunner,
  command: ProcessCommand,
  args: string[],
  stdin?: WpCliStdin,
): Promise<CommandResult> {
  try {
    return await runner(command, stdin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WpCliTransportError(
      redactWpCliSecrets(`Unable to start WP-CLI transport: ${message}`, args),
    );
  }
}

export class SshWpCliTransport implements WpCliTransport {
  private readonly config: SshWpCliConfig;

  constructor(
    config: SshWpCliConfig,
    private readonly runner = runWpCliProcess,
  ) {
    this.config = SshWpCliConfigSchema.parse(config);
  }

  exec(args: string[], options: WpCliExecOptions = {}): Promise<CommandResult> {
    const command = buildSshWpCliCommand(this.config, args, options);
    return runSafely(this.runner, command, args, options.stdin);
  }
}

export class ComposeWpCliTransport implements WpCliTransport {
  private readonly config: ComposeWpCliConfig;
  private readonly projectRoot: string;

  constructor(
    config: ComposeWpCliConfig,
    projectRoot = process.cwd(),
    private readonly runner = runWpCliProcess,
  ) {
    this.config = ComposeWpCliConfigSchema.parse(config);
    this.projectRoot = resolve(projectRoot);
    resolveProjectFile(this.projectRoot, this.config.composeFile);
    if (this.config.envFile)
      resolveProjectFile(this.projectRoot, this.config.envFile);
  }

  async exec(
    args: string[],
    options: WpCliExecOptions = {},
  ): Promise<CommandResult> {
    await assertProjectFile(this.projectRoot, this.config.composeFile);
    if (this.config.envFile)
      await assertProjectFile(this.projectRoot, this.config.envFile);
    const command = buildComposeWpCliCommand(
      this.config,
      this.projectRoot,
      args,
      options,
    );
    return runSafely(this.runner, command, args, options.stdin);
  }
}

export function createWpCliTransport(
  configInput: WpCliConfig,
  projectRoot = process.cwd(),
): WpCliTransport {
  const config = WpCliConfigSchema.parse(configInput);
  return config.type === "ssh"
    ? new SshWpCliTransport(config)
    : new ComposeWpCliTransport(config, projectRoot);
}
