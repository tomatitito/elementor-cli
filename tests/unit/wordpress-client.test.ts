import { describe, test, expect, mock, beforeEach } from "bun:test";
import { WordPressClient } from "../../src/services/wordpress-client.js";

describe("WordPressClient", () => {
  describe("listPages", () => {
    let fetchMock: ReturnType<typeof mock>;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        })
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    test("uses status=any when status is 'all'", async () => {
      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.listPages({ status: "all" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = fetchMock.mock.calls[0][0] as string;

      // Should use status=any for all statuses (WordPress REST API convention)
      expect(calledUrl).toContain("status=any");

      // Should NOT contain comma-separated status
      expect(calledUrl).not.toContain("status=publish,draft");

      globalThis.fetch = originalFetch;
    });

    test("does not send status parameter when no status provided", async () => {
      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.listPages();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = fetchMock.mock.calls[0][0] as string;

      // Should not include status parameter, returning only published by default
      expect(calledUrl).not.toContain("status=");

      globalThis.fetch = originalFetch;
    });

    test("uses single status parameter when specific status provided", async () => {
      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.listPages({ status: "draft" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = fetchMock.mock.calls[0][0] as string;

      // Should use single status parameter
      expect(calledUrl).toContain("status=draft");

      // Should NOT contain status=any
      expect(calledUrl).not.toContain("status=any");

      globalThis.fetch = originalFetch;
    });
  });
});
