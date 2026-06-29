import type { ParseResult, RenderedHtmlBundle, SnapshotResult } from "./types";

const REMOVED_ELEMENTS = new Set([
  "script",
  "noscript",
  "iframe",
  "object",
  "embed",
  "base",
  "meta"
]);

const RESOURCE_ATTRIBUTES = new Set([
  "src",
  "srcset",
  "poster",
  "preload",
  "ping",
  "formaction"
]);

const TEST_ID_ATTRIBUTES = ["data-testid", "data-cy", "data-qa", "data-test"];
const SENSITIVE_VALUE_PATTERN = /(password|token|secret|api[-_]?key|auth|session|csrf|credential)/i;

export function parseWorkbenchInput(rawValue: string): ParseResult {
  const value = rawValue.trim();

  if (!value) {
    return { ok: false, message: "Paste HTML or a rendered HTML bundle to begin." };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, message: "Bundle JSON must be an object with an html string." };
    }

    const bundle = parsed as Record<string, unknown>;
    if (typeof bundle.html !== "string" || !bundle.html.trim()) {
      return { ok: false, message: "Bundle JSON is missing a non-empty html string." };
    }

    return {
      ok: true,
      source: {
        kind: "bundle",
        html: bundle.html,
        metadata: {
          url: typeof bundle.url === "string" ? bundle.url : undefined,
          title: typeof bundle.title === "string" ? bundle.title : undefined,
          capturedAt: typeof bundle.capturedAt === "string" ? bundle.capturedAt : undefined,
          viewport: isViewport(bundle.viewport) ? bundle.viewport : undefined,
          ingestion: isIngestionMetadata(bundle.ingestion) ? bundle.ingestion : undefined
        }
      }
    };
  } catch {
    return {
      ok: true,
      source: {
        kind: "html",
        html: value
      }
    };
  }
}

export function createPageSnapshot(html: string): SnapshotResult {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const warnings = new Set<string>();

  removeDangerousElements(document, warnings);
  sanitizeElements(document, warnings);
  assignLocatorIds(document);
  injectPreviewStyles(document);

  const title = document.title.trim() || undefined;
  return {
    html: "<!doctype html>\n" + document.documentElement.outerHTML,
    title,
    warnings: Array.from(warnings)
  };
}

export function documentFromSnapshot(snapshotHtml: string): Document {
  return new DOMParser().parseFromString(snapshotHtml, "text/html");
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function isViewport(value: unknown): value is { width?: number; height?: number } {
  if (!value || typeof value !== "object") return false;
  const viewport = value as Record<string, unknown>;
  return (
    (viewport.width === undefined || typeof viewport.width === "number") &&
    (viewport.height === undefined || typeof viewport.height === "number")
  );
}

function isIngestionMetadata(value: unknown): value is NonNullable<RenderedHtmlBundle["ingestion"]> {
  if (!value || typeof value !== "object") return false;
  const ingestion = value as Record<string, unknown>;
  return (
    (ingestion.mode === "source-html" || ingestion.mode === "rendered-dom") &&
    typeof ingestion.stylesheetsInlined === "number" &&
    typeof ingestion.stylesheetsSkipped === "number" &&
    typeof ingestion.scriptsDetected === "number" &&
    Array.isArray(ingestion.warnings) &&
    ingestion.warnings.every((warning) => typeof warning === "string")
  );
}

function removeDangerousElements(document: Document, warnings: Set<string>) {
  for (const element of Array.from(document.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();
    const shouldRemove =
      REMOVED_ELEMENTS.has(tagName) &&
      (tagName !== "meta" || isMetaRefresh(element as HTMLMetaElement));

    if (tagName === "link" && isExternalStylesheet(element as HTMLLinkElement)) {
      element.remove();
      warnings.add("Removed external stylesheet links.");
      continue;
    }

    if (shouldRemove) {
      element.remove();
      warnings.add("Removed executable, embedded, or redirecting content.");
    }
  }
}

function sanitizeElements(document: Document, warnings: Set<string>) {
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        warnings.add("Removed executable event handler attributes.");
        continue;
      }

      if (RESOURCE_ATTRIBUTES.has(name)) {
        element.removeAttribute(attribute.name);
        warnings.add("Removed external resource references.");
        continue;
      }

      if (name === "href" && !isSafeHref(value)) {
        element.removeAttribute(attribute.name);
        warnings.add("Removed executable link href values.");
        continue;
      }

      if (name === "style") {
        const cleaned = sanitizeCss(value);
        if (cleaned) {
          element.setAttribute("style", cleaned);
        } else {
          element.removeAttribute("style");
        }
      }
    }

    if (element instanceof HTMLStyleElement) {
      const cleaned = sanitizeCss(element.textContent ?? "");
      element.textContent = cleaned;
      if (!cleaned.trim()) {
        element.remove();
      }
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      sanitizeSensitiveValue(element, warnings);
    }
  }
}

function sanitizeSensitiveValue(element: HTMLInputElement | HTMLTextAreaElement, warnings: Set<string>) {
  const type = element instanceof HTMLInputElement ? element.type : "textarea";
  const sensitiveHint = [element.name, element.id, element.getAttribute("autocomplete") ?? "", type].join(" ");

  if (type === "password" || type === "hidden" || SENSITIVE_VALUE_PATTERN.test(sensitiveHint)) {
    if (element.hasAttribute("value")) {
      element.removeAttribute("value");
      warnings.add("Removed sensitive input values.");
    }
    if (element instanceof HTMLTextAreaElement && element.textContent) {
      element.textContent = "";
      warnings.add("Removed sensitive textarea content.");
    }
  }
}

function sanitizeCss(value: string): string {
  return value
    .replace(/@import[^;]+;?/gi, "")
    .replace(/url\(([^)]*)\)/gi, "")
    .replace(/javascript:/gi, "");
}

function assignLocatorIds(document: Document) {
  let index = 1;
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    element.setAttribute("data-locator-id", String(index));
    index += 1;
  }
}

function injectPreviewStyles(document: Document) {
  const style = document.createElement("style");
  style.setAttribute("data-locator-preview-style", "true");
  style.textContent = `
    [data-locator-selected="true"] {
      outline: 3px solid #0f766e !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 0 6px rgba(15, 118, 110, 0.18) !important;
    }
    [data-locator-hover="true"] {
      outline: 2px dashed #d97706 !important;
      outline-offset: 2px !important;
    }
  `;
  document.head.appendChild(style);
}

function isExternalStylesheet(element: HTMLLinkElement): boolean {
  const rel = (element.getAttribute("rel") ?? "").toLowerCase();
  return rel.includes("stylesheet") || rel.includes("preload") || rel.includes("icon");
}

function isMetaRefresh(element: HTMLMetaElement): boolean {
  const httpEquiv = (element.getAttribute("http-equiv") ?? "").toLowerCase();
  return httpEquiv === "refresh";
}

function isSafeHref(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return !trimmed.startsWith("javascript:") && !trimmed.startsWith("data:");
}

export function testIdAttributes() {
  return TEST_ID_ATTRIBUTES;
}
