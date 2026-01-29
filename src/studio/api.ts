import type { WordPressClient } from "../services/wordpress-client.js";
import type { DockerManager } from "../services/docker-manager.js";
import type { LocalStore } from "../services/local-store.js";
import type { ElementorParser } from "../services/elementor-parser.js";
import type { SiteConfig, Config } from "../types/config.js";

export interface ApiContext {
  wpClient: WordPressClient;
  docker: DockerManager;
  store: LocalStore;
  parser: ElementorParser;
  siteName: string;
  siteConfig: SiteConfig;
  config: Config;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 500): Response {
  return json({ error: message }, status);
}

export function createApiHandler(ctx: ApiContext) {
  return async (req: Request, url: URL): Promise<Response> => {
    const pathname = url.pathname;

    try {
      // GET /api/config - Get current configuration
      if (pathname === "/api/config" && req.method === "GET") {
        const stagingStatus = await ctx.docker.getStatus();
        return json({
          site: {
            name: ctx.siteName,
            url: ctx.siteConfig.url,
          },
          staging: {
            url: ctx.docker.getUrl(),
            running: stagingStatus.running,
          },
        });
      }

      // GET /api/pages - List all Elementor pages
      if (pathname === "/api/pages" && req.method === "GET") {
        const pages = await ctx.wpClient.listPages();
        const elementorPages = pages.filter((p) => ctx.wpClient.isElementorPage(p));
        return json(
          elementorPages.map((p) => ({
            id: p.id,
            title: p.title.rendered,
            slug: p.slug,
            status: p.status,
            modified: p.modified,
            url: `${ctx.siteConfig.url}/${p.slug}/`,
            stagingUrl: `${ctx.docker.getUrl()}/?p=${p.id}`,
          }))
        );
      }

      // GET /api/pages/:id - Get page details
      const pageMatch = pathname.match(/^\/api\/pages\/(\d+)$/);
      if (pageMatch && req.method === "GET") {
        const pageId = parseInt(pageMatch[1], 10);
        const page = await ctx.wpClient.getPage(pageId);
        return json({
          id: page.id,
          title: page.title.rendered,
          slug: page.slug,
          status: page.status,
          modified: page.modified,
          url: `${ctx.siteConfig.url}/${page.slug}/`,
          stagingUrl: `${ctx.docker.getUrl()}/?p=${page.id}`,
          hasLocalChanges: await ctx.store.pageExists(ctx.siteName, pageId),
        });
      }

      // POST /api/sync/:id - Sync page to staging
      const syncMatch = pathname.match(/^\/api\/sync\/(\d+)$/);
      if (syncMatch && req.method === "POST") {
        const pageId = parseInt(syncMatch[1], 10);

        // Check if staging is running
        const status = await ctx.docker.getStatus();
        if (!status.running) {
          return error("Staging environment is not running", 503);
        }

        // Get local page data
        const localData = await ctx.store.loadPage(ctx.siteName, pageId);
        if (!localData) {
          // No local data, pull from remote first
          return error("Page not found locally. Pull it first.", 404);
        }

        // Try to update existing page, or create new one
        try {
          await ctx.docker.updatePost(pageId, {
            title: localData.meta.title,
            slug: localData.meta.slug,
            status: localData.meta.status,
          });
        } catch {
          // Page doesn't exist in staging, create it
          await ctx.docker.createPage(localData.meta.title, localData.meta.status);
        }

        // Update Elementor meta
        await ctx.docker.updatePostMeta(pageId, "_elementor_edit_mode", "builder");
        await ctx.docker.updatePostMeta(
          pageId,
          "_elementor_data",
          ctx.parser.serializeElements(localData.elements)
        );
        await ctx.docker.updatePostMeta(
          pageId,
          "_elementor_page_settings",
          ctx.parser.serializeSettings(localData.settings)
        );

        // Flush CSS cache
        await ctx.docker.flushElementorCss();

        return json({ success: true, message: `Synced page ${pageId} to staging` });
      }

      // POST /api/push/:id - Push page to production
      const pushMatch = pathname.match(/^\/api\/push\/(\d+)$/);
      if (pushMatch && req.method === "POST") {
        const pageId = parseInt(pushMatch[1], 10);

        // Get local page data
        const localData = await ctx.store.loadPage(ctx.siteName, pageId);
        if (!localData) {
          return error("Page not found locally", 404);
        }

        // Update remote page
        await ctx.wpClient.updatePage(pageId, {
          title: localData.meta.title,
          status: localData.meta.status,
          slug: localData.meta.slug,
          elementorData: ctx.parser.serializeElements(localData.elements),
          pageSettings: localData.settings,
        });

        return json({ success: true, message: `Pushed page ${pageId} to production` });
      }

      // POST /api/regenerate-css/:id - Regenerate CSS for page
      const cssMatch = pathname.match(/^\/api\/regenerate-css\/(\d+)$/);
      if (cssMatch && req.method === "POST") {
        const pageId = parseInt(cssMatch[1], 10);
        await ctx.wpClient.invalidateCss(pageId);
        return json({ success: true, message: `Invalidated CSS cache for page ${pageId}` });
      }

      // POST /api/pull/:id - Pull page from remote
      const pullMatch = pathname.match(/^\/api\/pull\/(\d+)$/);
      if (pullMatch && req.method === "POST") {
        const pageId = parseInt(pullMatch[1], 10);

        const page = await ctx.wpClient.getPage(pageId);

        if (!ctx.wpClient.isElementorPage(page)) {
          return error("Page is not an Elementor page", 400);
        }

        const pageData = ctx.parser.parseWPPage(page);
        await ctx.store.savePage(ctx.siteName, pageData);

        return json({ success: true, message: `Pulled page ${pageId}` });
      }

      // GET /api/staging/status - Get staging environment status
      if (pathname === "/api/staging/status" && req.method === "GET") {
        const status = await ctx.docker.getStatus();
        return json({
          running: status.running,
          url: ctx.docker.getUrl(),
          services: status.services,
        });
      }

      return error("Not Found", 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message, 500);
    }
  };
}
