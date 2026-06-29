import type { RenderedHtmlBundle } from "./types";

const MAX_HTML_BYTES = 1_500_000;
const MAX_STYLESHEET_BYTES = 500_000;
const MAX_STYLESHEETS = 8;
const FETCH_TIMEOUT_MS = 12_000;
const RENDER_TIMEOUT_MS = 18_000;
const RENDER_SETTLE_MS = 1_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type StylesheetInliningResult = {
  html: string;
  inlined: number;
  skipped: number;
};
type RenderedPage = {
  html: string;
  url: string;
  title?: string;
  viewport?: {
    width?: number;
    height?: number;
  };
};
type RenderPage = (url: string) => Promise<RenderedPage>;
type IngestUrlOptions = {
  fetchLike?: FetchLike;
  renderPage?: RenderPage;
};

export type UrlIngestionResult =
  | { ok: true; bundle: RenderedHtmlBundle }
  | { ok: false; status: number; message: string };

export async function ingestUrl(
  rawUrl: string,
  optionsOrFetchLike: IngestUrlOptions | FetchLike = {}
): Promise<UrlIngestionResult> {
  const fetchLike = typeof optionsOrFetchLike === "function" ? optionsOrFetchLike : (optionsOrFetchLike.fetchLike ?? fetch);
  const renderPage = typeof optionsOrFetchLike === "function" ? renderUrlWithBrowser : (optionsOrFetchLike.renderPage ?? renderUrlWithBrowser);
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) {
    return { ok: false, status: 400, message: "Enter a valid http or https URL." };
  }

  try {
    const rendered = await renderPage(normalized);
    if (byteLength(rendered.html) > MAX_HTML_BYTES) {
      return { ok: false, status: 413, message: "Fetched page is too large for the workbench." };
    }

    if (!rendered.html.trim()) {
      return { ok: false, status: 422, message: "Fetched page was empty." };
    }

    const stylesheetResult = await inlineStylesheets(rendered.html, rendered.url || normalized, fetchLike);
    const scriptsDetected = countExecutableScripts(rendered.html);

    return {
      ok: true,
      bundle: {
        html: stylesheetResult.html,
        url: rendered.url || normalized,
        title: rendered.title ?? extractTitle(stylesheetResult.html),
        capturedAt: new Date().toISOString(),
        viewport: rendered.viewport,
        ingestion: {
          mode: "rendered-dom",
          stylesheetsInlined: stylesheetResult.inlined,
          stylesheetsSkipped: stylesheetResult.skipped,
          scriptsDetected,
          warnings: ingestionWarnings(stylesheetResult, scriptsDetected)
        }
      }
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      message: aborted ? "URL render timed out." : renderErrorMessage(error)
    };
  }
}

export function normalizeHttpUrl(rawUrl: string): string | null {
  const value = rawUrl.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function inlineStylesheets(
  html: string,
  pageUrl: string,
  fetchLike: FetchLike = fetch
): Promise<StylesheetInliningResult> {
  const links = findStylesheetLinks(html).slice(0, MAX_STYLESHEETS);
  if (!links.length) return { html, inlined: 0, skipped: 0 };

  let nextHtml = html;
  let totalCssBytes = 0;
  let inlined = 0;
  let skipped = 0;

  for (const link of links) {
    const stylesheetUrl = resolveStylesheetUrl(link.href, pageUrl);
    if (!stylesheetUrl) {
      skipped += 1;
      continue;
    }

    try {
      const response = await fetchLike(stylesheetUrl, {
        redirect: "follow",
        headers: {
          accept: "text/css,*/*;q=0.5",
          "user-agent": "LocatorWorkbench/0.1"
        }
      });
      if (!response.ok) {
        skipped += 1;
        continue;
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_STYLESHEET_BYTES) {
        skipped += 1;
        continue;
      }

      const css = await response.text();
      const cssBytes = byteLength(css);
      if (cssBytes > MAX_STYLESHEET_BYTES || totalCssBytes + cssBytes > MAX_STYLESHEET_BYTES) {
        skipped += 1;
        continue;
      }

      totalCssBytes += cssBytes;
      inlined += 1;
      nextHtml = nextHtml.replace(link.raw, `<style data-locator-ingested-css="${escapeAttribute(stylesheetUrl)}">\n${css}\n</style>`);
    } catch {
      skipped += 1;
    }
  }

  return { html: nextHtml, inlined, skipped };
}

export async function fetchSourceHtml(rawUrl: string, fetchLike: FetchLike = fetch): Promise<UrlIngestionResult> {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) {
    return { ok: false, status: 400, message: "Enter a valid http or https URL." };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchLike(normalized, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "LocatorWorkbench/0.1"
      }
    });

    if (!response.ok) {
      return { ok: false, status: response.status, message: `URL returned HTTP ${response.status}.` };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_HTML_BYTES) {
      return { ok: false, status: 413, message: "Fetched page is too large for the workbench." };
    }

    const fetchedHtml = await response.text();
    if (byteLength(fetchedHtml) > MAX_HTML_BYTES) {
      return { ok: false, status: 413, message: "Fetched page is too large for the workbench." };
    }

    const stylesheetResult = await inlineStylesheets(fetchedHtml, response.url || normalized, fetchLike);
    const scriptsDetected = countExecutableScripts(fetchedHtml);

    return {
      ok: true,
      bundle: {
        html: stylesheetResult.html,
        url: response.url || normalized,
        title: extractTitle(stylesheetResult.html),
        capturedAt: new Date().toISOString(),
        ingestion: {
          mode: "source-html",
          stylesheetsInlined: stylesheetResult.inlined,
          stylesheetsSkipped: stylesheetResult.skipped,
          scriptsDetected,
          warnings: sourceHtmlWarnings(stylesheetResult, scriptsDetected)
        }
      }
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      message: aborted ? "URL fetch timed out." : "Could not fetch that URL."
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function findStylesheetLinks(html: string): Array<{ raw: string; href: string }> {
  const links: Array<{ raw: string; href: string }> = [];
  const linkPattern = /<link\b[^>]*>/gi;

  for (const match of html.matchAll(linkPattern)) {
    const raw = match[0];
    const rel = attributeValue(raw, "rel");
    const href = attributeValue(raw, "href");
    if (!href || !rel?.toLowerCase().split(/\s+/).includes("stylesheet")) continue;
    links.push({ raw, href });
  }

  return links;
}

function resolveStylesheetUrl(href: string, pageUrl: string): string | null {
  try {
    const url = new URL(href, pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function attributeValue(tag: string, attribute: string): string | null {
  const pattern = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return undefined;
  const title = decodeEntities(match[1].replace(/\s+/g, " ").trim());
  return title || undefined;
}

function countExecutableScripts(html: string): number {
  return Array.from(html.matchAll(/<script\b/gi)).length;
}

function ingestionWarnings(stylesheets: StylesheetInliningResult, scriptsDetected: number): string[] {
  const warnings = ["URL capture executed page JavaScript in Chromium, then froze the rendered DOM for sandbox preview."];

  if (stylesheets.skipped > 0) {
    warnings.push(`${stylesheets.skipped} linked stylesheet${stylesheets.skipped === 1 ? "" : "s"} could not be inlined.`);
  }

  if (scriptsDetected > 0) {
    warnings.push(`${scriptsDetected} script tag${scriptsDetected === 1 ? "" : "s"} remain in captured HTML and will be stripped from the sandbox preview.`);
  }

  return warnings;
}

function sourceHtmlWarnings(stylesheets: StylesheetInliningResult, scriptsDetected: number): string[] {
  const warnings = ["Source HTML fallback does not execute page JavaScript."];
  if (stylesheets.skipped > 0) {
    warnings.push(`${stylesheets.skipped} linked stylesheet${stylesheets.skipped === 1 ? "" : "s"} could not be inlined.`);
  }
  if (scriptsDetected > 0) {
    warnings.push(`${scriptsDetected} script tag${scriptsDetected === 1 ? "" : "s"} detected and will not run in the snapshot preview.`);
  }
  return warnings;
}

async function renderUrlWithBrowser(url: string): Promise<RenderedPage> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const viewport = { width: 1440, height: 900 };
    const context = await browser.newContext({
      viewport,
      userAgent: "LocatorWorkbench/0.1"
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
    await page.waitForTimeout(RENDER_SETTLE_MS);

    return {
      html: await page.content(),
      url: page.url(),
      title: await page.title(),
      viewport
    };
  } finally {
    await browser.close();
  }
}

function renderErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Could not render that URL.";
  if (/Executable doesn't exist|browserType.launch/i.test(error.message)) {
    return "Could not start Chromium for rendered URL capture. Run `npx playwright install chromium` and try again.";
  }
  return `Could not render that URL: ${error.message}`;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
