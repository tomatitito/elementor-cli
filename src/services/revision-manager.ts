import type { WPRevision } from "../types/wordpress.js";
import type { ElementorElement } from "../types/elementor.js";
import { WordPressClient } from "./wordpress-client.js";
import { ElementorParser } from "./elementor-parser.js";

export interface ParsedRevision {
  id: number;
  parent: number;
  date: string;
  author: number;
  title: string;
  elementorData: ElementorElement[];
  hasElementorData: boolean;
}

export class RevisionManager {
  private client: WordPressClient;
  private parser: ElementorParser;

  constructor(client: WordPressClient) {
    this.client = client;
    this.parser = new ElementorParser();
  }

  async listRevisions(pageId: number): Promise<ParsedRevision[]> {
    const revisions = await this.client.getRevisions(pageId);

    return revisions.map((rev) => this.parseRevision(rev));
  }

  async getRevision(pageId: number, revisionId: number): Promise<ParsedRevision> {
    const revision = await this.client.getRevision(pageId, revisionId);
    return this.parseRevision(revision);
  }

  async restoreRevision(pageId: number, revisionId: number): Promise<void> {
    const revision = await this.client.getRevision(pageId, revisionId);

    if (!revision.meta?._elementor_data) {
      throw new Error("Revision does not contain Elementor data");
    }

    // Parse page settings if they exist (stored as JSON string in meta)
    let pageSettings: Record<string, unknown> | undefined;
    if (revision.meta._elementor_page_settings) {
      try {
        pageSettings = JSON.parse(revision.meta._elementor_page_settings);
      } catch {
        // Ignore parse errors
      }
    }

    await this.client.updatePage(pageId, {
      elementorData: revision.meta._elementor_data,
      pageSettings,
    });
  }

  async createBackup(pageId: number): Promise<void> {
    // Fetch current page data
    const page = await this.client.getPage(pageId);

    // WordPress automatically creates a revision when we update the page
    // We do a no-op update to trigger revision creation
    await this.client.updatePage(pageId, {
      title: page.title.raw || page.title.rendered,
    });
  }

  diffWithCurrent(
    currentElements: ElementorElement[],
    revisionElements: ElementorElement[]
  ) {
    return this.parser.diffElements(currentElements, revisionElements);
  }

  private parseRevision(rev: WPRevision): ParsedRevision {
    let elementorData: ElementorElement[] = [];
    let hasElementorData = false;

    if (rev.meta?._elementor_data) {
      try {
        elementorData = JSON.parse(rev.meta._elementor_data);
        hasElementorData = true;
      } catch {
        elementorData = [];
      }
    }

    return {
      id: rev.id,
      parent: rev.parent,
      date: rev.date,
      author: rev.author,
      title: rev.title.rendered,
      elementorData,
      hasElementorData,
    };
  }
}
