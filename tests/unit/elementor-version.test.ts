import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { ElementorParser } from "../../src/services/elementor-parser.js";
import { WordPressClient } from "../../src/services/wordpress-client.js";
import type { WPPage } from "../../src/types/wordpress.js";

function makeWPPage(overrides: Partial<WPPage> = {}): WPPage {
  return {
    id: 42,
    date: "2024-01-01T00:00:00",
    date_gmt: "2024-01-01T00:00:00",
    modified: "2024-01-01T00:00:00",
    modified_gmt: "2024-01-01T00:00:00",
    slug: "test-page",
    status: "publish",
    title: { rendered: "Test Page" },
    content: { rendered: "", protected: false },
    author: 1,
    parent: 0,
    menu_order: 0,
    meta: {
      _elementor_edit_mode: "builder",
      _elementor_data: "[]",
      _elementor_page_settings: "{}",
      _elementor_version: "3.35.5",
    },
    link: "https://example.com/test-page",
    ...overrides,
  };
}

describe("_elementor_version support", () => {
  describe("ElementorParser.parseWPPage", () => {
    test("captures _elementor_version from WP meta into PageData", () => {
      const parser = new ElementorParser();
      const wpPage = makeWPPage();

      const pageData = parser.parseWPPage(wpPage);

      expect(pageData.elementor_version).toBe("3.35.5");
    });

    test("handles missing _elementor_version gracefully", () => {
      const parser = new ElementorParser();
      const wpPage = makeWPPage({
        meta: {
          _elementor_edit_mode: "builder",
          _elementor_data: "[]",
          _elementor_page_settings: "{}",
          // no _elementor_version
        },
      });

      const pageData = parser.parseWPPage(wpPage);

      expect(pageData.elementor_version).toBeUndefined();
    });

    test("preserves different version strings", () => {
      const parser = new ElementorParser();
      const wpPage = makeWPPage({
        meta: {
          _elementor_edit_mode: "builder",
          _elementor_data: "[]",
          _elementor_page_settings: "{}",
          _elementor_version: "3.20.0",
        },
      });

      const pageData = parser.parseWPPage(wpPage);

      expect(pageData.elementor_version).toBe("3.20.0");
    });
  });

  describe("WordPressClient.updatePage", () => {
    let fetchMock: ReturnType<typeof mock>;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 42 }),
        })
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("sends _elementor_version in meta when provided", async () => {
      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.updatePage(42, {
        elementorData: "[]",
        elementorVersion: "3.35.5",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);

      expect(body.meta._elementor_version).toBe("3.35.5");
    });

    test("does not send _elementor_version when not provided", async () => {
      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.updatePage(42, {
        elementorData: "[]",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);

      expect(body.meta._elementor_version).toBeUndefined();
    });

    test("sends _elementor_version alongside other meta fields", async () => {
      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.updatePage(42, {
        elementorData: '[{"id":"abc","elType":"container","settings":{},"elements":[]}]',
        pageSettings: { some_setting: "value" },
        elementorVersion: "3.35.5",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);

      expect(body.meta._elementor_data).toBeDefined();
      expect(body.meta._elementor_page_settings).toBeDefined();
      expect(body.meta._elementor_version).toBe("3.35.5");
    });
  });

  describe("round-trip: pull captures version, push sends it back", () => {
    let fetchMock: ReturnType<typeof mock>;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("version round-trips through parseWPPage and updatePage", async () => {
      const parser = new ElementorParser();

      // Step 1: Pull - parse WP page to get PageData with version
      const wpPage = makeWPPage({
        meta: {
          _elementor_edit_mode: "builder",
          _elementor_data: '[{"id":"abc","elType":"container","settings":{},"elements":[]}]',
          _elementor_page_settings: '{"some":"setting"}',
          _elementor_version: "3.35.5",
        },
      });
      const pageData = parser.parseWPPage(wpPage);
      expect(pageData.elementor_version).toBe("3.35.5");

      // Step 2: Push - send the version back via updatePage
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 42 }),
        })
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.updatePage(pageData.id, {
        elementorData: parser.serializeElements(pageData.elementor_data),
        pageSettings: pageData.page_settings,
        elementorVersion: pageData.elementor_version,
      });

      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);

      expect(body.meta._elementor_version).toBe("3.35.5");
    });

    test("missing version round-trips without error", async () => {
      const parser = new ElementorParser();

      // Pull page without version
      const wpPage = makeWPPage({
        meta: {
          _elementor_edit_mode: "builder",
          _elementor_data: "[]",
          _elementor_page_settings: "{}",
        },
      });
      const pageData = parser.parseWPPage(wpPage);
      expect(pageData.elementor_version).toBeUndefined();

      // Push without version - should not error
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 42 }),
        })
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = new WordPressClient({
        url: "https://example.com",
        username: "user",
        appPassword: "pass",
      });

      await client.updatePage(pageData.id, {
        elementorData: parser.serializeElements(pageData.elementor_data),
        elementorVersion: pageData.elementor_version,
      });

      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);

      // Should not include _elementor_version in meta when undefined
      expect(body.meta._elementor_version).toBeUndefined();
    });
  });
});
