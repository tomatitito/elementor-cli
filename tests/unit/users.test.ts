import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UsersOperationalError,
  collectUsers,
  formatUsersHuman,
  parseUsersList,
  usersListArgs,
  usersReportJson,
  validateRole,
  writeUsersReport,
} from "../../src/services/users.js";
import type {
  CommandResult,
  WpCliExecOptions,
  WpCliTransport,
} from "../../src/services/wp-cli-transport.js";

const rawUsers = [
  {
    ID: "20",
    user_login: "editor",
    roles: "editor,author",
    user_registered: "2024-01-20 10:20:30",
  },
  {
    ID: 3,
    user_login: "admin",
    roles: "administrator",
    user_registered: "2021-02-05 01:02:03",
  },
];

class FakeTransport implements WpCliTransport {
  calls: Array<{ args: string[]; options?: WpCliExecOptions }> = [];

  constructor(
    private readonly result: CommandResult = {
      stdout: JSON.stringify(rawUsers),
      stderr: "",
      exitCode: 0,
    },
  ) {}

  async exec(
    args: string[],
    options?: WpCliExecOptions,
  ): Promise<CommandResult> {
    this.calls.push({ args, options });
    return this.result;
  }
}

describe("safe users WP-CLI request", () => {
  test("uses only the fixed default allowlist and deterministic JSON options", () => {
    const args = usersListArgs(false, "administrator");
    expect(args).toEqual([
      "user",
      "list",
      "--fields=ID,user_login,roles,user_registered",
      "--format=json",
      "--orderby=ID",
      "--order=ASC",
      "--role=administrator",
    ]);
    expect(JSON.stringify(args)).not.toMatch(
      /pass|activation|session|application|token|meta|email/i,
    );
  });

  test("adds email to the allowlist only by explicit opt-in", () => {
    const args = usersListArgs(true);
    expect(args).toContain(
      "--fields=ID,user_login,roles,user_registered,user_email",
    );
    expect(args.filter((arg) => arg.startsWith("--fields="))).toHaveLength(1);
  });

  test("rejects role option injection and accepts WordPress role slugs", () => {
    expect(validateRole("content_manager-2")).toBe("content_manager-2");
    for (const role of [
      "Administrator",
      "admin,editor",
      "--format=csv",
      "a\nb",
    ]) {
      expect(() => validateRole(role)).toThrow(UsersOperationalError);
    }
  });
});

describe("users parser and schema", () => {
  test("normalizes numeric IDs and roles, then sorts deterministically by ID", () => {
    expect(parseUsersList(JSON.stringify(rawUsers), false)).toEqual([
      {
        id: 3,
        username: "admin",
        roles: ["administrator"],
        registeredAt: "2021-02-05 01:02:03",
      },
      {
        id: 20,
        username: "editor",
        roles: ["author", "editor"],
        registeredAt: "2024-01-20 10:20:30",
      },
    ]);
  });

  test("includes email only under the opt-in schema", () => {
    const row = { ...rawUsers[0], user_email: "editor@example.com" };
    expect(parseUsersList(JSON.stringify([row]), true)[0].email).toBe(
      "editor@example.com",
    );
    expect(() => parseUsersList(JSON.stringify([row]), false)).toThrow(
      "malformed or unsafe",
    );
  });

  test("fails closed on credential, session, application password, or metadata fields", () => {
    for (const field of [
      "user_pass",
      "user_activation_key",
      "session_tokens",
      "application_passwords",
      "arbitrary_meta",
    ]) {
      expect(() =>
        parseUsersList(
          JSON.stringify([{ ...rawUsers[0], [field]: "do-not-emit" }]),
          false,
        ),
      ).toThrow("malformed or unsafe");
    }
  });

  test("rejects malformed JSON, wrong roots, duplicate IDs, and invalid fields", () => {
    const badValues: unknown[] = [
      "not json",
      {},
      [{ ...rawUsers[0], ID: "0" }],
      [{ ...rawUsers[0], ID: "1.5" }],
      [{ ...rawUsers[0], roles: "editor,not a role" }],
      [{ ...rawUsers[0], user_registered: "yesterday" }],
      [{ ...rawUsers[0], user_login: "admin\u001b[2J" }],
      [{ ...rawUsers[0], user_login: "admin\u202ereversed" }],
      [rawUsers[0], { ...rawUsers[0] }],
    ];
    for (const value of badValues) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      expect(() => parseUsersList(text, false)).toThrow("malformed or unsafe");
    }
  });

  test("accepts a genuinely empty result", () => {
    expect(parseUsersList("[]", false)).toEqual([]);
  });
});

describe("collection, filtering, output, and operational errors", () => {
  test("filters defensively, requests transport skip flags, and timestamps output", async () => {
    const transport = new FakeTransport();
    const report = await collectUsers(transport, "production", {
      role: "administrator",
      collectedAt: new Date("2026-08-27T12:00:00.000Z"),
    });
    expect(report).toEqual({
      schemaVersion: 1,
      site: "production",
      collectedAt: "2026-08-27T12:00:00.000Z",
      users: [
        {
          id: 3,
          username: "admin",
          roles: ["administrator"],
          registeredAt: "2021-02-05 01:02:03",
        },
      ],
    });
    expect(transport.calls[0].options).toEqual({
      skipPlugins: true,
      skipThemes: true,
    });
    expect(transport.calls[0].args).toContain("--role=administrator");
  });

  test("stable JSON and human output do not acquire email fields", async () => {
    const report = await collectUsers(new FakeTransport(), "production", {
      collectedAt: new Date("2026-08-27T12:00:00.000Z"),
    });
    const json = usersReportJson(report);
    expect(json).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(json).not.toContain("email");
    const human = formatUsersHuman(report);
    expect(human).toContain("ID  Username");
    expect(human).not.toContain("Email");
  });

  test("makes empty output visibly different from a failed operation", async () => {
    const empty = await collectUsers(
      new FakeTransport({ stdout: "[]", stderr: "", exitCode: 0 }),
      "production",
    );
    expect(formatUsersHuman(empty)).toContain("No users found.");

    const failed = collectUsers(
      new FakeTransport({
        stdout: "password=upstream-secret",
        stderr: "token=upstream-secret",
        exitCode: 1,
      }),
      "production",
    );
    await expect(failed).rejects.toMatchObject({ kind: "connection" });
    await expect(failed).rejects.not.toThrow(/upstream-secret|password|token/);
  });

  test("replaces secret-bearing transport exceptions with a generic error", async () => {
    const transport: WpCliTransport = {
      exec: async () => {
        throw new Error("Bearer abc123 user_pass=hunter2");
      },
    };
    let error: unknown;
    try {
      await collectUsers(transport, "production");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UsersOperationalError);
    expect(String(error)).not.toMatch(/abc123|hunter2|pass|bearer/i);
  });

  test("writes stable JSON with private permissions, including email only when present", async () => {
    const directory = await mkdtemp(join(tmpdir(), "elementor-users-"));
    const path = join(directory, "nested", "users.json");
    try {
      const report = await collectUsers(
        new FakeTransport({
          stdout: JSON.stringify([
            { ...rawUsers[0], user_email: "editor@example.com" },
          ]),
          stderr: "",
          exitCode: 0,
        }),
        "production",
        {
          includeEmail: true,
          collectedAt: new Date("2026-08-27T12:00:00.000Z"),
        },
      );
      await writeUsersReport(path, report);
      expect(await readFile(path, "utf8")).toBe(usersReportJson(report));
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await readFile(path, "utf8")).toContain("editor@example.com");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
