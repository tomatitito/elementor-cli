import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { TemplateSchema, type Template, type TemplateSource, type TemplateFile } from "../types/template.js";
import { templates as builtInTemplates, type PageTemplate } from "./template-library.js";

// Support override via environment variable for testing
const GLOBAL_TEMPLATES_DIR = process.env.ELEMENTOR_CLI_GLOBAL_TEMPLATES || `${homedir()}/.elementor-cli/templates`;
const PROJECT_TEMPLATES_DIR = ".elementor-cli/templates";

/**
 * Generate a slug from a template name
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generate a unique element ID (7 character alphanumeric)
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Regenerate all element IDs in an elements tree
 */
function regenerateIds(elements: Template["elements"]): void {
  for (const el of elements) {
    el.id = generateId();
    if (el.elements && el.elements.length > 0) {
      regenerateIds(el.elements);
    }
  }
}

/**
 * TemplateStore manages loading, saving, and merging templates from multiple sources.
 *
 * Precedence (highest to lowest):
 * 1. Project templates (.elementor-cli/templates/)
 * 2. Global templates (~/.elementor-cli/templates/)
 * 3. Built-in templates
 */
export class TemplateStore {
  private projectDir: string;
  private globalDir: string;

  constructor(projectDir?: string, globalDir?: string) {
    this.projectDir = projectDir || `${process.cwd()}/${PROJECT_TEMPLATES_DIR}`;
    this.globalDir = globalDir || GLOBAL_TEMPLATES_DIR;
  }

  /**
   * List all templates from all sources, with proper precedence
   */
  async listAll(): Promise<Template[]> {
    const [builtIn, global, project] = await Promise.all([
      this.listBuiltIn(),
      this.listFromDir(this.globalDir, "global"),
      this.listFromDir(this.projectDir, "project"),
    ]);

    // Merge with precedence: project > global > built-in
    const bySlug = new Map<string, Template>();

    for (const template of builtIn) {
      bySlug.set(template.slug, template);
    }
    for (const template of global) {
      bySlug.set(template.slug, template);
    }
    for (const template of project) {
      bySlug.set(template.slug, template);
    }

    return Array.from(bySlug.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * List templates by source
   */
  async listBySource(source: TemplateSource): Promise<Template[]> {
    switch (source) {
      case "built-in":
        return this.listBuiltIn();
      case "global":
        return this.listFromDir(this.globalDir, "global");
      case "project":
        return this.listFromDir(this.projectDir, "project");
    }
  }

  /**
   * List custom templates (global + project)
   */
  async listCustom(): Promise<Template[]> {
    const [global, project] = await Promise.all([
      this.listFromDir(this.globalDir, "global"),
      this.listFromDir(this.projectDir, "project"),
    ]);
    return [...global, ...project].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get a template by name or slug
   */
  async get(nameOrSlug: string): Promise<Template | null> {
    const slug = slugify(nameOrSlug);

    // Check project first (highest precedence)
    const project = await this.loadFromDir(this.projectDir, slug, "project");
    if (project) return project;

    // Check global
    const global = await this.loadFromDir(this.globalDir, slug, "global");
    if (global) return global;

    // Check built-in
    const builtIn = builtInTemplates[slug];
    if (builtIn) {
      return this.builtInToTemplate(slug, builtIn);
    }

    // Also try the exact name match for built-in templates
    const builtInByName = builtInTemplates[nameOrSlug];
    if (builtInByName) {
      return this.builtInToTemplate(nameOrSlug, builtInByName);
    }

    return null;
  }

  /**
   * Get a template with fresh IDs (prevents ID conflicts when creating pages)
   */
  async getWithFreshIds(nameOrSlug: string): Promise<Template | null> {
    const template = await this.get(nameOrSlug);
    if (!template) return null;

    // Deep clone and regenerate IDs
    const cloned = JSON.parse(JSON.stringify(template)) as Template;
    regenerateIds(cloned.elements);
    return cloned;
  }

  /**
   * Save a template
   */
  async save(template: TemplateFile, global: boolean): Promise<void> {
    const dir = global ? this.globalDir : this.projectDir;
    await mkdir(dir, { recursive: true });

    const slug = slugify(template.name);
    const now = new Date().toISOString();
    const source: TemplateSource = global ? "global" : "project";

    const fileData: TemplateFile = {
      name: template.name,
      slug,
      description: template.description || "",
      source,
      elements: template.elements,
      settings: template.settings || {},
      sourcePageId: template.sourcePageId,
      created_at: template.created_at || now,
      updated_at: now,
    };

    await Bun.write(
      `${dir}/${slug}.json`,
      JSON.stringify(fileData, null, 2)
    );
  }

  /**
   * Delete a template (only custom templates can be deleted)
   */
  async delete(nameOrSlug: string): Promise<{ deleted: boolean; source?: TemplateSource }> {
    const slug = slugify(nameOrSlug);

    // Check project first
    const projectFile = Bun.file(`${this.projectDir}/${slug}.json`);
    if (await projectFile.exists()) {
      const { rm } = await import("node:fs/promises");
      await rm(`${this.projectDir}/${slug}.json`);
      return { deleted: true, source: "project" };
    }

    // Check global
    const globalFile = Bun.file(`${this.globalDir}/${slug}.json`);
    if (await globalFile.exists()) {
      const { rm } = await import("node:fs/promises");
      await rm(`${this.globalDir}/${slug}.json`);
      return { deleted: true, source: "global" };
    }

    // Check if it's a built-in (can't delete)
    if (builtInTemplates[slug] || builtInTemplates[nameOrSlug]) {
      throw new Error("Cannot delete built-in templates");
    }

    return { deleted: false };
  }

  /**
   * Check if a template exists
   */
  async exists(nameOrSlug: string): Promise<boolean> {
    const template = await this.get(nameOrSlug);
    return template !== null;
  }

  /**
   * Get the source of a template
   */
  async getSource(nameOrSlug: string): Promise<TemplateSource | null> {
    const slug = slugify(nameOrSlug);

    // Check project first
    const projectFile = Bun.file(`${this.projectDir}/${slug}.json`);
    if (await projectFile.exists()) return "project";

    // Check global
    const globalFile = Bun.file(`${this.globalDir}/${slug}.json`);
    if (await globalFile.exists()) return "global";

    // Check built-in
    if (builtInTemplates[slug] || builtInTemplates[nameOrSlug]) {
      return "built-in";
    }

    return null;
  }

  private listBuiltIn(): Template[] {
    return Object.entries(builtInTemplates).map(([key, template]) =>
      this.builtInToTemplate(key, template)
    );
  }

  private builtInToTemplate(key: string, template: PageTemplate): Template {
    return {
      name: template.name,
      slug: key,
      description: template.description,
      source: "built-in" as const,
      elements: template.elements,
      settings: template.settings || {},
    };
  }

  private async listFromDir(dir: string, source: TemplateSource): Promise<Template[]> {
    const templates: Template[] = [];

    try {
      const glob = new Bun.Glob("*.json");
      for await (const file of glob.scan({ cwd: dir })) {
        const template = await this.loadTemplateFile(`${dir}/${file}`, source);
        if (template) {
          templates.push(template);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return templates;
  }

  private async loadFromDir(dir: string, slug: string, source: TemplateSource): Promise<Template | null> {
    const file = Bun.file(`${dir}/${slug}.json`);
    if (!(await file.exists())) return null;
    return this.loadTemplateFile(`${dir}/${slug}.json`, source);
  }

  private async loadTemplateFile(path: string, source: TemplateSource): Promise<Template | null> {
    try {
      const file = Bun.file(path);
      const data = await file.json();

      // Add source to the data
      const withSource = { ...data, source };

      // Validate with schema
      const parsed = TemplateSchema.safeParse(withSource);
      if (!parsed.success) {
        console.error(`Invalid template file ${path}:`, parsed.error);
        return null;
      }

      return parsed.data;
    } catch (error) {
      console.error(`Error loading template ${path}:`, error);
      return null;
    }
  }
}
