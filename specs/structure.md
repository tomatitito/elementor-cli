# Project Structure

File and directory structure for `elementor-cli`.

---

## Source Code

```
elementor-cli/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── biome.json
├── README.md
├── src/
│   ├── index.ts                    # CLI entry point
│   ├── commands/
│   │   ├── config.ts               # config subcommands
│   │   ├── pages.ts                # pages list/info/create/delete
│   │   ├── pull.ts                 # pull command
│   │   ├── push.ts                 # push command
│   │   ├── preview.ts              # preview subcommands
│   │   ├── db.ts                   # db dump/restore/list
│   │   ├── revisions.ts            # revisions subcommands
│   │   └── diff.ts                 # diff command
│   ├── services/
│   │   ├── wordpress-client.ts     # REST API client
│   │   ├── elementor-parser.ts     # JSON parsing/transformation
│   │   ├── local-store.ts          # Local file operations
│   │   ├── docker-manager.ts       # Docker compose operations
│   │   └── revision-manager.ts     # Revision operations
│   ├── types/
│   │   ├── index.ts                # Re-exports
│   │   ├── elementor.ts            # Elementor element types
│   │   ├── wordpress.ts            # WP REST API types
│   │   └── config.ts               # Config schema types
│   └── utils/
│       ├── config-store.ts         # YAML config read/write
│       ├── logger.ts               # Colored output, spinners
│       └── prompts.ts              # Interactive prompts
├── templates/
│   ├── docker-compose.yml          # Default staging setup
│   └── page-templates/
│       └── blank.json              # Blank page template
└── tests/
    ├── config-store.test.ts
    ├── wordpress-client.test.ts
    ├── elementor-parser.test.ts
    └── local-store.test.ts
```

---

## Source Files

### Entry Point

**src/index.ts** - CLI setup and command registration:
```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { configCommand } from "./commands/config";
import { pagesCommand } from "./commands/pages";
// ... other commands

const program = new Command();

program
  .name("elementor-cli")
  .description("Manage Elementor pages from the command line")
  .version("0.1.0");

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

## Templates

### docker-compose.yml

Default staging environment template:

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

### Page Templates

**templates/page-templates/blank.json:**
```json
{
  "elementor_data": [],
  "page_settings": {}
}
```

---

## Tests

Test files mirror the source structure:

```
tests/
├── config-store.test.ts      # Tests for src/utils/config-store.ts
├── wordpress-client.test.ts  # Tests for src/services/wordpress-client.ts
├── elementor-parser.test.ts  # Tests for src/services/elementor-parser.ts
├── local-store.test.ts       # Tests for src/services/local-store.ts
└── helpers.ts                # Shared test utilities
```

---

## Configuration Files

### package.json

```json
{
  "name": "elementor-cli",
  "version": "0.1.0",
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
