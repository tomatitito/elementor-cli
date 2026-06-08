import { describe, test, expect } from "bun:test";
import type { SiteConfig } from "../../src/types/config.js";

/**
 * Helper function that mirrors the logic in push.ts
 * Determine if a revision should be created before pushing.
 * Priority: CLI flags > site config > default (false)
 */
function shouldCreateRevision(
  options: { revision?: boolean },
  siteConfig: { createRevisions?: boolean }
): boolean {
  // CLI flags take precedence
  if (options.revision === true) return true;
  if (options.revision === false) return false;

  // Fall back to site config
  return siteConfig.createRevisions ?? false;
}

describe("shouldCreateRevision", () => {
  describe("CLI flag precedence", () => {
    test("--revision flag forces revision creation", () => {
      const options = { revision: true };
      const config = { createRevisions: false };

      expect(shouldCreateRevision(options, config)).toBe(true);
    });

    test("--no-revision flag prevents revision creation", () => {
      const options = { revision: false };
      const config = { createRevisions: true };

      expect(shouldCreateRevision(options, config)).toBe(false);
    });

    test("--revision overrides config even when config is true", () => {
      const options = { revision: true };
      const config = { createRevisions: true };

      expect(shouldCreateRevision(options, config)).toBe(true);
    });

    test("--no-revision overrides config even when config is false", () => {
      const options = { revision: false };
      const config = { createRevisions: false };

      expect(shouldCreateRevision(options, config)).toBe(false);
    });
  });

  describe("site config fallback", () => {
    test("uses site config when no flag provided - true", () => {
      const options = {};
      const config = { createRevisions: true };

      expect(shouldCreateRevision(options, config)).toBe(true);
    });

    test("uses site config when no flag provided - false", () => {
      const options = {};
      const config = { createRevisions: false };

      expect(shouldCreateRevision(options, config)).toBe(false);
    });

    test("defaults to false when config is undefined", () => {
      const options = {};
      const config = {};

      expect(shouldCreateRevision(options, config)).toBe(false);
    });

    test("defaults to false when config.createRevisions is undefined", () => {
      const options = {};
      const config = { createRevisions: undefined };

      expect(shouldCreateRevision(options, config)).toBe(false);
    });
  });

  describe("real-world scenarios", () => {
    test("staging site (fast iteration) - no revision by default", () => {
      const options = {};
      const stagingConfig = { createRevisions: false };

      expect(shouldCreateRevision(options, stagingConfig)).toBe(false);
    });

    test("staging site - checkpoint with --revision flag", () => {
      const options = { revision: true };
      const stagingConfig = { createRevisions: false };

      expect(shouldCreateRevision(options, stagingConfig)).toBe(true);
    });

    test("production site - always backup by default", () => {
      const options = {};
      const productionConfig = { createRevisions: true };

      expect(shouldCreateRevision(options, productionConfig)).toBe(true);
    });

    test("production site - skip backup with --no-revision (use with caution)", () => {
      const options = { revision: false };
      const productionConfig = { createRevisions: true };

      expect(shouldCreateRevision(options, productionConfig)).toBe(false);
    });
  });
});
