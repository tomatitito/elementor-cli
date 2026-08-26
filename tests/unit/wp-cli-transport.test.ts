import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ComposeWpCliTransport,
  type ProcessCommand,
  SshWpCliTransport,
  type WpCliStdin,
  WpCliTransportError,
  buildComposeWpCliCommand,
  buildSshWpCliCommand,
  redactWpCliSecrets,
  resolveProjectFile,
  runWpCliProcess,
} from "../../src/services/wp-cli-transport.js";

describe("SSH WP-CLI transport", () => {
  test("builds a verified-host SSH command and quotes every remote argument", () => {
    const command = buildSshWpCliCommand(
      {
        type: "ssh",
        host: "deploy@example.com",
        path: "/var/www/example site/current",
      },
      ["option", "update", "title", "Friend's site"],
    );

    expect(command.executable).toBe("ssh");
    expect(command.args.slice(0, 3)).toEqual([
      "-o",
      "StrictHostKeyChecking=yes",
      "deploy@example.com",
    ]);
    expect(command.args[3]).toBe(
      "'wp' '--path=/var/www/example site/current' '--skip-plugins' '--skip-themes' 'option' 'update' 'title' 'Friend'\"'\"'s site'",
    );
    expect(command.args).not.toContain("StrictHostKeyChecking=no");
  });

  test("lets callers load plugins/themes or supply selective skip flags", () => {
    const command = buildSshWpCliCommand(
      { type: "ssh", host: "example.com", path: "/srv/wp" },
      ["--skip-plugins=akismet", "elementor", "flush-css"],
      { skipThemes: false },
    );

    expect(command.args.at(-1)).not.toContain("'--skip-plugins'");
    expect(command.args.at(-1)).not.toContain("'--skip-themes'");
    expect(command.args.at(-1)).toContain("'--skip-plugins=akismet'");
  });
});

describe("Compose WP-CLI transport", () => {
  test("constructs Docker Compose run with all optional files and names", () => {
    const root = "/workspace/project";
    const command = buildComposeWpCliCommand(
      {
        type: "compose",
        composeFile: "docker/recovery.yml",
        envFile: "recovery/.env",
        projectName: "example-recovery",
        service: "wpcli",
        mode: "run",
        runtime: "docker",
      },
      root,
      ["core", "version"],
    );

    expect(command).toEqual({
      executable: "docker",
      cwd: root,
      args: [
        "compose",
        "-f",
        "/workspace/project/docker/recovery.yml",
        "--env-file",
        "/workspace/project/recovery/.env",
        "--project-name",
        "example-recovery",
        "run",
        "-T",
        "--rm",
        "wpcli",
        "wp",
        "--skip-plugins",
        "--skip-themes",
        "core",
        "version",
      ],
    });
  });

  test("constructs Podman Compose exec without run-only flags", () => {
    const command = buildComposeWpCliCommand(
      {
        type: "compose",
        composeFile: "compose.yml",
        service: "wordpress",
        mode: "exec",
        runtime: "podman",
      },
      "/project",
      ["db", "export", "-"],
    );

    expect(command.executable).toBe("podman");
    expect(command.args).toContain("exec");
    expect(command.args).not.toContain("--rm");
  });

  test("rejects traversal and files missing at execution time", async () => {
    expect(() => resolveProjectFile("/project", "../secret.env")).toThrow(
      "inside the project root",
    );

    const root = await mkdtemp(join(tmpdir(), "elementor-cli-transport-"));
    try {
      const transport = new ComposeWpCliTransport(
        {
          type: "compose",
          composeFile: "missing.yml",
          service: "wordpress",
          mode: "exec",
          runtime: "docker",
        },
        root,
      );
      await expect(transport.exec(["core", "version"])).rejects.toThrow(
        "missing, unreadable, or outside",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a Compose file symlink that escapes the project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "elementor-cli-transport-"));
    const outside = join(tmpdir(), `outside-compose-${Date.now()}.yml`);
    try {
      await writeFile(outside, "services: {}\n");
      await symlink(outside, join(root, "compose.yml"));
      const transport = new ComposeWpCliTransport(
        {
          type: "compose",
          composeFile: "compose.yml",
          service: "wordpress",
          mode: "exec",
          runtime: "docker",
        },
        root,
      );

      await expect(transport.exec(["core", "version"])).rejects.toThrow(
        "outside the project root",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });

  test("passes stdin to the runner and preserves its complete result", async () => {
    const root = await mkdtemp(join(tmpdir(), "elementor-cli-transport-"));
    const composeFile = join(root, "compose.yml");
    await writeFile(composeFile, "services: {}\n");
    let receivedCommand: ProcessCommand | undefined;
    let receivedStdin: WpCliStdin | undefined;
    try {
      const transport = new ComposeWpCliTransport(
        {
          type: "compose",
          composeFile: "compose.yml",
          service: "wpcli",
          mode: "run",
          runtime: "docker",
        },
        root,
        async (command, stdin) => {
          receivedCommand = command;
          receivedStdin = stdin;
          return { stdout: "output\n", stderr: "warning\n", exitCode: 7 };
        },
      );

      const result = await transport.exec(["db", "import", "-"], {
        stdin: "SELECT 1;",
      });
      expect(receivedCommand?.args).toContain("import");
      expect(receivedStdin).toBe("SELECT 1;");
      expect(result).toEqual({
        stdout: "output\n",
        stderr: "warning\n",
        exitCode: 7,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("WP-CLI process results and safe errors", () => {
  test("streams stdin and preserves stdout, stderr, and a nonzero exit code", async () => {
    const result = await runWpCliProcess(
      {
        executable: process.execPath,
        args: [
          "-e",
          "process.stdin.on('data', d => process.stdout.write(d)); console.error('warning'); process.stdin.on('end', () => process.exit(4));",
        ],
      },
      "database input",
    );

    expect(result).toEqual({
      stdout: "database input",
      stderr: "warning\n",
      exitCode: 4,
    });
  });

  test("redacts credentials in text, sensitive options, and startup errors", async () => {
    const args = ["user", "create", "admin", "--user_pass=top-secret"];
    expect(
      redactWpCliSecrets(
        "password=hunter2 Authorization: Bearer abc --user_pass=top-secret",
        args,
      ),
    ).toBe(
      "password=[REDACTED] Authorization: Bearer [REDACTED] --user_pass=[REDACTED]",
    );

    const transport = new SshWpCliTransport(
      { type: "ssh", host: "example.com", path: "/srv/wp" },
      async () => {
        throw new Error("could not start with top-secret");
      },
    );
    let thrown: unknown;
    try {
      await transport.exec(args);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WpCliTransportError);
    expect(String(thrown)).not.toContain("top-secret");
    expect(String(thrown)).toContain("[REDACTED]");
  });
});
