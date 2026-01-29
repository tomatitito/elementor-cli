import { readConfig, getSiteConfig } from "../utils/config-store.js";
import { WordPressClient } from "../services/wordpress-client.js";
import { DockerManager } from "../services/docker-manager.js";
import { LocalStore } from "../services/local-store.js";
import { ElementorParser } from "../services/elementor-parser.js";
import { createApiHandler } from "./api.js";

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

      // Static files
      const publicDir = import.meta.dir + "/public";

      if (pathname === "/" || pathname === "/index.html") {
        const file = Bun.file(`${publicDir}/index.html`);
        return new Response(file, {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (pathname === "/style.css") {
        const file = Bun.file(`${publicDir}/style.css`);
        return new Response(file, {
          headers: { "Content-Type": "text/css" },
        });
      }

      if (pathname === "/app.js") {
        const file = Bun.file(`${publicDir}/app.js`);
        return new Response(file, {
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
