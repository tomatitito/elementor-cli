# Project Structure

File and directory structure for `elementor-cli`.

---

## Source Code

```
elementor-cli/
├── package.json
├── tsconfig.json
├── biome.json
├── README.md
├── IMPLEMENTATION_PLAN.md          # Development roadmap
├── specs/                          # This documentation
│   ├── readme.md
│   ├── commands.md
│   ├── configuration.md
│   ├── api.md
│   ├── elementor-json.md
│   └── structure.md
├── src/
│   ├── index.ts                    # CLI entry point
│   ├── commands/
│   │   ├── config.ts               # config subcommands
│   │   ├── pages.ts                # pages list/info/create/delete
│   │   ├── pull.ts                 # pull command
│   │   ├── push.ts                 # push command
│   │   ├── preview.ts              # preview subcommands (incl. watch)
│   │   ├── db.ts                   # db dump/restore/list
│   │   ├── revisions.ts            # revisions subcommands
│   │   ├── diff.ts                 # diff command
│   │   ├── regenerate-css.ts       # CSS cache invalidation
│   │   ├── audit.ts                # URL/asset verification
│   │   ├── search-replace.ts       # URL migration tool
│   │   ├── status.ts               # CSS metadata analysis
│   │   ├── studio.ts               # Web UI server
│   │   ├── export.ts               # JSON template export
│   │   └── export-html.ts          # Static HTML export
│   ├── services/
│   │   ├── wordpress-client.ts     # REST API client
│   │   ├── wordpress-client.test.ts # Tests (colocated with source)
│   │   ├── elementor-parser.ts     # JSON parsing/transformation
│   │   ├── local-store.ts          # Local file operations
│   │   ├── docker-manager.ts       # Docker compose operations
│   │   ├── revision-manager.ts     # Revision operations
│   │   ├── template-library.ts     # Page template management
│   │   └── studio/                 # Studio web UI
│   │       ├── server.ts           # HTTP server setup
│   │       ├── api.ts              # API route handlers
│   │       └── public/             # Static web assets
│   │           ├── index.html
│   │           ├── style.css
│   │           └── app.js
│   ├── types/
│   │   ├── index.ts                # Re-exports
│   │   ├── elementor.ts            # Elementor element types
│   │   ├── wordpress.ts            # WP REST API types
│   │   └── config.ts               # Config schema types
│   └── utils/
│       ├── config-store.ts         # YAML config read/write
│       ├── logger.ts               # Colored output, spinners
│       └── prompts.ts              # Interactive prompts
└── dist/                           # Build output
    └── elementor-cli               # Compiled executable
```

---

## Source Files

### Entry Point

**src/index.ts** - CLI setup and command registration:
```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { configCommand } from "./commands/config.js";
import { pagesCommand } from "./commands/pages.js";
// ... other commands
import pkg from "../package.json";

const program = new Command();

program
  .name("elementor-cli")
  .description("Manage Elementor pages from the command line")
  .version(pkg.version)
  .addHelpText("after", `
Examples:
  $ elementor-cli config init                    Initialize configuration
  $ elementor-cli pages list                     List all Elementor pages
  $ elementor-cli pull 42                        Download page with ID 42
  `);

program.addCommand(configCommand);
program.addCommand(pagesCommand);
// ... register other commands

program.parse();
```

### Commands

Each command file exports a Commander subcommand:

**src/commands/config.ts:**
```typescript
import { Command } from "commander";

export const configCommand = new Command("config")
  .description("Manage site connections");

configCommand
  .command("init")
  .description("Initialize config file")
  .action(async () => { /* ... */ });

configCommand
  .command("add <name>")
  .option("--url <url>", "WordPress site URL")
  .option("--username <user>", "Admin username")
  .option("--app-password <pass>", "Application password")
  .action(async (name, options) => { /* ... */ });
```

### Services

Business logic and external integrations:

| Service | Responsibility |
|---------|----------------|
| `wordpress-client.ts` | REST API calls, authentication |
| `elementor-parser.ts` | Parse/transform Elementor JSON |
| `local-store.ts` | Read/write page files locally |
| `docker-manager.ts` | Docker compose commands |
| `revision-manager.ts` | Revision fetching and restore |
| `template-library.ts` | Page template management |
| `studio/` | Web UI server and API handlers |

### Types

TypeScript type definitions:

**src/types/elementor.ts:**
```typescript
export interface ElementorElement {
  id: string;
  elType: "container" | "section" | "column" | "widget";
  widgetType?: string;
  settings: Record<string, unknown>;
  elements: ElementorElement[];
  isInner?: boolean;
}

export interface PageData {
  id: number;
  title: string;
  slug: string;
  status: "publish" | "draft" | "private";
  elementor_data: ElementorElement[];
  page_settings: Record<string, unknown>;
}
```

**src/types/config.ts:**
```typescript
export interface SiteConfig {
  url: string;
  username: string;
  appPassword: string;
}

export interface StagingConfig {
  path: string;
  service: string;
  url: string;
}

export interface Config {
  defaultSite: string;
  sites: Record<string, SiteConfig>;
  staging: StagingConfig;
  pagesDir: string;
}
```

### Utils

Shared utilities:

| Utility | Purpose |
|---------|---------|
| `config-store.ts` | Read/write `.elementor-cli.yaml` |
| `logger.ts` | Colored console output, spinners |
| `prompts.ts` | Interactive user prompts |

---

## Generated Files

### docker-compose.yml

When you run `elementor-cli preview init`, this docker-compose.yml is generated:

```yaml
services:
  wordpress:
    image: wordpress:latest
    ports:
      - "8080:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wordpress
      WORDPRESS_DB_PASSWORD: wordpress
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wordpress_data:/var/www/html
    depends_on:
      - db

  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wordpress
      MYSQL_PASSWORD: wordpress
      MYSQL_ROOT_PASSWORD: rootpassword
    volumes:
      - db_data:/var/lib/mysql

volumes:
  wordpress_data:
  db_data:
```

---

## Tests

Tests are colocated with source files:

```
src/services/
└── wordpress-client.test.ts  # Tests for wordpress-client.ts
```

Run tests with:
```bash
bun test
```

---

## Configuration Files

### package.json

```json
{
  "name": "elementor-cli",
  "version": "0.2.2",
  "type": "module",
  "bin": {
    "elementor-cli": "./dist/elementor-cli"
  },
  "scripts": {
    "dev": "bun --watch run src/index.ts",
    "start": "bun run src/index.ts",
    "build": "bun build src/index.ts --outfile dist/elementor-cli --target bun",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "@inquirer/prompts": "^5.0.0",
    "zod": "^3.22.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.0",
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.4.0",
    "@biomejs/biome": "^1.5.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### biome.json

```json
{
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```
