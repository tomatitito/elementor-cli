import { describe, test, expect, mock, beforeEach } from "bun:test";
import { WordPressClient } from "./wordpress-client.js";

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
      globalThis.fetch = fetchMock as typeof fetch;
    });

    test("uses status[] array parameters when status is 'all'", async () => {
      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.listPages({ status: "all" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = fetchMock.mock.calls[0][0] as string;

      // Should use status[] parameters, not comma-separated
      expect(calledUrl).toContain("status%5B%5D=publish"); // status[]=publish (URL encoded)
      expect(calledUrl).toContain("status%5B%5D=draft");
      expect(calledUrl).toContain("status%5B%5D=private");
      expect(calledUrl).toContain("status%5B%5D=pending");

      // Should NOT contain comma-separated status
      expect(calledUrl).not.toContain("status=publish,draft");

      globalThis.fetch = originalFetch;
    });

    test("uses status[] array parameters when no status provided", async () => {
      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.listPages();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = fetchMock.mock.calls[0][0] as string;

      // Should use status[] parameters for default "all" behavior
      expect(calledUrl).toContain("status%5B%5D=publish");
      expect(calledUrl).toContain("status%5B%5D=draft");

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

      // Should NOT contain status[] array
      expect(calledUrl).not.toContain("status%5B%5D");

      globalThis.fetch = originalFetch;
    });
  });
});
