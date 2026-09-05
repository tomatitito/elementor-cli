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
│   │   ├── search-replace.ts       # Search/replace (remote + local)
│   │   ├── status.ts               # CSS metadata analysis
│   │   ├── studio.ts               # Web UI server
│   │   ├── export.ts               # JSON template export
│   │   ├── export-html.ts          # Static HTML export
│   │   ├── templates.ts            # Template management
│   │   └── update.ts               # Self-update
│   ├── services/
│   │   ├── wordpress-client.ts     # REST API client
│   │   ├── elementor-parser.ts     # JSON parsing/transformation
│   │   ├── local-store.ts          # Local file operations
│   │   ├── docker-manager.ts       # Docker compose operations
│   │   ├── container-cli.ts        # Container runtime abstraction (Docker/Podman)
│   │   ├── revision-manager.ts     # Revision operations
│   │   ├── template-library.ts     # Built-in template definitions
│   │   ├── template-store.ts       # Template file storage (project + global)
│   │   ├── template-preview.ts     # Template preview server
│   │   └── html-converter.ts       # HTML to Elementor conversion
│   ├── types/
│   │   ├── index.ts                # Re-exports
│   │   ├── elementor.ts            # Elementor element types
│   │   ├── wordpress.ts            # WP REST API types
│   │   ├── config.ts               # Config schema types (Zod)
│   │   └── template.ts             # Template types and schemas
│   └── utils/
│       ├── config-store.ts         # YAML config read/write
│       ├── constants.ts            # Paths and directory constants
│       ├── element-helpers.ts      # Elementor element utilities
│       ├── logger.ts               # Colored output, spinners
│       └── prompts.ts              # Interactive prompts
├── tests/
│   ├── unit/
│   │   ├── wordpress-client.test.ts
│   │   └── push-revision.test.ts
│   └── e2e/
│       ├── db.test.ts
│       ├── pages.test.ts
│       ├── pull-push-diff.test.ts
│       ├── preview.test.ts
│       ├── preview-docker.test.ts
│       ├── revisions.test.ts
│       └── templates.test.ts
├── docs/                           # Feature documentation
│   ├── css-cache-invalidation.md
│   └── local-search-replace.md
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
| `container-cli.ts` | Container runtime abstraction (Docker/Podman) for WP-CLI |
| `revision-manager.ts` | Revision fetching, restore, and backup creation |
| `template-library.ts` | Built-in template definitions |
| `template-store.ts` | Template file storage (project-local + global) |
| `template-preview.ts` | Template preview HTTP server |
| `html-converter.ts` | HTML to Elementor element conversion |

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

**src/types/config.ts** (uses Zod schemas):
```typescript
export interface ContainerConfig {
  runtime: "docker" | "podman";
  name: string;
}

export interface DeployConfig {
  wordpressPath: string;             // Canonical live WordPress root
  releasesPath: string;              // Canonical, disjoint release root
  backupsPath?: string;              // 0700 matching file/DB publication backups
  configSourcePath?: string;          // Protected server-side wp-config.php (0600)
  maintenancePath?: string;           // External hosting maintenance marker
  wpCliPath?: string;                 // Protected server-side WP-CLI executable
  smokeUrls?: string[];               // HTTPS post-publish/rollback checks
  strategy: "directory-rename";
}

export interface SiteConfig {
  url: string;
  username: string;
  appPassword: string;
  container?: ContainerConfig;       // Container for WP-CLI (CSS flush)
  deploy?: DeployConfig;             // SSH staging and guarded publication
  createRevisions?: boolean;         // Auto-create revision before push (default: false)
}

export interface StagingConfig {
  path: string;
  service: string;
  url: string;
  wpCommand: string;                 // WP-CLI command (default: "wp")
  containerRuntime: "docker" | "podman";  // Container runtime (default: "docker")
}

export interface Config {
  defaultSite?: string;
  sites: Record<string, SiteConfig>;
  staging: StagingConfig;
  pagesDir: string;
}
```

The optional publish-capable fields are required as a complete set by
`deploy publish` and `deploy rollback`; older plan/upload/status-only config is
still valid. Live, releases, and backups are canonical, disjoint roots owned by
the deploy account; config, maintenance, and WP-CLI paths remain outside them.
The remote release-root sentinel is schema version 2 and contains exactly
`schemaVersion`, `wordpressPath`, `releasesPath`, `backupsPath`,
`configSourcePath`, `maintenancePath`, and `wpCliPath` (not `smokeUrls`).

The server layout is deliberately flat: `wordpressPath` directly contains
`index.php`, `wp-admin/`, `wp-includes/`, and `wp-content/`. Publication audit
records and matching file/database backup pairs are stored in per-publication
mode-`0700` directories under `backupsPath`; protected production config is
copied into the promoted tree as mode `0600`. Hosting, not the CLI, must map the
external maintenance marker to a 503 response.

**src/types/template.ts:**
```typescript
export type TemplateSource = "built-in" | "global" | "project";

export interface TemplateFile {
  name: string;
  slug: string;
  description?: string;
  source?: TemplateSource;
  elements: ElementorElement[];
  settings?: PageSettings;
  sourcePageId?: number;
  created_at?: string;
  updated_at?: string;
}
```

### Utils

Shared utilities:

| Utility | Purpose |
|---------|---------|
| `config-store.ts` | Read/write `.elementor-cli.yaml` |
| `constants.ts` | Path constants (`CLI_DIR`, `DEFAULT_PAGES_DIR`, etc.) |
| `element-helpers.ts` | Elementor element tree utilities |
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

Tests are organized in a separate `tests/` directory:

```
tests/
├── unit/
│   ├── wordpress-client.test.ts
│   └── push-revision.test.ts
└── e2e/
    ├── db.test.ts
    ├── pages.test.ts
    ├── pull-push-diff.test.ts
    ├── preview.test.ts
    ├── preview-docker.test.ts
    ├── revisions.test.ts
    └── templates.test.ts
```

Run tests with:
```bash
# Unit tests
bun test

# E2E tests (requires Docker)
bun test:e2e

# E2E setup/teardown
bun test:e2e:setup
bun test:e2e:teardown
```

---

## Configuration Files

### package.json

```json
{
  "name": "elementor-cli",
  "version": "0.4.2",
  "type": "module",
  "bin": {
    "elementor-cli": "./dist/elementor-cli"
  },
  "scripts": {
    "dev": "bun --watch run src/index.ts",
    "start": "bun run src/index.ts",
    "build": "bun build src/index.ts --outfile dist/elementor-cli --target bun",
    "test": "bun test --ignore 'tests/e2e/**'",
    "test:e2e": "bun test tests/e2e",
    "test:e2e:setup": "cd tests/e2e && docker compose up -d",
    "test:e2e:teardown": "cd tests/e2e && docker compose down -v",
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
