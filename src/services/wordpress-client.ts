import type { SiteConfig } from "../types/config.js";
import type { WPPage, WPRevision, WPUser, WPError } from "../types/wordpress.js";

export class WordPressClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: SiteConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    const credentials = btoa(`${config.username}:${config.appPassword}`);
    this.authHeader = `Basic ${credentials}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/wp-json${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = (await response.json()) as WPError;
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<WPUser> {
    return this.request<WPUser>("/wp/v2/users/me");
  }

  async listPages(options: {
    status?: string;
    perPage?: number;
    page?: number;
  } = {}): Promise<WPPage[]> {
    const params = new URLSearchParams({
      per_page: String(options.perPage || 100),
      page: String(options.page || 1),
      context: "edit",
      _fields: "id,title,slug,status,modified,meta",
    });

    if (options.status && options.status !== "all") {
      params.set("status", options.status);
    } else {
      params.set("status", "publish,draft,private,pending");
    }

    return this.request<WPPage[]>(`/wp/v2/pages?${params}`);
  }

  async getPage(pageId: number): Promise<WPPage> {
    return this.request<WPPage>(`/wp/v2/pages/${pageId}?context=edit`);
  }

  async createPage(data: {
    title: string;
    status?: string;
    elementorData?: string;
    pageSettings?: Record<string, unknown>;
  }): Promise<WPPage> {
    return this.request<WPPage>("/wp/v2/pages", {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        status: data.status || "draft",
        meta: {
          _elementor_edit_mode: "builder",
          _elementor_data: data.elementorData || "[]",
          _elementor_page_settings: data.pageSettings || {},
        },
      }),
    });
  }

  async updatePage(
    pageId: number,
    data: {
      title?: string;
      status?: string;
      slug?: string;
      elementorData?: string;
      pageSettings?: Record<string, unknown>;
    }
  ): Promise<WPPage> {
    const body: Record<string, unknown> = {};

    if (data.title) body.title = data.title;
    if (data.status) body.status = data.status;
    if (data.slug) body.slug = data.slug;

    if (data.elementorData || data.pageSettings) {
      body.meta = {};
      if (data.elementorData) {
        (body.meta as Record<string, string>)._elementor_data =
          data.elementorData;
      }
      // Only send pageSettings if it has actual content
      // Sending empty {} causes WordPress to store it as a string which breaks Elementor
      if (data.pageSettings && Object.keys(data.pageSettings).length > 0) {
        (body.meta as Record<string, unknown>)._elementor_page_settings =
          data.pageSettings;
      }
    }

    return this.request<WPPage>(`/wp/v2/pages/${pageId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async deletePage(pageId: number, force = false): Promise<void> {
    await this.request<unknown>(
      `/wp/v2/pages/${pageId}?force=${force}`,
      {
        method: "DELETE",
      }
    );
  }

  async getRevisions(pageId: number): Promise<WPRevision[]> {
    return this.request<WPRevision[]>(
      `/wp/v2/pages/${pageId}/revisions?context=edit`
    );
  }

  async getRevision(pageId: number, revisionId: number): Promise<WPRevision> {
    return this.request<WPRevision>(
      `/wp/v2/pages/${pageId}/revisions/${revisionId}?context=edit`
    );
  }

  isElementorPage(page: WPPage): boolean {
    return page.meta?._elementor_edit_mode === "builder";
  }
}
