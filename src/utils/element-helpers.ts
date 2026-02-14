import type { ElementorElement } from "../types/elementor.js";

/**
 * Recursively counts all elements in an Elementor element tree.
 */
export function countElements(elements: ElementorElement[] | unknown[]): number {
  let count = 0;
  for (const el of elements) {
    count++;
    const element = el as { elements?: unknown[] };
    if (element.elements && element.elements.length > 0) {
      count += countElements(element.elements);
    }
  }
  return count;
}

/**
 * Extracts all URLs from an arbitrary data structure (recursively).
 * Returns just the URL strings.
 */
export function extractUrls(data: unknown): string[] {
  const urls: string[] = [];

  if (typeof data === "string") {
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    const matches = data.match(urlRegex);
    if (matches) {
      urls.push(...matches);
    }
  } else if (Array.isArray(data)) {
    for (const item of data) {
      urls.push(...extractUrls(item));
    }
  } else if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      urls.push(...extractUrls(value));
    }
  }

  return urls;
}

/**
 * Extracts all URLs from an arbitrary data structure with location tracking.
 * Returns objects containing both the URL and where it was found.
 */
export function extractUrlsWithLocation(
  data: unknown,
  path: string = ""
): Array<{ location: string; url: string }> {
  const urls: Array<{ location: string; url: string }> = [];

  if (typeof data === "string") {
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    const matches = data.match(urlRegex);
    if (matches) {
      for (const url of matches) {
        urls.push({ location: path, url });
      }
    }
  } else if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      urls.push(...extractUrlsWithLocation(data[i], `${path}[${i}]`));
    }
  } else if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      urls.push(...extractUrlsWithLocation(value, path ? `${path}.${key}` : key));
    }
  }

  return urls;
}

/**
 * Parses the host from a URL string.
 * Returns empty string if URL is invalid.
 */
export function parseHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return "";
  }
}

/**
 * Builds a human-readable path for an Elementor element.
 */
export function buildElementPath(element: ElementorElement): string {
  const type = element.elType;
  const widgetType = element.widgetType;
  if (widgetType) {
    return `widget[${widgetType}]`;
  }
  return `${type}[${element.id.slice(0, 7)}]`;
}

/**
 * Extracts all URLs from Elementor elements with full element path context.
 */
export function extractUrlsFromElements(
  elements: ElementorElement[],
  parentPath: string = ""
): Array<{ location: string; url: string }> {
  const urls: Array<{ location: string; url: string }> = [];

  for (const element of elements) {
    const elementPath = parentPath
      ? `${parentPath} > ${buildElementPath(element)}`
      : buildElementPath(element);

    // Extract URLs from settings
    const settingsUrls = extractUrlsWithLocation(element.settings, "");
    for (const { location, url } of settingsUrls) {
      urls.push({
        location: location ? `${elementPath}.${location}` : elementPath,
        url,
      });
    }

    // Recurse into child elements
    if (element.elements && element.elements.length > 0) {
      urls.push(...extractUrlsFromElements(element.elements, elementPath));
    }
  }

  return urls;
}
