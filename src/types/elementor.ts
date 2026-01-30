export type ElementType = "container" | "section" | "column" | "widget";

export interface ElementorElement {
  id: string;
  elType: ElementType;
  widgetType?: string;
  settings: Record<string, unknown>;
  elements: ElementorElement[];
  isInner?: boolean;
}

export interface PageSettings {
  [key: string]: unknown;
}

export type PageStatus = "publish" | "draft" | "private" | "pending" | "trash";

export interface PageData {
  id: number;
  title: string;
  slug: string;
  status: PageStatus;
  template?: string; // WordPress page template (e.g., "elementor_canvas", "elementor_header_footer")
  elementor_data: ElementorElement[];
  page_settings: PageSettings;
  pulled_at?: string;
  remote_modified?: string;
}

export interface LocalPageFiles {
  page: PageData;
  elements: ElementorElement[];
  settings: PageSettings;
  meta: {
    title: string;
    slug: string;
    status: PageStatus;
    template?: string;
  };
}
