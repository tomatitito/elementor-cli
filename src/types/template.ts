import { z } from "zod";
import type { ElementorElement, PageSettings } from "./elementor.js";

export type TemplateSource = "built-in" | "global" | "project";

// Zod schema for ElementorElement (recursive)
const ElementorElementBaseSchema = z.object({
  id: z.string(),
  elType: z.enum(["container", "section", "column", "widget"]),
  widgetType: z.string().optional(),
  settings: z.record(z.string(), z.unknown()),
  isInner: z.boolean().optional(),
});

export type ElementorElementSchema = z.infer<typeof ElementorElementBaseSchema> & {
  elements: ElementorElementSchema[];
};

export const ElementorElementSchema: z.ZodType<ElementorElementSchema> = ElementorElementBaseSchema.extend({
  elements: z.lazy(() => z.array(ElementorElementSchema)),
});

export const TemplateSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional().default(""),
  source: z.enum(["built-in", "global", "project"]),
  elements: z.array(ElementorElementSchema),
  settings: z.record(z.string(), z.unknown()).optional().default({}),
  sourcePageId: z.number().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type Template = z.infer<typeof TemplateSchema>;

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
