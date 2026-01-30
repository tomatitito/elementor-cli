import type { ElementorElement } from "../types/elementor.js";

/**
 * Generate a unique element ID (7 character alphanumeric)
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Simple HTML tag regex patterns
 */
const TAG_PATTERNS = {
  heading: /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
  paragraph: /<p([^>]*)>([\s\S]*?)<\/p>/gi,
  div: /<div([^>]*)>([\s\S]*?)<\/div>/gi,
  section: /<section([^>]*)>([\s\S]*?)<\/section>/gi,
  img: /<img([^>]*)>/gi,
  anchor: /<a([^>]*)>([\s\S]*?)<\/a>/gi,
  ul: /<ul([^>]*)>([\s\S]*?)<\/ul>/gi,
  ol: /<ol([^>]*)>([\s\S]*?)<\/ol>/gi,
  video: /<video([^>]*)>[\s\S]*?<\/video>/gi,
  form: /<form([^>]*)>([\s\S]*?)<\/form>/gi,
};

/**
 * Extract attribute value from attribute string
 */
function getAttribute(attrString: string, attrName: string): string | null {
  const regex = new RegExp(`${attrName}=["']([^"']*)["']`, "i");
  const match = attrString.match(regex);
  return match ? match[1] : null;
}

/**
 * Check if anchor looks like a button (has button-like classes)
 */
function isButtonLike(attrString: string): boolean {
  const className = getAttribute(attrString, "class") || "";
  const buttonKeywords = ["btn", "button", "cta", "action"];
  return buttonKeywords.some((kw) => className.toLowerCase().includes(kw));
}

/**
 * Strip HTML tags from content
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * Extract inline styles from style attribute
 */
function extractStyles(attrString: string): Record<string, string> {
  const styleAttr = getAttribute(attrString, "style") || "";
  const styles: Record<string, string> = {};

  if (styleAttr) {
    const pairs = styleAttr.split(";");
    for (const pair of pairs) {
      const [key, value] = pair.split(":").map((s) => s.trim());
      if (key && value) {
        styles[key] = value;
      }
    }
  }

  return styles;
}

/**
 * Convert HTML heading to Elementor heading widget
 */
function createHeading(level: number, content: string, attrs: string): ElementorElement {
  const text = stripTags(content);
  const styles = extractStyles(attrs);

  const settings: Record<string, unknown> = {
    title: text,
    header_size: `h${level}`,
  };

  // Map common styles
  if (styles["text-align"]) {
    settings.align = styles["text-align"];
  }
  if (styles.color) {
    settings.title_color = styles.color;
  }

  return {
    id: generateId(),
    elType: "widget",
    widgetType: "heading",
    settings,
    elements: [],
  };
}

/**
 * Convert HTML paragraph/text to Elementor text-editor widget
 */
function createTextEditor(html: string): ElementorElement {
  return {
    id: generateId(),
    elType: "widget",
    widgetType: "text-editor",
    settings: {
      editor: html.trim(),
    },
    elements: [],
  };
}

/**
 * Convert HTML image to Elementor image widget
 */
function createImage(attrs: string): ElementorElement {
  const src = getAttribute(attrs, "src") || "";
  const alt = getAttribute(attrs, "alt") || "";

  return {
    id: generateId(),
    elType: "widget",
    widgetType: "image",
    settings: {
      image: {
        url: src,
        id: "",
        alt,
      },
      image_size: "full",
    },
    elements: [],
  };
}

/**
 * Convert HTML anchor to Elementor button widget
 */
function createButton(attrs: string, content: string): ElementorElement {
  const href = getAttribute(attrs, "href") || "#";
  const text = stripTags(content);

  return {
    id: generateId(),
    elType: "widget",
    widgetType: "button",
    settings: {
      text,
      link: {
        url: href,
        is_external: href.startsWith("http"),
      },
    },
    elements: [],
  };
}

/**
 * Convert HTML list to Elementor text-editor widget (preserves list HTML)
 */
function createList(html: string): ElementorElement {
  return {
    id: generateId(),
    elType: "widget",
    widgetType: "text-editor",
    settings: {
      editor: html.trim(),
    },
    elements: [],
  };
}

/**
 * Convert HTML video to Elementor video widget
 */
function createVideo(attrs: string): ElementorElement {
  const src = getAttribute(attrs, "src") || "";
  const poster = getAttribute(attrs, "poster") || "";

  return {
    id: generateId(),
    elType: "widget",
    widgetType: "video",
    settings: {
      video_type: "hosted",
      hosted_url: {
        url: src,
      },
      image_overlay: poster
        ? {
            url: poster,
          }
        : undefined,
    },
    elements: [],
  };
}

/**
 * Create a container element
 */
function createContainer(elements: ElementorElement[], isInner = false): ElementorElement {
  return {
    id: generateId(),
    elType: "container",
    settings: {
      flex_direction: "column",
    },
    isInner,
    elements,
  };
}

/**
 * HtmlConverter - Converts HTML files to Elementor element structures
 */
export class HtmlConverter {
  /**
   * Convert HTML string to Elementor elements
   */
  convert(html: string): ElementorElement[] {
    // Extract body content if full HTML document
    let content = html;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      content = bodyMatch[1];
    }

    return this.parseContent(content);
  }

  /**
   * Convert HTML file to Elementor elements
   */
  async convertFile(filePath: string): Promise<ElementorElement[]> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${filePath}`);
    }

    const html = await file.text();
    return this.convert(html);
  }

  /**
   * Parse HTML content and convert to Elementor elements
   */
  private parseContent(html: string): ElementorElement[] {
    const elements: ElementorElement[] = [];
    let remaining = html;

    // Process sections first (they become containers)
    remaining = remaining.replace(TAG_PATTERNS.section, (match, attrs, content) => {
      const innerElements = this.parseContent(content);
      if (innerElements.length > 0) {
        elements.push(createContainer(innerElements));
      }
      return "";
    });

    // Process headings
    remaining = remaining.replace(TAG_PATTERNS.heading, (match, level, attrs, content) => {
      elements.push(createHeading(parseInt(level), content, attrs));
      return "";
    });

    // Process images
    remaining = remaining.replace(TAG_PATTERNS.img, (match, attrs) => {
      elements.push(createImage(attrs));
      return "";
    });

    // Process anchors (buttons if they look like buttons)
    remaining = remaining.replace(TAG_PATTERNS.anchor, (match, attrs, content) => {
      if (isButtonLike(attrs)) {
        elements.push(createButton(attrs, content));
      }
      // Non-button links are kept as part of text
      return isButtonLike(attrs) ? "" : match;
    });

    // Process lists
    remaining = remaining.replace(TAG_PATTERNS.ul, (match) => {
      elements.push(createList(match));
      return "";
    });

    remaining = remaining.replace(TAG_PATTERNS.ol, (match) => {
      elements.push(createList(match));
      return "";
    });

    // Process videos
    remaining = remaining.replace(TAG_PATTERNS.video, (match, attrs) => {
      elements.push(createVideo(attrs));
      return "";
    });

    // Process paragraphs
    remaining = remaining.replace(TAG_PATTERNS.paragraph, (match, attrs, content) => {
      const text = content.trim();
      if (text) {
        elements.push(createTextEditor(`<p${attrs}>${content}</p>`));
      }
      return "";
    });

    // Process divs with content (nested containers)
    remaining = remaining.replace(TAG_PATTERNS.div, (match, attrs, content) => {
      // Check if div has meaningful content
      const strippedContent = stripTags(content).trim();
      if (strippedContent) {
        // Try to parse inner content
        const innerElements = this.parseContent(content);
        if (innerElements.length > 0) {
          elements.push(createContainer(innerElements, true));
        } else if (strippedContent) {
          // Just text content
          elements.push(createTextEditor(`<div${attrs}>${content}</div>`));
        }
      }
      return "";
    });

    // Process any remaining text content
    const remainingText = remaining.replace(/<[^>]*>/g, "").trim();
    if (remainingText) {
      elements.push(createTextEditor(`<p>${remainingText}</p>`));
    }

    return elements;
  }
}
