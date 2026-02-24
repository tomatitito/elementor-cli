import { describe, test, expect } from "bun:test";
import type { PageData, ElementorElement, PageSettings, PageStatus } from "../../src/types/elementor.js";
import type { LocalPageData } from "../../src/services/local-store.js";

// Import the function under test — does not exist yet (RED phase)
import { buildPostPushPageData } from "../../src/commands/push.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLocalData(overrides: Partial<{
  pageId: number;
  title: string;
  slug: string;
  status: PageStatus;
  template: string | undefined;
  elements: ElementorElement[];
  settings: PageSettings;
  remoteModified: string;
}> = {}): LocalPageData {
  const pageId = overrides.pageId ?? 42;
  const title = overrides.title ?? "Local Title";
  const slug = overrides.slug ?? "local-title";
  const status = overrides.status ?? "publish";
  const template = "template" in overrides ? overrides.template : "elementor_canvas";
  const elements = overrides.elements ?? [
    {
      id: "abc123",
      elType: "container" as const,
      settings: { content_width: "full" },
      elements: [
        {
          id: "def456",
          elType: "widget" as const,
          widgetType: "heading",
          settings: { title: "Hello Local" },
          elements: [],
        },
      ],
    },
  ];
  const settings = overrides.settings ?? { background_color: "#fff" };
  const remoteModified = overrides.remoteModified ?? "2024-01-01T00:00:00";

  return {
    page: {
      id: pageId,
      title,
      slug,
      status,
      template,
      elementor_data: elements,
      page_settings: settings,
      remote_modified: remoteModified,
    },
    elements,
    settings,
    meta: { title, slug, status, template },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPostPushPageData", () => {
  describe("preserves local data after push", () => {
    test("elements on disk match LOCAL elements, not remote response", () => {
      const localElements: ElementorElement[] = [
        {
          id: "abc123",
          elType: "container",
          settings: { content_width: "full" },
          elements: [
            {
              id: "def456",
              elType: "widget",
              widgetType: "heading",
              settings: { title: "Hello Local" },
              elements: [],
            },
          ],
        },
      ];

      const localData = makeLocalData({ elements: localElements });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.elementor_data).toEqual(localElements);
    });

    test("settings on disk match LOCAL settings, not remote response", () => {
      const localSettings: PageSettings = {
        background_color: "#fff",
        hide_title: "yes",
      };
      const localData = makeLocalData({ settings: localSettings });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.page_settings).toEqual(localSettings);
    });

    test("title matches local meta", () => {
      const localData = makeLocalData({ title: "My Custom Title" });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.title).toBe("My Custom Title");
    });

    test("slug matches local meta", () => {
      const localData = makeLocalData({ slug: "my-custom-slug" });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.slug).toBe("my-custom-slug");
    });

    test("status matches local meta", () => {
      const localData = makeLocalData({ status: "draft" });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.status).toBe("draft");
    });

    test("template matches local meta", () => {
      const localData = makeLocalData({ template: "elementor_header_footer" });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.template).toBe("elementor_header_footer");
    });

    test("page id is preserved", () => {
      const localData = makeLocalData({ pageId: 99 });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.id).toBe(99);
    });
  });

  describe("remote_modified comes from remote response", () => {
    test("remote_modified is updated to the value from the remote", () => {
      const localData = makeLocalData({ remoteModified: "2024-01-01T00:00:00" });
      const newRemoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, newRemoteModified);

      expect(result.remote_modified).toBe("2024-06-15T12:00:00");
    });

    test("remote_modified is NOT the old local value", () => {
      const oldModified = "2024-01-01T00:00:00";
      const newModified = "2024-06-15T12:00:00";
      const localData = makeLocalData({ remoteModified: oldModified });

      const result = buildPostPushPageData(localData, newModified);

      expect(result.remote_modified).not.toBe(oldModified);
    });
  });

  describe("edge cases", () => {
    test("handles undefined template", () => {
      const localData = makeLocalData({ template: undefined });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.template).toBeUndefined();
    });

    test("handles empty settings object", () => {
      const localData = makeLocalData({ settings: {} });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.page_settings).toEqual({});
    });

    test("handles empty elements array", () => {
      const localData = makeLocalData({ elements: [] });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      expect(result.elementor_data).toEqual([]);
    });

    test("does not include any extraneous fields from remote", () => {
      const localData = makeLocalData({});
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      // The result should only have fields from PageData
      const keys = Object.keys(result).sort();
      expect(keys).toEqual(
        [
          "id",
          "title",
          "slug",
          "status",
          "template",
          "elementor_data",
          "page_settings",
          "remote_modified",
        ].sort()
      );
    });

    test("preserves local data even when remote would return different elements", () => {
      // Simulates WP normalizing data (e.g., stripping unknown keys)
      const localElements: ElementorElement[] = [
        {
          id: "custom1",
          elType: "widget",
          widgetType: "html",
          settings: { custom_attr: "preserve-me" },
          elements: [],
        },
      ];

      const localData = makeLocalData({ elements: localElements });
      const remoteModified = "2024-06-15T12:00:00";

      const result = buildPostPushPageData(localData, remoteModified);

      // Local elements should be preserved exactly
      expect(result.elementor_data).toEqual(localElements);
      expect(result.elementor_data[0].settings.custom_attr).toBe("preserve-me");
    });
  });
});
