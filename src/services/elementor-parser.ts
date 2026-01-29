import type { WPPage } from "../types/wordpress.js";
import type { PageData, ElementorElement, PageSettings } from "../types/elementor.js";

export class ElementorParser {
  /**
   * Parse a WordPress page response into structured PageData
   */
  parseWPPage(wpPage: WPPage): PageData {
    let elementorData: ElementorElement[] = [];
    let pageSettings: PageSettings = {};

    if (wpPage.meta._elementor_data) {
      try {
        elementorData = JSON.parse(wpPage.meta._elementor_data);
      } catch {
        elementorData = [];
      }
    }

    if (wpPage.meta._elementor_page_settings) {
      try {
        const parsed =
          typeof wpPage.meta._elementor_page_settings === "string"
            ? JSON.parse(wpPage.meta._elementor_page_settings)
            : wpPage.meta._elementor_page_settings;
        // Ensure settings is always an object, not an array
        // WordPress/Elementor can return [] for empty settings, but expects {}
        pageSettings = Array.isArray(parsed) ? {} : parsed;
      } catch {
        pageSettings = {};
      }
    }

    return {
      id: wpPage.id,
      title: wpPage.title.raw || wpPage.title.rendered,
      slug: wpPage.slug,
      status: wpPage.status,
      elementor_data: elementorData,
      page_settings: pageSettings,
      pulled_at: new Date().toISOString(),
      remote_modified: wpPage.modified,
    };
  }

  /**
   * Serialize elements array to JSON string for API
   */
  serializeElements(elements: ElementorElement[]): string {
    return JSON.stringify(elements);
  }

  /**
   * Serialize page settings to JSON string for API
   */
  serializeSettings(settings: PageSettings): string {
    return JSON.stringify(settings);
  }

  /**
   * Generate a unique element ID
   */
  generateElementId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  /**
   * Deep clone an element tree
   */
  cloneElements(elements: ElementorElement[]): ElementorElement[] {
    return JSON.parse(JSON.stringify(elements));
  }

  /**
   * Find an element by ID in the tree
   */
  findElement(
    elements: ElementorElement[],
    id: string
  ): ElementorElement | null {
    for (const el of elements) {
      if (el.id === id) {
        return el;
      }
      if (el.elements && el.elements.length > 0) {
        const found = this.findElement(el.elements, id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Count total elements in tree
   */
  countElements(elements: ElementorElement[]): number {
    let count = 0;
    for (const el of elements) {
      count++;
      if (el.elements && el.elements.length > 0) {
        count += this.countElements(el.elements);
      }
    }
    return count;
  }

  /**
   * Get all widgets from element tree
   */
  getWidgets(elements: ElementorElement[]): ElementorElement[] {
    const widgets: ElementorElement[] = [];

    const traverse = (els: ElementorElement[]) => {
      for (const el of els) {
        if (el.elType === "widget") {
          widgets.push(el);
        }
        if (el.elements && el.elements.length > 0) {
          traverse(el.elements);
        }
      }
    };

    traverse(elements);
    return widgets;
  }

  /**
   * Compare two element trees and find differences
   */
  diffElements(
    local: ElementorElement[],
    remote: ElementorElement[]
  ): ElementDiff {
    const localIds = new Set(this.getAllIds(local));
    const remoteIds = new Set(this.getAllIds(remote));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    // Find added (in local but not in remote)
    for (const id of localIds) {
      if (!remoteIds.has(id)) {
        added.push(id);
      }
    }

    // Find removed (in remote but not in local)
    for (const id of remoteIds) {
      if (!localIds.has(id)) {
        removed.push(id);
      }
    }

    // Find modified (same ID but different settings)
    for (const id of localIds) {
      if (remoteIds.has(id)) {
        const localEl = this.findElement(local, id);
        const remoteEl = this.findElement(remote, id);
        if (
          localEl &&
          remoteEl &&
          JSON.stringify(localEl.settings) !== JSON.stringify(remoteEl.settings)
        ) {
          modified.push(id);
        }
      }
    }

    return { added, removed, modified };
  }

  private getAllIds(elements: ElementorElement[]): string[] {
    const ids: string[] = [];

    const traverse = (els: ElementorElement[]) => {
      for (const el of els) {
        ids.push(el.id);
        if (el.elements && el.elements.length > 0) {
          traverse(el.elements);
        }
      }
    };

    traverse(elements);
    return ids;
  }
}

export interface ElementDiff {
  added: string[];
  removed: string[];
  modified: string[];
}
