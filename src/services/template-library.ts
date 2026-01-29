import type { ElementorElement, PageSettings } from "../types/elementor.js";

export interface PageTemplate {
  name: string;
  description: string;
  elements: ElementorElement[];
  settings: PageSettings;
}

/**
 * Generate a unique element ID (7 character alphanumeric)
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Built-in page templates for common layouts
 */
export const templates: Record<string, PageTemplate> = {
  blank: {
    name: "Blank",
    description: "Empty page with no content",
    elements: [],
    settings: {},
  },

  "hero-section": {
    name: "Hero Section",
    description: "Full-width hero with heading, text, and CTA button",
    elements: [
      {
        id: generateId(),
        elType: "container",
        settings: {
          content_width: "full",
          min_height: { size: 80, unit: "vh" },
          flex_direction: "column",
          flex_justify_content: "center",
          flex_align_items: "center",
          background_background: "classic",
          background_color: "#f8f9fa",
          padding: { top: "60", right: "30", bottom: "60", left: "30", unit: "px" },
        },
        elements: [
          {
            id: generateId(),
            elType: "widget",
            widgetType: "heading",
            settings: {
              title: "Welcome to Your Site",
              header_size: "h1",
              align: "center",
              title_color: "#333333",
              typography_typography: "custom",
              typography_font_size: { size: 48, unit: "px" },
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "widget",
            widgetType: "text-editor",
            settings: {
              editor:
                "<p style='text-align: center;'>Your compelling tagline or description goes here. Capture your visitors' attention with a brief, impactful message.</p>",
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "widget",
            widgetType: "button",
            settings: {
              text: "Get Started",
              align: "center",
              button_type: "primary",
              background_color: "#007bff",
              button_text_color: "#ffffff",
              border_radius: { size: 4, unit: "px" },
            },
            elements: [],
          },
        ],
      },
    ],
    settings: {
      hide_title: "yes",
    },
  },

  "two-column": {
    name: "Two Column",
    description: "Two-column layout with image and text",
    elements: [
      {
        id: generateId(),
        elType: "container",
        settings: {
          content_width: "boxed",
          flex_direction: "row",
          flex_gap: { size: 30, unit: "px" },
          padding: { top: "60", right: "30", bottom: "60", left: "30", unit: "px" },
        },
        elements: [
          {
            id: generateId(),
            elType: "container",
            settings: {
              flex_direction: "column",
              width: { size: 50, unit: "%" },
            },
            isInner: true,
            elements: [
              {
                id: generateId(),
                elType: "widget",
                widgetType: "image",
                settings: {
                  image: {
                    url: "https://via.placeholder.com/600x400",
                    id: "",
                  },
                  image_size: "full",
                },
                elements: [],
              },
            ],
          },
          {
            id: generateId(),
            elType: "container",
            settings: {
              flex_direction: "column",
              width: { size: 50, unit: "%" },
              flex_justify_content: "center",
            },
            isInner: true,
            elements: [
              {
                id: generateId(),
                elType: "widget",
                widgetType: "heading",
                settings: {
                  title: "Section Heading",
                  header_size: "h2",
                },
                elements: [],
              },
              {
                id: generateId(),
                elType: "widget",
                widgetType: "text-editor",
                settings: {
                  editor:
                    "<p>Add your content here. Describe your product, service, or feature. Keep it concise and focused on the value you provide to your visitors.</p>",
                },
                elements: [],
              },
            ],
          },
        ],
      },
    ],
    settings: {},
  },

  "three-column-features": {
    name: "Three Column Features",
    description: "Three-column grid for showcasing features or services",
    elements: [
      {
        id: generateId(),
        elType: "container",
        settings: {
          content_width: "boxed",
          flex_direction: "column",
          padding: { top: "60", right: "30", bottom: "60", left: "30", unit: "px" },
        },
        elements: [
          {
            id: generateId(),
            elType: "widget",
            widgetType: "heading",
            settings: {
              title: "Our Features",
              header_size: "h2",
              align: "center",
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "container",
            settings: {
              flex_direction: "row",
              flex_gap: { size: 30, unit: "px" },
              margin: { top: "30", unit: "px" },
            },
            isInner: true,
            elements: [
              createFeatureColumn("Feature One", "Description of your first feature or service."),
              createFeatureColumn("Feature Two", "Description of your second feature or service."),
              createFeatureColumn("Feature Three", "Description of your third feature or service."),
            ],
          },
        ],
      },
    ],
    settings: {},
  },

  "contact-form": {
    name: "Contact Section",
    description: "Contact information section with placeholder for form",
    elements: [
      {
        id: generateId(),
        elType: "container",
        settings: {
          content_width: "boxed",
          flex_direction: "column",
          flex_align_items: "center",
          background_background: "classic",
          background_color: "#f8f9fa",
          padding: { top: "60", right: "30", bottom: "60", left: "30", unit: "px" },
        },
        elements: [
          {
            id: generateId(),
            elType: "widget",
            widgetType: "heading",
            settings: {
              title: "Get in Touch",
              header_size: "h2",
              align: "center",
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "widget",
            widgetType: "text-editor",
            settings: {
              editor:
                "<p style='text-align: center;'>Have a question or want to work together? Reach out to us!</p>",
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "container",
            settings: {
              flex_direction: "row",
              flex_gap: { size: 40, unit: "px" },
              margin: { top: "30", unit: "px" },
            },
            isInner: true,
            elements: [
              {
                id: generateId(),
                elType: "widget",
                widgetType: "icon-box",
                settings: {
                  title_text: "Email",
                  description_text: "contact@example.com",
                  icon: { value: "fas fa-envelope", library: "fa-solid" },
                },
                elements: [],
              },
              {
                id: generateId(),
                elType: "widget",
                widgetType: "icon-box",
                settings: {
                  title_text: "Phone",
                  description_text: "+1 (555) 123-4567",
                  icon: { value: "fas fa-phone", library: "fa-solid" },
                },
                elements: [],
              },
              {
                id: generateId(),
                elType: "widget",
                widgetType: "icon-box",
                settings: {
                  title_text: "Location",
                  description_text: "123 Main Street, City",
                  icon: { value: "fas fa-map-marker-alt", library: "fa-solid" },
                },
                elements: [],
              },
            ],
          },
        ],
      },
    ],
    settings: {},
  },

  "landing-page": {
    name: "Landing Page",
    description: "Full landing page with hero, features, and CTA sections",
    elements: [
      // Hero Section
      {
        id: generateId(),
        elType: "container",
        settings: {
          content_width: "full",
          min_height: { size: 70, unit: "vh" },
          flex_direction: "column",
          flex_justify_content: "center",
          flex_align_items: "center",
          background_background: "classic",
          background_color: "#1a1a2e",
          padding: { top: "60", right: "30", bottom: "60", left: "30", unit: "px" },
        },
        elements: [
          {
            id: generateId(),
            elType: "widget",
            widgetType: "heading",
            settings: {
              title: "Build Something Amazing",
              header_size: "h1",
              align: "center",
              title_color: "#ffffff",
              typography_typography: "custom",
              typography_font_size: { size: 56, unit: "px" },
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "widget",
            widgetType: "text-editor",
            settings: {
              editor:
                "<p style='text-align: center; color: #cccccc; max-width: 600px; margin: 0 auto;'>The perfect solution for your needs. Start building your dream project today with our powerful tools and features.</p>",
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "container",
            settings: {
              flex_direction: "row",
              flex_gap: { size: 20, unit: "px" },
              margin: { top: "30", unit: "px" },
            },
            isInner: true,
            elements: [
              {
                id: generateId(),
                elType: "widget",
                widgetType: "button",
                settings: {
                  text: "Get Started",
                  button_type: "primary",
                  background_color: "#e94560",
                  button_text_color: "#ffffff",
                },
                elements: [],
              },
              {
                id: generateId(),
                elType: "widget",
                widgetType: "button",
                settings: {
                  text: "Learn More",
                  button_type: "secondary",
                  background_color: "transparent",
                  button_text_color: "#ffffff",
                  border_border: "solid",
                  border_color: "#ffffff",
                },
                elements: [],
              },
            ],
          },
        ],
      },
      // Features Section
      {
        id: generateId(),
        elType: "container",
        settings: {
          content_width: "boxed",
          flex_direction: "column",
          padding: { top: "80", right: "30", bottom: "80", left: "30", unit: "px" },
        },
        elements: [
          {
            id: generateId(),
            elType: "widget",
            widgetType: "heading",
            settings: {
              title: "Why Choose Us",
              header_size: "h2",
              align: "center",
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "container",
            settings: {
              flex_direction: "row",
              flex_gap: { size: 30, unit: "px" },
              margin: { top: "40", unit: "px" },
            },
            isInner: true,
            elements: [
              createFeatureColumn("Fast & Reliable", "Lightning-fast performance you can count on."),
              createFeatureColumn("Easy to Use", "Intuitive interface designed for everyone."),
              createFeatureColumn("Secure", "Enterprise-grade security for your peace of mind."),
            ],
          },
        ],
      },
      // CTA Section
      {
        id: generateId(),
        elType: "container",
        settings: {
          content_width: "full",
          flex_direction: "column",
          flex_align_items: "center",
          background_background: "classic",
          background_color: "#e94560",
          padding: { top: "60", right: "30", bottom: "60", left: "30", unit: "px" },
        },
        elements: [
          {
            id: generateId(),
            elType: "widget",
            widgetType: "heading",
            settings: {
              title: "Ready to Get Started?",
              header_size: "h2",
              align: "center",
              title_color: "#ffffff",
            },
            elements: [],
          },
          {
            id: generateId(),
            elType: "widget",
            widgetType: "button",
            settings: {
              text: "Start Free Trial",
              align: "center",
              background_color: "#ffffff",
              button_text_color: "#e94560",
              margin: { top: "20", unit: "px" },
            },
            elements: [],
          },
        ],
      },
    ],
    settings: {
      hide_title: "yes",
    },
  },
};

/**
 * Helper to create a feature column for the three-column layout
 */
function createFeatureColumn(title: string, description: string): ElementorElement {
  return {
    id: generateId(),
    elType: "container",
    settings: {
      flex_direction: "column",
      flex_align_items: "center",
      width: { size: 33.33, unit: "%" },
      padding: { top: "20", right: "20", bottom: "20", left: "20", unit: "px" },
    },
    isInner: true,
    elements: [
      {
        id: generateId(),
        elType: "widget",
        widgetType: "icon",
        settings: {
          icon: { value: "fas fa-star", library: "fa-solid" },
          primary_color: "#007bff",
        },
        elements: [],
      },
      {
        id: generateId(),
        elType: "widget",
        widgetType: "heading",
        settings: {
          title: title,
          header_size: "h3",
          align: "center",
        },
        elements: [],
      },
      {
        id: generateId(),
        elType: "widget",
        widgetType: "text-editor",
        settings: {
          editor: `<p style='text-align: center;'>${description}</p>`,
        },
        elements: [],
      },
    ],
  };
}

/**
 * Get a template by name
 */
export function getTemplate(name: string): PageTemplate | undefined {
  return templates[name];
}

/**
 * List all available templates
 */
export function listTemplates(): Array<{ name: string; key: string; description: string }> {
  return Object.entries(templates).map(([key, template]) => ({
    key,
    name: template.name,
    description: template.description,
  }));
}

/**
 * Get template with fresh IDs (prevents ID conflicts when creating multiple pages)
 */
export function getTemplateWithFreshIds(name: string): PageTemplate | undefined {
  const template = templates[name];
  if (!template) return undefined;

  // Deep clone and regenerate all IDs
  const cloned = JSON.parse(JSON.stringify(template)) as PageTemplate;
  regenerateIds(cloned.elements);
  return cloned;
}

function regenerateIds(elements: ElementorElement[]): void {
  for (const el of elements) {
    el.id = generateId();
    if (el.elements && el.elements.length > 0) {
      regenerateIds(el.elements);
    }
  }
}
