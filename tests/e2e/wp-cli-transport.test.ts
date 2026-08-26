import { beforeAll, describe, expect, test } from "bun:test";
import { ComposeWpCliTransport } from "../../src/services/wp-cli-transport.js";
import { setupTestEnvironment } from "./setup.js";

describe("E2E: Compose WP-CLI transport", () => {
  beforeAll(async () => {
    await setupTestEnvironment();
  }, 180000);

  test("runs a harmless WP-CLI command in the existing WordPress service", async () => {
    const transport = new ComposeWpCliTransport(
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

    const result = await transport.exec(["core", "version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+/);
    expect(result.stderr).toBe("");
  });
});
