import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { WordPressClient } from "../../src/services/wordpress-client.js";
import { RevisionManager } from "../../src/services/revision-manager.js";
import type { WPPage, WPRevision } from "../../src/types/wordpress.js";

// Helper to create a mock WPPage
function mockPage(overrides: Partial<WPPage> = {}): WPPage {
  return {
    id: 42,
    date: "2024-01-01T00:00:00",
    date_gmt: "2024-01-01T00:00:00",
    modified: "2024-01-01T00:00:00",
    modified_gmt: "2024-01-01T00:00:00",
    slug: "test-page",
    status: "publish",
    title: { rendered: "Test Page", raw: "Test Page" },
    content: { rendered: "", protected: false },
    author: 1,
    parent: 0,
    menu_order: 0,
    meta: {},
    link: "https://example.com/test-page",
    ...overrides,
  };
}

// Helper to create a mock WPRevision
function mockRevision(overrides: Partial<WPRevision> = {}): WPRevision {
  return {
    id: 100,
    parent: 42,
    date: "2024-01-01T00:00:00",
    author: 1,
    modified: "2024-01-01T00:00:00",
    title: { rendered: "Test Page" },
    content: { rendered: "" },
    meta: {},
    ...overrides,
  };
}

describe("RevisionManager.createBackup", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns { created: true, revisionId } when a new revision is created", async () => {
    const existingRevisions = [mockRevision({ id: 100 }), mockRevision({ id: 99 })];
    const afterRevisions = [mockRevision({ id: 101 }), mockRevision({ id: 100 }), mockRevision({ id: 99 })];
    const page = mockPage({ id: 42 });

    let getRevisionsCallCount = 0;

    globalThis.fetch = mock((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      // GET revisions
      if (urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        getRevisionsCallCount++;
        const data = getRevisionsCallCount === 1 ? existingRevisions : afterRevisions;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(data),
        });
      }

      // GET page
      if (urlStr.includes("/pages/42") && !urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      // PUT page (update)
      if (urlStr.includes("/pages/42") && options?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ code: "not_found", message: "Not found" }),
      });
    }) as unknown as typeof fetch;

    const client = new WordPressClient({
      url: "https://example.com",
      username: "user",
      appPassword: "pass",
    });
    const manager = new RevisionManager(client);

    const result = await manager.createBackup(42);

    expect(result).toEqual({ created: true, revisionId: 101 });
  });

  test("returns { created: false } when no new revision is created (content unchanged)", async () => {
    const existingRevisions = [mockRevision({ id: 100 }), mockRevision({ id: 99 })];
    const page = mockPage({ id: 42 });

    let getRevisionsCallCount = 0;

    globalThis.fetch = mock((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      // GET revisions — same list before and after
      if (urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        getRevisionsCallCount++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(existingRevisions),
        });
      }

      // GET page
      if (urlStr.includes("/pages/42") && !urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      // PUT page (update)
      if (urlStr.includes("/pages/42") && options?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ code: "not_found", message: "Not found" }),
      });
    }) as unknown as typeof fetch;

    const client = new WordPressClient({
      url: "https://example.com",
      username: "user",
      appPassword: "pass",
    });
    const manager = new RevisionManager(client);

    const result = await manager.createBackup(42);

    expect(result).toEqual({ created: false });
  });

  test("returns { created: true } when page has no existing revisions and one is created", async () => {
    const noRevisions: WPRevision[] = [];
    const afterRevisions = [mockRevision({ id: 50 })];
    const page = mockPage({ id: 42 });

    let getRevisionsCallCount = 0;

    globalThis.fetch = mock((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      // GET revisions
      if (urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        getRevisionsCallCount++;
        const data = getRevisionsCallCount === 1 ? noRevisions : afterRevisions;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(data),
        });
      }

      // GET page
      if (urlStr.includes("/pages/42") && !urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      // PUT page (update)
      if (urlStr.includes("/pages/42") && options?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ code: "not_found", message: "Not found" }),
      });
    }) as unknown as typeof fetch;

    const client = new WordPressClient({
      url: "https://example.com",
      username: "user",
      appPassword: "pass",
    });
    const manager = new RevisionManager(client);

    const result = await manager.createBackup(42);

    expect(result).toEqual({ created: true, revisionId: 50 });
  });

  test("returns { created: false } when page has no revisions before or after", async () => {
    const noRevisions: WPRevision[] = [];
    const page = mockPage({ id: 42 });

    globalThis.fetch = mock((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      // GET revisions — empty both times
      if (urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(noRevisions),
        });
      }

      // GET page
      if (urlStr.includes("/pages/42") && !urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      // PUT page (update)
      if (urlStr.includes("/pages/42") && options?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ code: "not_found", message: "Not found" }),
      });
    }) as unknown as typeof fetch;

    const client = new WordPressClient({
      url: "https://example.com",
      username: "user",
      appPassword: "pass",
    });
    const manager = new RevisionManager(client);

    const result = await manager.createBackup(42);

    expect(result).toEqual({ created: false });
  });

  test("calls getRevisions before and after the update", async () => {
    const revisions = [mockRevision({ id: 100 })];
    const page = mockPage({ id: 42 });

    const callOrder: string[] = [];

    globalThis.fetch = mock((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        callOrder.push("getRevisions");
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(revisions),
        });
      }

      if (urlStr.includes("/pages/42") && !urlStr.includes("/revisions") && (!options || options.method === undefined || options.method === "GET")) {
        callOrder.push("getPage");
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      if (urlStr.includes("/pages/42") && options?.method === "PUT") {
        callOrder.push("updatePage");
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(page),
        });
      }

      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ code: "not_found", message: "Not found" }),
      });
    }) as unknown as typeof fetch;

    const client = new WordPressClient({
      url: "https://example.com",
      username: "user",
      appPassword: "pass",
    });
    const manager = new RevisionManager(client);

    await manager.createBackup(42);

    // Should call getRevisions before the update AND after
    expect(callOrder).toEqual([
      "getRevisions",
      "getPage",
      "updatePage",
      "getRevisions",
    ]);
  });

  test("propagates API errors from getRevisions", async () => {
    globalThis.fetch = mock(() => {
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ code: "rest_forbidden", message: "Sorry, you are not allowed to do that." }),
      });
    }) as unknown as typeof fetch;

    const client = new WordPressClient({
      url: "https://example.com",
      username: "user",
      appPassword: "pass",
    });
    const manager = new RevisionManager(client);

    expect(manager.createBackup(42)).rejects.toThrow("Sorry, you are not allowed to do that.");
  });
});
