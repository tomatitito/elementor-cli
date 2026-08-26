import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, SiteConfigSchema } from "../../src/types/config.js";
import { readConfig } from "../../src/utils/config-store.js";

describe("WP-CLI configuration", () => {
  test("keeps existing REST-only configuration backward compatible", () => {
    const config = ConfigSchema.parse({
      defaultSite: "production",
      sites: {
        production: {
          url: "https://example.com",
          username: "editor",
          appPassword: "application password",
        },
      },
    });

    expect(config.sites.production.wpCli).toBeUndefined();
    expect(config.sites.production.username).toBe("editor");
  });

  test("parses SSH and Compose forms, including a WP-CLI-only site", () => {
    const config = ConfigSchema.parse({
      sites: {
        production: {
          url: "https://example.com",
          username: "editor",
          appPassword: "application password",
          wpCli: {
            type: "ssh",
            host: "deploy@example.com",
            path: "/var/www/example/current",
          },
        },
        recovery: {
          url: "http://localhost:8082",
          wpCli: {
            type: "compose",
            composeFile: "docker/docker-compose.recovery.yml",
            envFile: "recovery/.env",
            projectName: "example-recovery",
            service: "wpcli",
            mode: "run",
            runtime: "podman",
          },
        },
      },
    });

    expect(config.sites.production.wpCli?.type).toBe("ssh");
    expect(config.sites.recovery.wpCli).toEqual({
      type: "compose",
      composeFile: "docker/docker-compose.recovery.yml",
      envFile: "recovery/.env",
      projectName: "example-recovery",
      service: "wpcli",
      mode: "run",
      runtime: "podman",
    });
  });

  test("loads the proposed forms from a YAML configuration file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "elementor-cli-config-"));
    const configPath = join(directory, "config.yaml");
    const previousPath = process.env.ELEMENTOR_CLI_CONFIG;
    try {
      await Bun.write(
        configPath,
        `sites:
  recovery:
    url: http://localhost:8082
    wpCli:
      type: compose
      composeFile: docker/recovery.yml
      service: wpcli
      mode: run
`,
      );
      process.env.ELEMENTOR_CLI_CONFIG = configPath;

      const config = await readConfig();
      expect(config.sites.recovery.wpCli).toEqual({
        type: "compose",
        composeFile: "docker/recovery.yml",
        service: "wpcli",
        mode: "run",
        runtime: "docker",
      });
    } finally {
      if (previousPath === undefined) {
        Reflect.deleteProperty(process.env, "ELEMENTOR_CLI_CONFIG");
      } else {
        process.env.ELEMENTOR_CLI_CONFIG = previousPath;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("defaults Compose runtime to Docker", () => {
    const site = SiteConfigSchema.parse({
      url: "http://localhost:8080",
      wpCli: {
        type: "compose",
        composeFile: "compose.yml",
        service: "wordpress",
        mode: "exec",
      },
    });

    expect(site.wpCli?.type === "compose" && site.wpCli.runtime).toBe("docker");
  });

  test("requires complete REST credentials when either credential is present", () => {
    expect(() =>
      SiteConfigSchema.parse({
        url: "https://example.com",
        username: "editor",
        wpCli: {
          type: "ssh",
          host: "example.com",
          path: "/srv/wordpress",
        },
      }),
    ).toThrow("username and appPassword must be configured together");
  });

  test.each([
    [
      "SSH shell characters",
      { type: "ssh", host: "host;whoami", path: "/srv/wp" },
    ],
    ["relative SSH path", { type: "ssh", host: "example.com", path: "srv/wp" }],
    [
      "invalid Compose service",
      {
        type: "compose",
        composeFile: "compose.yml",
        service: "wordpress;whoami",
        mode: "exec",
      },
    ],
    [
      "invalid Compose project",
      {
        type: "compose",
        composeFile: "compose.yml",
        projectName: "Example Project",
        service: "wordpress",
        mode: "exec",
      },
    ],
  ])("rejects %s", (_name, wpCli) => {
    expect(() =>
      SiteConfigSchema.parse({ url: "https://example.com", wpCli }),
    ).toThrow();
  });
});
