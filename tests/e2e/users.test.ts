import { beforeAll, describe, expect, test } from "bun:test";
import { collectUsers } from "../../src/services/users.js";
import { ComposeWpCliTransport } from "../../src/services/wp-cli-transport.js";
import { setupTestEnvironment } from "./setup.js";

describe("E2E: safe users list", () => {
  let transport: ComposeWpCliTransport;

  beforeAll(async () => {
    await setupTestEnvironment();
    transport = new ComposeWpCliTransport(
      {
        type: "compose",
        composeFile: "docker-compose.yml",
        projectName: "elementor-cli-test",
        service: "wordpress",
        mode: "exec",
        runtime: "docker",
      },
      import.meta.dir,
    );
  }, 180000);

  test("lists seeded users without sensitive fields", async () => {
    const report = await collectUsers(transport, "e2e");
    const editor = report.users.find(
      (user) => user.username === "recovery-editor",
    );
    const subscriber = report.users.find(
      (user) => user.username === "recovery-subscriber",
    );

    expect(editor?.roles).toContain("editor");
    expect(subscriber?.roles).toContain("subscriber");
    expect(report.users.map((user) => user.id)).toEqual(
      [...report.users.map((user) => user.id)].sort(
        (left, right) => left - right,
      ),
    );
    expect(JSON.stringify(report)).not.toMatch(
      /user_email|@example\.com|user_pass|password|activation|session|application/i,
    );
  });

  test("filters by role and includes email only after opt-in", async () => {
    const editors = await collectUsers(transport, "e2e", { role: "editor" });
    expect(editors.users.map((user) => user.username)).toContain(
      "recovery-editor",
    );
    expect(editors.users.every((user) => user.roles.includes("editor"))).toBe(
      true,
    );

    const withEmail = await collectUsers(transport, "e2e", {
      role: "subscriber",
      includeEmail: true,
    });
    expect(
      withEmail.users.find((user) => user.username === "recovery-subscriber")
        ?.email,
    ).toBe("recovery-subscriber@example.com");
  });
});
