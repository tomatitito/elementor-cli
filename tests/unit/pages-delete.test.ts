import { describe, test, expect, mock } from "bun:test";
import { deletePageAction } from "../../src/commands/pages.js";
import type { SiteConfig } from "../../src/types/config.js";
import type { WordPressClient } from "../../src/services/wordpress-client.js";

function makeSpinner() {
  return {
    succeed: mock(() => {}),
    warn: mock(() => {}),
    fail: mock(() => {}),
    stop: mock(() => {}),
  };
}

describe("pages delete", () => {
  const siteConfig: SiteConfig = {
    url: "https://example.com",
    username: "user",
    appPassword: "pass",
  };

  test("moves the page to trash when --force is not used", async () => {
    const deletePage = mock(async () => {});
    const confirmAction = mock(async () => true);
    const client = { deletePage } as unknown as WordPressClient;
    const createClient = mock(() => client);
    const getSiteConfig = mock(async () => ({
      name: "production",
      config: siteConfig,
    }));
    const info = mock(() => {});
    const spinner = makeSpinner();

    await deletePageAction(
      "42",
      { site: "production" },
      {
        getSiteConfig,
        confirmAction,
        createClient: createClient as unknown as (config: SiteConfig) => WordPressClient,
        spinner: () => spinner,
        info,
      }
    );

    expect(confirmAction).toHaveBeenCalledWith(
      "Move page 42 from production to trash?"
    );
    expect(deletePage).toHaveBeenCalledWith(42, false);
    expect(spinner.succeed).toHaveBeenCalledWith("Moved page 42 to trash");
  });

  test("permanently deletes the page when --force is used", async () => {
    const deletePage = mock(async () => {});
    const confirmAction = mock(async () => true);
    const client = { deletePage } as unknown as WordPressClient;
    const createClient = mock(() => client);
    const getSiteConfig = mock(async () => ({
      name: "production",
      config: siteConfig,
    }));
    const info = mock(() => {});
    const spinner = makeSpinner();

    await deletePageAction(
      "42",
      { site: "production", force: true },
      {
        getSiteConfig,
        confirmAction,
        createClient: createClient as unknown as (config: SiteConfig) => WordPressClient,
        spinner: () => spinner,
        info,
      }
    );

    expect(confirmAction).not.toHaveBeenCalled();
    expect(deletePage).toHaveBeenCalledWith(42, true);
    expect(spinner.succeed).toHaveBeenCalledWith(
      "Permanently deleted page 42"
    );
  });
});
