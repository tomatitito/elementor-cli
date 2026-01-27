import { mkdir } from "node:fs/promises";
import { readConfig } from "../utils/config-store.js";
import type { PageData, ElementorElement, PageSettings } from "../types/elementor.js";

export interface LocalPageData {
  page: PageData;
  elements: ElementorElement[];
  settings: PageSettings;
  meta: {
    title: string;
    slug: string;
    status: string;
  };
}

export class LocalStore {
  private pagesDir: string;

  constructor(pagesDir: string) {
    this.pagesDir = pagesDir;
  }

  static async create(): Promise<LocalStore> {
    const config = await readConfig();
    return new LocalStore(config.pagesDir);
  }

  getPageDir(siteName: string, pageId: number): string {
    return `${process.cwd()}/${this.pagesDir}/${siteName}/${pageId}`;
  }

  async pageExists(siteName: string, pageId: number): Promise<boolean> {
    const dir = this.getPageDir(siteName, pageId);
    const pageFile = Bun.file(`${dir}/page.json`);
    return pageFile.exists();
  }

  async savePage(siteName: string, pageData: PageData): Promise<void> {
    const dir = this.getPageDir(siteName, pageData.id);
    await mkdir(dir, { recursive: true });

    // Save full page data
    await Bun.write(
      `${dir}/page.json`,
      JSON.stringify(pageData, null, 2)
    );

    // Save elements.json (for editing)
    await Bun.write(
      `${dir}/elements.json`,
      JSON.stringify(pageData.elementor_data, null, 2)
    );

    // Save settings.json
    await Bun.write(
      `${dir}/settings.json`,
      JSON.stringify(pageData.page_settings, null, 2)
    );

    // Save meta.json
    await Bun.write(
      `${dir}/meta.json`,
      JSON.stringify(
        {
          title: pageData.title,
          slug: pageData.slug,
          status: pageData.status,
        },
        null,
        2
      )
    );

    // Save pulled_at timestamp
    await Bun.write(`${dir}/.pulled_at`, new Date().toISOString());
  }

  async loadPage(siteName: string, pageId: number): Promise<LocalPageData | null> {
    const dir = this.getPageDir(siteName, pageId);

    const pageFile = Bun.file(`${dir}/page.json`);
    if (!(await pageFile.exists())) {
      return null;
    }

    const [page, elements, settings, meta] = await Promise.all([
      pageFile.json() as Promise<PageData>,
      Bun.file(`${dir}/elements.json`).json() as Promise<ElementorElement[]>,
      Bun.file(`${dir}/settings.json`).json() as Promise<PageSettings>,
      Bun.file(`${dir}/meta.json`).json() as Promise<{
        title: string;
        slug: string;
        status: string;
      }>,
    ]);

    return { page, elements, settings, meta };
  }

  async loadElements(siteName: string, pageId: number): Promise<ElementorElement[] | null> {
    const dir = this.getPageDir(siteName, pageId);
    const file = Bun.file(`${dir}/elements.json`);
    if (!(await file.exists())) {
      return null;
    }
    return file.json();
  }

  async loadSettings(siteName: string, pageId: number): Promise<PageSettings | null> {
    const dir = this.getPageDir(siteName, pageId);
    const file = Bun.file(`${dir}/settings.json`);
    if (!(await file.exists())) {
      return null;
    }
    return file.json();
  }

  async loadMeta(siteName: string, pageId: number): Promise<{ title: string; slug: string; status: string } | null> {
    const dir = this.getPageDir(siteName, pageId);
    const file = Bun.file(`${dir}/meta.json`);
    if (!(await file.exists())) {
      return null;
    }
    return file.json();
  }

  async getPulledAt(siteName: string, pageId: number): Promise<string | null> {
    const dir = this.getPageDir(siteName, pageId);
    const file = Bun.file(`${dir}/.pulled_at`);
    if (!(await file.exists())) {
      return null;
    }
    return file.text();
  }

  async listLocalPages(siteName: string): Promise<number[]> {
    const dir = `${process.cwd()}/${this.pagesDir}/${siteName}`;

    try {
      const glob = new Bun.Glob("*/page.json");
      const pages: number[] = [];

      for await (const file of glob.scan({ cwd: dir })) {
        const pageId = parseInt(file.split("/")[0], 10);
        if (!isNaN(pageId)) {
          pages.push(pageId);
        }
      }

      return pages.sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  async deletePage(siteName: string, pageId: number): Promise<boolean> {
    const dir = this.getPageDir(siteName, pageId);
    const pageFile = Bun.file(`${dir}/page.json`);

    if (!(await pageFile.exists())) {
      return false;
    }

    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
    return true;
  }
}
