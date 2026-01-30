import type { Template } from "../types/template.js";
import type { ElementorElement } from "../types/elementor.js";

/**
 * TemplatePreview - Serves a preview of templates in the browser
 */
export class TemplatePreview {
  private server: ReturnType<typeof Bun.serve> | null = null;

  /**
   * Start the preview server
   */
  async start(
    template: Template,
    options: { port: number; open: boolean }
  ): Promise<void> {
    const html = this.renderTemplate(template);

    this.server = Bun.serve({
      port: options.port,
      fetch: () => {
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      },
    });

    const url = `http://localhost:${options.port}`;
    console.log(`Preview server running at ${url}`);
    console.log("Press Ctrl+C to stop\n");

    if (options.open) {
      await this.openBrowser(url);
    }

    // Keep running until interrupted
    await new Promise(() => {});
  }

  /**
   * Stop the preview server
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  /**
   * Open URL in the default browser
   */
  private async openBrowser(url: string): Promise<void> {
    const { platform } = process;
    let command: string;

    if (platform === "darwin") {
      command = "open";
    } else if (platform === "win32") {
      command = "start";
    } else {
      command = "xdg-open";
    }

    try {
      Bun.spawn([command, url], { stdout: "ignore", stderr: "ignore" });
    } catch {
      // Ignore errors if browser can't be opened
    }
  }

  /**
   * Render template to HTML
   */
  private renderTemplate(template: Template): string {
    const elementsHtml = this.renderElements(template.elements);
    const css = this.getPreviewStyles();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${template.name} - Preview</title>
  <style>${css}</style>
</head>
<body>
  <div class="preview-header">
    <span class="preview-badge">Preview</span>
    <span class="preview-title">${template.name}</span>
    ${template.description ? `<span class="preview-desc">${template.description}</span>` : ""}
  </div>
  <div class="elementor-preview">
    ${elementsHtml}
  </div>
</body>
</html>`;
  }

  /**
   * Render Elementor elements to HTML
   */
  private renderElements(elements: ElementorElement[]): string {
    return elements.map((el) => this.renderElement(el)).join("\n");
  }

  /**
   * Render a single Elementor element
   */
  private renderElement(element: ElementorElement): string {
    switch (element.elType) {
      case "container":
        return this.renderContainer(element);
      case "section":
        return this.renderSection(element);
      case "column":
        return this.renderColumn(element);
      case "widget":
        return this.renderWidget(element);
      default:
        return "";
    }
  }

  private renderContainer(element: ElementorElement): string {
    const settings = element.settings || {};
    const styles = this.getContainerStyles(settings);
    const children = this.renderElements(element.elements || []);
    const isInner = element.isInner ? " elementor-inner" : "";

    return `<div class="elementor-container${isInner}" style="${styles}">${children}</div>`;
  }

  private renderSection(element: ElementorElement): string {
    const children = this.renderElements(element.elements || []);
    return `<section class="elementor-section">${children}</section>`;
  }

  private renderColumn(element: ElementorElement): string {
    const children = this.renderElements(element.elements || []);
    return `<div class="elementor-column">${children}</div>`;
  }

  private renderWidget(element: ElementorElement): string {
    const { widgetType, settings } = element;

    switch (widgetType) {
      case "heading":
        return this.renderHeading(settings);
      case "text-editor":
        return this.renderTextEditor(settings);
      case "image":
        return this.renderImage(settings);
      case "button":
        return this.renderButton(settings);
      case "icon":
        return this.renderIcon(settings);
      case "icon-box":
        return this.renderIconBox(settings);
      case "video":
        return this.renderVideo(settings);
      default:
        return `<div class="elementor-widget elementor-widget-${widgetType}">[${widgetType} widget]</div>`;
    }
  }

  private renderHeading(settings: Record<string, unknown>): string {
    const title = (settings.title as string) || "";
    const size = (settings.header_size as string) || "h2";
    const align = (settings.align as string) || "";
    const color = (settings.title_color as string) || "";

    let style = "";
    if (align) style += `text-align: ${align};`;
    if (color) style += `color: ${color};`;

    return `<${size} class="elementor-heading" style="${style}">${title}</${size}>`;
  }

  private renderTextEditor(settings: Record<string, unknown>): string {
    const content = (settings.editor as string) || "";
    return `<div class="elementor-text-editor">${content}</div>`;
  }

  private renderImage(settings: Record<string, unknown>): string {
    const image = settings.image as { url?: string; alt?: string } | undefined;
    if (!image?.url) return "";

    return `<div class="elementor-image"><img src="${image.url}" alt="${image.alt || ""}" /></div>`;
  }

  private renderButton(settings: Record<string, unknown>): string {
    const text = (settings.text as string) || "Button";
    const link = settings.link as { url?: string } | undefined;
    const href = link?.url || "#";
    const bgColor = (settings.background_color as string) || "";
    const textColor = (settings.button_text_color as string) || "";
    const align = (settings.align as string) || "";

    let style = "";
    if (bgColor) style += `background-color: ${bgColor};`;
    if (textColor) style += `color: ${textColor};`;

    let wrapperStyle = "";
    if (align) wrapperStyle = `text-align: ${align};`;

    return `<div class="elementor-button-wrapper" style="${wrapperStyle}"><a href="${href}" class="elementor-button" style="${style}">${text}</a></div>`;
  }

  private renderIcon(settings: Record<string, unknown>): string {
    const icon = settings.icon as { value?: string } | undefined;
    const color = (settings.primary_color as string) || "";
    const iconValue = icon?.value || "fas fa-star";

    let style = "";
    if (color) style += `color: ${color};`;

    return `<div class="elementor-icon" style="${style}"><i class="${iconValue}"></i></div>`;
  }

  private renderIconBox(settings: Record<string, unknown>): string {
    const title = (settings.title_text as string) || "";
    const description = (settings.description_text as string) || "";
    const icon = settings.icon as { value?: string } | undefined;
    const iconValue = icon?.value || "fas fa-star";

    return `<div class="elementor-icon-box">
      <div class="elementor-icon-box-icon"><i class="${iconValue}"></i></div>
      <div class="elementor-icon-box-content">
        <h4 class="elementor-icon-box-title">${title}</h4>
        <p class="elementor-icon-box-description">${description}</p>
      </div>
    </div>`;
  }

  private renderVideo(settings: Record<string, unknown>): string {
    const hostedUrl = settings.hosted_url as { url?: string } | undefined;
    const url = hostedUrl?.url || "";

    if (!url) return `<div class="elementor-video">[Video placeholder]</div>`;

    return `<div class="elementor-video"><video src="${url}" controls></video></div>`;
  }

  private getContainerStyles(settings: Record<string, unknown>): string {
    const styles: string[] = [];

    // Flex direction
    if (settings.flex_direction) {
      styles.push(`flex-direction: ${settings.flex_direction}`);
    }

    // Justify content
    if (settings.flex_justify_content) {
      styles.push(`justify-content: ${settings.flex_justify_content}`);
    }

    // Align items
    if (settings.flex_align_items) {
      styles.push(`align-items: ${settings.flex_align_items}`);
    }

    // Gap
    const gap = settings.flex_gap as { size?: number; unit?: string } | undefined;
    if (gap?.size) {
      styles.push(`gap: ${gap.size}${gap.unit || "px"}`);
    }

    // Min height
    const minHeight = settings.min_height as { size?: number; unit?: string } | undefined;
    if (minHeight?.size) {
      styles.push(`min-height: ${minHeight.size}${minHeight.unit || "px"}`);
    }

    // Width
    const width = settings.width as { size?: number; unit?: string } | undefined;
    if (width?.size) {
      styles.push(`width: ${width.size}${width.unit || "px"}`);
    }

    // Background
    if (settings.background_background === "classic" && settings.background_color) {
      styles.push(`background-color: ${settings.background_color}`);
    }

    // Padding
    const padding = settings.padding as { top?: string; right?: string; bottom?: string; left?: string; unit?: string } | undefined;
    if (padding) {
      const unit = padding.unit || "px";
      const top = padding.top || "0";
      const right = padding.right || "0";
      const bottom = padding.bottom || "0";
      const left = padding.left || "0";
      styles.push(`padding: ${top}${unit} ${right}${unit} ${bottom}${unit} ${left}${unit}`);
    }

    // Margin
    const margin = settings.margin as { top?: string; unit?: string } | undefined;
    if (margin?.top) {
      styles.push(`margin-top: ${margin.top}${margin.unit || "px"}`);
    }

    return styles.join("; ");
  }

  private getPreviewStyles(): string {
    return `
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: 1.5;
        color: #333;
      }
      .preview-header {
        background: #1a1a2e;
        color: white;
        padding: 10px 20px;
        display: flex;
        align-items: center;
        gap: 15px;
        position: sticky;
        top: 0;
        z-index: 1000;
      }
      .preview-badge {
        background: #e94560;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: bold;
        text-transform: uppercase;
      }
      .preview-title {
        font-weight: 600;
      }
      .preview-desc {
        opacity: 0.7;
        font-size: 14px;
      }
      .elementor-preview {
        max-width: 100%;
      }
      .elementor-container {
        display: flex;
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
      }
      .elementor-container.elementor-inner {
        max-width: none;
      }
      .elementor-section {
        width: 100%;
      }
      .elementor-column {
        flex: 1;
        padding: 10px;
      }
      .elementor-heading {
        margin: 0 0 15px 0;
      }
      .elementor-text-editor {
        margin-bottom: 15px;
      }
      .elementor-text-editor p {
        margin: 0 0 10px 0;
      }
      .elementor-image {
        margin-bottom: 15px;
      }
      .elementor-image img {
        max-width: 100%;
        height: auto;
        display: block;
      }
      .elementor-button-wrapper {
        margin-bottom: 15px;
      }
      .elementor-button {
        display: inline-block;
        padding: 12px 24px;
        background: #007bff;
        color: white;
        text-decoration: none;
        border-radius: 4px;
        font-weight: 500;
        transition: opacity 0.2s;
      }
      .elementor-button:hover {
        opacity: 0.9;
      }
      .elementor-icon {
        font-size: 48px;
        text-align: center;
        margin-bottom: 15px;
      }
      .elementor-icon-box {
        text-align: center;
        margin-bottom: 15px;
      }
      .elementor-icon-box-icon {
        font-size: 48px;
        margin-bottom: 10px;
        color: #007bff;
      }
      .elementor-icon-box-title {
        margin: 0 0 5px 0;
      }
      .elementor-icon-box-description {
        margin: 0;
        opacity: 0.8;
      }
      .elementor-video video {
        max-width: 100%;
      }
      .elementor-widget {
        margin-bottom: 15px;
        padding: 20px;
        background: #f5f5f5;
        border-radius: 4px;
        text-align: center;
        color: #666;
      }
    `;
  }
}
