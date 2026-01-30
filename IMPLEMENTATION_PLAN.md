# elementor-cli: Custom Templates Implementation Plan

This document covers the implementation of custom template features.

---

## Implementation Status

| Feature | Status |
|---------|--------|
| `templates list` | ⬜ Planned |
| `templates save` | ⬜ Planned |
| `templates import-html` | ⬜ Planned |
| `templates info` | ⬜ Planned |
| `templates preview` | ⬜ Planned |
| `templates delete` | ⬜ Planned |
| `templates export` | ⬜ Planned |
| TemplateStore service | ⬜ Planned |
| HtmlConverter service | ⬜ Planned |
| TemplatePreview server | ⬜ Planned |
| Update `pages create --template` | ⬜ Planned |
| E2E tests | ⬜ Planned |

---

## Overview

Add user-defined template management with HTML import support. Users can save pages as reusable templates, import HTML files as Elementor templates, and preview templates in a browser.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  templates command group                                         │
├─────────────────────────────────────────────────────────────────┤
│  Subcommands                                                     │
│  ├── list         - List all templates (built-in + custom)     │
│  ├── save         - Save page as reusable template              │
│  ├── import-html  - Convert HTML file to Elementor template     │
│  ├── info         - Show template details                       │
│  ├── preview      - Render template in browser                  │
│  ├── delete       - Remove custom template                      │
│  └── export       - Export template to JSON file                │
├─────────────────────────────────────────────────────────────────┤
│  Services                                                        │
│  ├── TemplateStore     - Custom template storage/loading        │
│  ├── HtmlConverter     - HTML to Elementor conversion           │
│  └── TemplatePreview   - Template preview server                │
├─────────────────────────────────────────────────────────────────┤
│  Storage Locations                                               │
│  ├── .elementor-cli/templates/     - Project-local templates    │
│  └── ~/.elementor-cli/templates/   - Global custom templates    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Commands

### `templates list`

List all available templates with their source (built-in, global, or project).

```bash
elementor-cli templates list [options]

Options:
  --source <type>   Filter by source: built-in, global, project, custom (all custom)
  --json            Output as JSON

Examples:
  elementor-cli templates list
  elementor-cli templates list --source project
  elementor-cli templates list --json
```

### `templates save`

Save an existing page as a reusable template.

```bash
elementor-cli templates save <page-id> [options]

Options:
  -n, --name <name>          Template name (required)
  -d, --description <desc>   Template description
  -g, --global               Save as global template (default: project)
  -s, --site <name>          Site name from config

Examples:
  elementor-cli templates save 42 --name "My Hero Section"
  elementor-cli templates save 42 --name "Landing Page" --global
  elementor-cli templates save 42 --name "Contact Form" --description "Simple contact form layout"
```

### `templates import-html`

Convert an HTML file to an Elementor template.

```bash
elementor-cli templates import-html <file> [options]

Options:
  -n, --name <name>          Template name (default: filename)
  -d, --description <desc>   Template description
  -g, --global               Save as global template (default: project)

Examples:
  elementor-cli templates import-html landing.html
  elementor-cli templates import-html hero.html --name "Custom Hero" --global
```

### `templates info`

Show detailed information about a template.

```bash
elementor-cli templates info <template-name>

Examples:
  elementor-cli templates info hero-section
  elementor-cli templates info "My Custom Template"
```

### `templates preview`

Render a template in the browser for visual inspection.

```bash
elementor-cli templates preview <template-name> [options]

Options:
  -p, --port <port>   Port for preview server (default: 3001)
  --no-open           Don't open browser automatically

Examples:
  elementor-cli templates preview hero-section
  elementor-cli templates preview "My Template" --port 8080
```

### `templates delete`

Remove a custom template (cannot delete built-in templates).

```bash
elementor-cli templates delete <template-name> [options]

Options:
  -f, --force   Delete without confirmation

Examples:
  elementor-cli templates delete "My Old Template"
  elementor-cli templates delete "Unused Layout" --force
```

### `templates export`

Export a template to a JSON file.

```bash
elementor-cli templates export <template-name> [options]

Options:
  -o, --output <file>   Output file path (default: <template-name>.json)

Examples:
  elementor-cli templates export hero-section
  elementor-cli templates export "My Template" --output my-template.json
```

---

## Services

### TemplateStore

Manages loading, saving, and merging templates from multiple sources.

**Responsibilities:**
- Load templates from `~/.elementor-cli/templates/` (global)
- Load templates from `.elementor-cli/templates/` (project)
- Merge with built-in templates (project > global > built-in precedence)
- Validate template format with Zod schema
- Save new templates to appropriate location

**Interface:**
```typescript
interface TemplateStore {
  listAll(): Promise<Template[]>;
  listBySource(source: 'built-in' | 'global' | 'project'): Promise<Template[]>;
  get(name: string): Promise<Template | null>;
  save(template: Template, global: boolean): Promise<void>;
  delete(name: string): Promise<boolean>;
  exists(name: string): Promise<boolean>;
}
```

### HtmlConverter

Converts HTML files to Elementor element structures.

**Supported Conversions:**
| HTML Element | Elementor Widget |
|-------------|------------------|
| `<h1>` - `<h6>` | `heading` |
| `<p>`, `<div>` with text | `text-editor` |
| `<img>` | `image` |
| `<a>` (button-like) | `button` |
| `<section>`, `<div>` | `container` |
| `<ul>`, `<ol>` | `text-editor` (with list HTML) |
| `<video>` | `video` |
| `<form>` | `form` (basic structure) |

**Interface:**
```typescript
interface HtmlConverter {
  convert(html: string): Promise<ElementorElement[]>;
  convertFile(filePath: string): Promise<ElementorElement[]>;
}
```

### TemplatePreview

Serves a preview of templates in the browser.

**Responsibilities:**
- Convert Elementor elements back to displayable HTML
- Apply basic Elementor-like CSS styling
- Start HTTP server using Bun.serve
- Handle browser opening

**Interface:**
```typescript
interface TemplatePreview {
  start(template: Template, options: { port: number; open: boolean }): Promise<void>;
  stop(): Promise<void>;
}
```

---

## Template JSON Format

```json
{
  "name": "My Custom Template",
  "slug": "my-custom-template",
  "description": "Template description",
  "source": "project",
  "elements": [
    {
      "id": "abc12345",
      "elType": "container",
      "settings": {},
      "elements": [...]
    }
  ],
  "settings": {
    "background_background": "classic",
    "background_color": "#FFFFFF"
  },
  "sourcePageId": 42,
  "created_at": "2024-01-27T12:00:00Z",
  "updated_at": "2024-01-27T12:00:00Z"
}
```

---

## File Structure

```
src/
├── commands/
│   └── templates.ts         # Template command group
├── services/
│   ├── template-store.ts    # Custom template loading/saving
│   ├── html-converter.ts    # HTML to Elementor conversion
│   └── template-preview.ts  # Template preview server
└── types/
    └── template.ts          # Template type definitions
```

---

## Update: `pages create --template`

Modify the existing `pages create` command to check custom templates:

1. Check project templates (`.elementor-cli/templates/`)
2. Check global templates (`~/.elementor-cli/templates/`)
3. Fall back to built-in templates

---

## E2E Tests

### Test File: `tests/e2e/templates.test.ts`

```typescript
/**
 * E2E Tests: templates commands
 *
 * Tests for:
 * - templates list
 * - templates save
 * - templates import-html
 * - templates info
 * - templates preview
 * - templates delete
 * - templates export
 * - pages create --template (with custom templates)
 */
```

### Test Cases

#### `templates list`
- Lists built-in templates
- Lists custom templates (project and global)
- Filters by source (--source)
- JSON output format (--json)
- Shows template metadata (name, description, source)

#### `templates save`
- Saves page as project template
- Saves page as global template (--global)
- Requires --name option
- Fails for non-existent page
- Overwrites existing template with same name

#### `templates import-html`
- Converts simple HTML file
- Handles headings (h1-h6)
- Handles paragraphs and text
- Handles images
- Handles buttons/links
- Handles nested containers
- Preserves inline styles where possible
- Saves as project template by default
- Saves as global template with --global

#### `templates info`
- Shows template details
- Shows element count
- Shows source (built-in/global/project)
- Shows creation date
- Fails for non-existent template

#### `templates preview`
- Starts server and opens browser
- Renders template as HTML
- Applies basic styling
- Respects --port option
- Respects --no-open option

#### `templates delete`
- Deletes project template
- Deletes global template
- Fails for built-in templates
- Requires confirmation (unless --force)
- Fails for non-existent template

#### `templates export`
- Exports template to JSON file
- Uses template name as default filename
- Respects --output option
- Creates valid Elementor-compatible JSON

#### `pages create --template` (custom templates)
- Uses project template when available
- Falls back to global template
- Falls back to built-in template
- Shows template source in output

### Test Fixtures

Create test HTML files in `tests/e2e/fixtures/`:

```
tests/e2e/fixtures/
├── simple.html          # Basic heading + paragraph
├── hero-section.html    # Hero with image and CTA button
├── features-grid.html   # Multiple sections with icons
└── contact-form.html    # Form elements
```

Example `simple.html`:
```html
<!DOCTYPE html>
<html>
<head><title>Simple Page</title></head>
<body>
  <section>
    <h1>Welcome to My Site</h1>
    <p>This is a simple paragraph with some text content.</p>
    <a href="#" class="button">Get Started</a>
  </section>
</body>
</html>
```

### Test Setup Additions

Add to `tests/e2e/setup.ts`:
- Helper to create temp template directories
- Helper to clean up template directories
- Helper to create test HTML files

---

## Manual Testing Checklist

- [ ] `templates list` shows built-in and custom templates
- [ ] `templates save` saves page as reusable template
- [ ] `templates import-html` converts HTML to template
- [ ] `templates info` displays template details
- [ ] `templates preview` renders template in browser
- [ ] `templates delete` removes custom template
- [ ] `templates export` exports template to JSON file
- [ ] `pages create --template` works with custom templates
- [ ] Project templates take precedence over global
- [ ] Global templates take precedence over built-in
- [ ] Invalid templates are rejected with clear error messages
