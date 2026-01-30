import { z } from "zod";
import type { ElementorElement, PageSettings } from "./elementor.js";

export type TemplateSource = "built-in" | "global" | "project";

export const TemplateSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional().default(""),
  source: z.enum(["built-in", "global", "project"]),
  elements: z.array(z.any()), // ElementorElement[]
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
