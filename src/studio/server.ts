import { readConfig, getSiteConfig } from "../utils/config-store.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { DockerManager } from "../services/docker-manager.js";
import { LocalStore } from "../services/local-store.js";
import { ElementorParser } from "../services/elementor-parser.js";
import { createApiHandler } from "./api.js";

// Embed static assets directly for bundled builds
// @ts-ignore - Bun text imports
import indexHtml from "./public/index.html" with { type: "text" };
// @ts-ignore - Bun text imports
import styleCss from "./public/style.css" with { type: "text" };
// @ts-ignore - Bun text imports
import appJs from "./public/app.js" with { type: "text" };

export interface StudioOptions {
  port: number;
  site?: string;
}

export interface StudioServer {
  server: ReturnType<typeof Bun.serve>;
  url: string;
  stop: () => void;
}

export async function createStudioServer(
  options: StudioOptions
): Promise<StudioServer> {
  const config = await readConfig();
  const { name: siteName, config: siteConfig } = await getSiteConfig(options.site);

  const wpClient = new WordPressClient(siteConfig);
  const docker = await DockerManager.create();
  const store = await LocalStore.create();
  const parser = new ElementorParser();

  const apiHandler = createApiHandler({
    wpClient,
    docker,
    store,
    parser,
    siteName,
    siteConfig,
    config,
  });

  const server = Bun.serve({
    port: options.port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // API routes
      if (pathname.startsWith("/api/")) {
        return apiHandler(req, url);
      }

      // Static files - serve embedded assets
      if (pathname === "/" || pathname === "/index.html") {
        return new Response(indexHtml as unknown as string, {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (pathname === "/style.css") {
        return new Response(styleCss as unknown as string, {
          headers: { "Content-Type": "text/css" },
        });
      }

      if (pathname === "/app.js") {
        return new Response(appJs as unknown as string, {
          headers: { "Content-Type": "application/javascript" },
        });
      }

      // 404 for everything else
      return new Response("Not Found", { status: 404 });
    },
  });

  return {
    server,
    url: `http://localhost:${options.port}`,
    stop: () => server.stop(),
  };
}
