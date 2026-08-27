import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { CommandResult, WpCliTransport } from "./wp-cli-transport.js";

const ROLE_PATTERN = /^[a-z0-9_-]+$/;
const REGISTERED_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function hasUnsafeTerminalText(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return (
      point <= 0x1f ||
      (point >= 0x7f && point <= 0x9f) ||
      (point >= 0x202a && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069)
    );
  });
}

const safeText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !hasUnsafeTerminalText(value));

const idSchema = z.union([
  z.number().int().positive().safe(),
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine(Number.isSafeInteger),
]);

const commonRawUser = {
  ID: idSchema,
  user_login: safeText(60),
  roles: safeText(4096),
  user_registered: z.string().regex(REGISTERED_PATTERN),
};

const rawUserSchema = z.object(commonRawUser).strict();
const rawUserWithEmailSchema = z
  .object({ ...commonRawUser, user_email: safeText(320) })
  .strict();

export interface ListedUser {
  id: number;
  username: string;
  roles: string[];
  registeredAt: string;
  email?: string;
}

export interface UsersListReport {
  schemaVersion: 1;
  site: string;
  collectedAt: string;
  users: ListedUser[];
}

export type UsersErrorKind =
  | "invalid-input"
  | "connection"
  | "invalid-output"
  | "output-file";

export class UsersOperationalError extends Error {
  constructor(
    readonly kind: UsersErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "UsersOperationalError";
  }
}

export function validateSiteName(site: string): string {
  if (!site || site.length > 128 || hasUnsafeTerminalText(site)) {
    throw new UsersOperationalError("invalid-input", "Invalid site name.");
  }
  return site;
}

export function validateRole(role: string | undefined): string | undefined {
  if (role !== undefined && !ROLE_PATTERN.test(role)) {
    throw new UsersOperationalError(
      "invalid-input",
      "Role must contain only lowercase letters, numbers, underscores, or hyphens.",
    );
  }
  return role;
}

export function usersListArgs(includeEmail: boolean, role?: string): string[] {
  const fields = ["ID", "user_login", "roles", "user_registered"];
  if (includeEmail) fields.push("user_email");
  const args = [
    "user",
    "list",
    `--fields=${fields.join(",")}`,
    "--format=json",
    "--orderby=ID",
    "--order=ASC",
  ];
  const validRole = validateRole(role);
  if (validRole) args.push(`--role=${validRole}`);
  return args;
}

function parseRoles(value: string): string[] {
  if (!value) return [];
  const roles = value.split(",");
  if (
    roles.length > 100 ||
    roles.some((role) => !ROLE_PATTERN.test(role) || role.length > 191)
  ) {
    throw new UsersOperationalError(
      "invalid-output",
      "WP-CLI returned malformed or unsafe user data.",
    );
  }
  return [...new Set(roles)].sort((left, right) => left.localeCompare(right));
}

export function parseUsersList(
  output: string,
  includeEmail: boolean,
): ListedUser[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(output);
  } catch {
    throw new UsersOperationalError(
      "invalid-output",
      "WP-CLI returned malformed or unsafe user data.",
    );
  }

  const parsed = z
    .array(includeEmail ? rawUserWithEmailSchema : rawUserSchema)
    .safeParse(decoded);
  if (!parsed.success) {
    throw new UsersOperationalError(
      "invalid-output",
      "WP-CLI returned malformed or unsafe user data.",
    );
  }

  const users: ListedUser[] = parsed.data.map((raw) => ({
    id: raw.ID,
    username: raw.user_login,
    roles: parseRoles(raw.roles),
    registeredAt: raw.user_registered,
    ...(includeEmail &&
    "user_email" in raw &&
    typeof raw.user_email === "string"
      ? { email: raw.user_email }
      : {}),
  }));
  users.sort((left, right) => left.id - right.id);
  if (
    users.some((user, index) => index > 0 && user.id === users[index - 1].id)
  ) {
    throw new UsersOperationalError(
      "invalid-output",
      "WP-CLI returned malformed or unsafe user data.",
    );
  }
  return users;
}

export async function collectUsers(
  transport: WpCliTransport,
  siteInput: string,
  options: {
    includeEmail?: boolean;
    role?: string;
    collectedAt?: Date;
  } = {},
): Promise<UsersListReport> {
  const site = validateSiteName(siteInput);
  const includeEmail = !!options.includeEmail;
  const role = validateRole(options.role);
  let result: CommandResult;
  try {
    result = await transport.exec(usersListArgs(includeEmail, role), {
      skipPlugins: true,
      skipThemes: true,
    });
  } catch {
    throw new UsersOperationalError(
      "connection",
      "Unable to list users: WP-CLI connection or execution failed.",
    );
  }
  if (result.exitCode !== 0) {
    throw new UsersOperationalError(
      "connection",
      "Unable to list users: WP-CLI connection or execution failed.",
    );
  }
  const users = parseUsersList(result.stdout.trim(), includeEmail);
  return {
    schemaVersion: 1,
    site,
    collectedAt: (options.collectedAt ?? new Date()).toISOString(),
    users: role ? users.filter((user) => user.roles.includes(role)) : users,
  };
}

export function usersReportJson(report: UsersListReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatUsersHuman(report: UsersListReport): string {
  const includeEmail = report.users.some((user) => user.email !== undefined);
  const headings = ["ID", "Username", "Roles", "Registered"];
  if (includeEmail) headings.push("Email");
  const rows = report.users.map((user) => {
    const row = [
      String(user.id),
      user.username,
      user.roles.join(","),
      user.registeredAt,
    ];
    if (includeEmail) row.push(user.email ?? "");
    return row;
  });
  const widths = headings.map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => row[index].length)),
  );
  const formatRow = (row: string[]) =>
    row
      .map((value, index) => value.padEnd(widths[index]))
      .join("  ")
      .trimEnd();
  const table = [formatRow(headings), ...rows.map(formatRow)];
  if (rows.length === 0) table.push("No users found.");
  return `${table.join("\n")}\n`;
}

export async function writeUsersReport(
  path: string,
  report: UsersListReport,
): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, usersReportJson(report), { mode: 0o600 });
    await chmod(path, 0o600);
  } catch {
    throw new UsersOperationalError(
      "output-file",
      "Unable to write users output file.",
    );
  }
}
