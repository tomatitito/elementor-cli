export interface WPPage {
  id: number;
  date: string;
  date_gmt: string;
  modified: string;
  modified_gmt: string;
  slug: string;
  status: "publish" | "draft" | "private" | "pending" | "trash";
  title: {
    rendered: string;
    raw?: string;
  };
  content: {
    rendered: string;
    raw?: string;
    protected: boolean;
  };
  author: number;
  parent: number;
  menu_order: number;
  meta: {
    _elementor_data?: string;
    _elementor_page_settings?: string;
    _elementor_edit_mode?: string;
    [key: string]: unknown;
  };
  template?: string; // WordPress page template (e.g., "elementor_canvas", "elementor_header_footer")
  link: string;
}

export interface WPRevision {
  id: number;
  parent: number;
  date: string;
  author: number;
  modified: string;
  title: {
    rendered: string;
  };
  content: {
    rendered: string;
  };
  meta?: {
    _elementor_data?: string;
    _elementor_page_settings?: string;
    [key: string]: unknown;
  };
}

export interface WPUser {
  id: number;
  name: string;
  slug: string;
  link: string;
}

export interface WPError {
  code: string;
  message: string;
  data?: {
    status: number;
    [key: string]: unknown;
  };
}
