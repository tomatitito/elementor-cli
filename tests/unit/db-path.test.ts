import { describe, test, expect } from "bun:test";
import { resolveDumpPaths } from "../../src/commands/db.js";

describe("resolveDumpPaths", () => {
  test("preserves absolute output paths", () => {
    const result = resolveDumpPaths({
      output: "/tmp/backup.sql",
      siteName: "production",
      cwd: "/workspace/project",
    });

    expect(result.displayPath).toBe("/tmp/backup.sql");
    expect(result.writePath).toBe("/tmp/backup.sql");
  });

  test("resolves relative output paths against cwd", () => {
    const result = resolveDumpPaths({
      output: "backups/backup.sql",
      siteName: "production",
      cwd: "/workspace/project",
    });

    expect(result.displayPath).toBe("backups/backup.sql");
    expect(result.writePath).toBe("/workspace/project/backups/backup.sql");
  });

  test("uses the default dumps directory when no output is provided", () => {
    const result = resolveDumpPaths({
      siteName: "production",
      cwd: "/workspace/project",
      now: new Date("2026-04-09T19:22:00.000Z"),
    });

    expect(result.displayPath).toBe(
      ".elementor-cli/dumps/production-2026-04-09T19-22-00.sql"
    );
    expect(result.writePath).toBe(
      "/workspace/project/.elementor-cli/dumps/production-2026-04-09T19-22-00.sql"
    );
  });
});
