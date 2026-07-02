import type { RenderedHtmlBundle } from "./types";
import type { Browser, Page } from "playwright-core";

const MAX_HTML_BYTES = 1_500_000;
const MAX_STYLESHEET_BYTES = 500_000;
const MAX_STYLESHEETS = 8;
const FETCH_TIMEOUT_MS = 12_000;
const RENDER_TIMEOUT_MS = 18_000;
const RENDER_SETTLE_MS = 1_000;
const OVERLAY_SETTLE_MS = 600;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type StylesheetInliningResult = {
  html: string;
  inlined: number;
  skipped: number;
};
type CaptureHtmlCompactionResult = {
  html: string;
  actions: string[];
};
type RenderedPage = {
  html: string;
  url: string;
  title?: string;
  overlayActions?: string[];
  viewport?: {
    width?: number;
    height?: number;
  };
};
type RenderPageOptions = {
  dismissOverlays: boolean;
};
type RenderPage = (url: string, options: RenderPageOptions) => Promise<RenderedPage>;
type CaptureMetrics = {
  visibleTextLength: number;
  visibleControlCount: number;
  bodyElementCount: number;
};
type IngestUrlOptions = {
  dismissOverlays?: boolean;
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
  const dismissOverlays = typeof optionsOrFetchLike === "function" ? true : (optionsOrFetchLike.dismissOverlays ?? true);
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) {
    return { ok: false, status: 400, message: "Enter a valid http or https URL." };
  }

  try {
    const rendered = await renderPage(normalized, { dismissOverlays });
    const scriptsDetected = countExecutableScripts(rendered.html);
    const compacted = compactRenderedHtml(rendered.html);
    const captureActions = [...(rendered.overlayActions ?? []), ...compacted.actions];

    if (byteLength(compacted.html) > MAX_HTML_BYTES) {
      return { ok: false, status: 413, message: "Fetched page is too large for the workbench." };
    }

    if (!compacted.html.trim()) {
      return { ok: false, status: 422, message: "Fetched page was empty." };
    }

    const stylesheetResult = await inlineStylesheets(compacted.html, rendered.url || normalized, fetchLike);
    if (byteLength(stylesheetResult.html) > MAX_HTML_BYTES) {
      return { ok: false, status: 413, message: "Fetched page is too large for the workbench after inlining stylesheets." };
    }

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
          overlayActions: captureActions,
          warnings: ingestionWarnings(stylesheetResult, scriptsDetected, captureActions)
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

function compactRenderedHtml(html: string): CaptureHtmlCompactionResult {
  let nextHtml = html;
  const actions: string[] = [];

  const replacements: Array<{ label: string; pattern: RegExp; replacement: string }> = [
    { label: "script tag", pattern: /<script\b[\s\S]*?<\/script>/gi, replacement: "" },
    { label: "noscript tag", pattern: /<noscript\b[\s\S]*?<\/noscript>/gi, replacement: "" },
    { label: "template tag", pattern: /<template\b[\s\S]*?<\/template>/gi, replacement: "" },
    { label: "HTML comment", pattern: /<!--[\s\S]*?-->/g, replacement: "" },
    {
      label: "preload link",
      pattern: /<link\b(?=[^>]*\brel\s*=\s*(?:"[^"]*(?:preload|prefetch|modulepreload|preconnect|dns-prefetch|icon)[^"]*"|'[^']*(?:preload|prefetch|modulepreload|preconnect|dns-prefetch|icon)[^']*'|[^\s>]*(?:preload|prefetch|modulepreload|preconnect|dns-prefetch|icon)[^\s>]*))[^>]*>/gi,
      replacement: ""
    }
  ];

  for (const { label, pattern, replacement } of replacements) {
    let count = 0;
    nextHtml = nextHtml.replace(pattern, () => {
      count += 1;
      return replacement;
    });
    if (count > 0) actions.push(`Removed ${count} ${label}${count === 1 ? "" : "s"} from captured HTML`);
  }

  let dataResourceCount = 0;
  nextHtml = nextHtml.replace(
    /\s(src|srcset|poster)\s*=\s*("data:[^"]{1024,}"|'data:[^']{1024,}'|data:[^\s>]{1024,})/gi,
    () => {
      dataResourceCount += 1;
      return "";
    }
  );
  if (dataResourceCount > 0) {
    actions.push(`Removed ${dataResourceCount} large data resource attribute${dataResourceCount === 1 ? "" : "s"} from captured HTML`);
  }

  return { html: nextHtml, actions };
}

function ingestionWarnings(stylesheets: StylesheetInliningResult, scriptsDetected: number, overlayActions: string[] = []): string[] {
  const warnings = ["URL capture executed page JavaScript in Chromium, then froze the rendered DOM for sandbox preview."];

  if (stylesheets.skipped > 0) {
    warnings.push(`${stylesheets.skipped} linked stylesheet${stylesheets.skipped === 1 ? "" : "s"} could not be inlined.`);
  }

  if (scriptsDetected > 0) {
    warnings.push(`${scriptsDetected} script tag${scriptsDetected === 1 ? "" : "s"} executed during capture and were removed before sandbox preview.`);
  }

  if (overlayActions.length > 0) {
    warnings.push(`Capture applied ${overlayActions.length} cleanup action${overlayActions.length === 1 ? "" : "s"} before freezing the DOM.`);
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

async function renderUrlWithBrowser(url: string, options: RenderPageOptions): Promise<RenderedPage> {
  const browser = await launchChromium();

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
    const beforeCleanup = {
      html: await page.content(),
      url: page.url(),
      title: await page.title(),
      metrics: await captureMetrics(page)
    };
    const overlayActions = options.dismissOverlays ? await dismissBlockingOverlays(page) : [];
    const afterCleanupMetrics = options.dismissOverlays && overlayActions.length ? await captureMetrics(page) : beforeCleanup.metrics;

    if (options.dismissOverlays && overlayActions.length && cleanupBlankedPage(beforeCleanup.metrics, afterCleanupMetrics)) {
      return {
        html: beforeCleanup.html,
        url: beforeCleanup.url,
        title: beforeCleanup.title,
        overlayActions: ["Skipped overlay cleanup because it hid most visible page content."],
        viewport
      };
    }

    await page.evaluate(() => {
      document.querySelectorAll("[data-locator-capture-action]").forEach((element) => {
        element.removeAttribute("data-locator-capture-action");
      });
    }).catch(() => undefined);

    return {
      html: await page.content(),
      url: page.url(),
      title: await page.title(),
      overlayActions,
      viewport
    };
  } finally {
    await browser.close();
  }
}

async function captureMetrics(page: Page): Promise<CaptureMetrics> {
  return page.evaluate(() => {
    const visibleElements = Array.from(document.body.querySelectorAll<HTMLElement>("body *")).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") > 0.05;
    });
    const visibleText = visibleElements
      .map((element) => element.innerText || element.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const visibleControlCount = visibleElements.filter((element) => {
      return element.matches("button, a[href], input, textarea, select, [role='button'], [role='link'], [tabindex]");
    }).length;

    return {
      visibleTextLength: visibleText.length,
      visibleControlCount,
      bodyElementCount: document.body.querySelectorAll("*").length
    };
  }).catch(() => ({ visibleTextLength: 0, visibleControlCount: 0, bodyElementCount: 0 }));
}

function cleanupBlankedPage(before: CaptureMetrics, after: CaptureMetrics) {
  if (before.visibleTextLength < 40 && before.visibleControlCount < 1) return false;

  const lostMostText = after.visibleTextLength < Math.max(20, before.visibleTextLength * 0.25);
  const lostControls = before.visibleControlCount > 0 && after.visibleControlCount === 0;
  const lostDom = before.bodyElementCount > 10 && after.bodyElementCount < before.bodyElementCount * 0.25;

  return lostMostText || (lostControls && after.visibleTextLength < 40) || lostDom;
}

async function launchChromium(): Promise<Browser> {
  const { chromium: playwrightChromium } = await import("playwright-core");

  if (!isServerlessRuntime()) {
    return playwrightChromium.launch({ headless: true });
  }

  const chromium = (await import("@sparticuz/chromium")).default;
  return playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true
  });
}

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_REGION);
}

async function dismissBlockingOverlays(page: Page): Promise<string[]> {
  const actions: string[] = [];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const action = await page.evaluate((actionIndex) => {
      const dismissTextPattern =
        /(accept all|accept|agree|allow all|got it|close|dismiss|ยอมรับ|ปิด|รับทราบ|อนุญาต)/i;
      const genericDismissTextPattern = /^(ok|ตกลง)$/i;
      const overlayContextPattern = /(cookie|privacy|consent|modal|popup|newsletter|subscribe|notification|คุกกี้|ความเป็นส่วนตัว|นโยบาย)/i;
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          [
            "button",
            "a[href]",
            "input[type='button']",
            "input[type='submit']",
            "[role='button']",
            "[aria-label]"
          ].join(",")
        )
      );

      const visibleControls = controls
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const text = [
            element.innerText,
            element.textContent,
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.getAttribute("value")
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          return { element, rect, style, text };
        })
        .filter(({ rect, style }) => {
          return rect.width > 4 && rect.height > 4 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") > 0.05;
        });

      const ranked = visibleControls
        .map((item) => {
          const fixedAncestor = closestBlockingAncestor(item.element);
          const isDismissText = dismissTextPattern.test(item.text);
          const overlayContext = overlayContextText(item.element, fixedAncestor);
          const isGenericDismissText = genericDismissTextPattern.test(item.text.trim()) && overlayContextPattern.test(overlayContext);
          const rect = fixedAncestor?.getBoundingClientRect() ?? item.rect;
          const areaRatio = (rect.width * rect.height) / Math.max(1, window.innerWidth * window.innerHeight);
          let score = 0;
          if (isDismissText) score += 30;
          if (isGenericDismissText) score += 24;
          if (fixedAncestor) score += 20;
          if (areaRatio > 0.12) score += 10;
          if (/accept all|ยอมรับ/i.test(item.text)) score += 6;
          if (/close|dismiss|ปิด/i.test(item.text)) score += 4;
          return { ...item, score };
        })
        .filter((item) => item.score >= 30)
        .sort((a, b) => b.score - a.score || b.rect.width * b.rect.height - a.rect.width * a.rect.height);

      const target = ranked[0]?.element;
      if (!target) return null;
      const marker = `dismiss-${actionIndex}`;
      target.setAttribute("data-locator-capture-action", marker);
      return {
        marker,
        text: ranked[0].text.slice(0, 80) || target.tagName.toLowerCase()
      };

      function closestBlockingAncestor(element: HTMLElement): HTMLElement | null {
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          const rect = current.getBoundingClientRect();
          const style = window.getComputedStyle(current);
          const position = style.position;
          const areaRatio = (rect.width * rect.height) / Math.max(1, window.innerWidth * window.innerHeight);
          const blocksPage = (position === "fixed" || position === "sticky") && areaRatio > 0.08;
          const highLayer = Number(style.zIndex || "0") >= 10;
          if (blocksPage || highLayer) return current;
          current = current.parentElement;
        }
        return null;
      }

      function overlayContextText(element: HTMLElement, ancestor: HTMLElement | null): string {
        return [
          element.id,
          element.className,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          ancestor?.id,
          ancestor?.className,
          ancestor?.getAttribute("aria-label"),
          ancestor?.getAttribute("role"),
          ancestor?.textContent
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .slice(0, 1000);
      }
    }, attempt);

    if (!action) break;

    await page.locator(`[data-locator-capture-action="${action.marker}"]`).click({ timeout: 1_500 }).catch(() => undefined);
    actions.push(`Clicked ${action.text}`);
    await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(OVERLAY_SETTLE_MS);
  }

  const hiddenLoaders = await page.evaluate(() => {
    let hidden = 0;
    const loadingPattern = /(preload|preloader|loading|loader|spinner|กำลังโหลด)/i;
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);

    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("body *"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") <= 0.05) continue;

      const areaRatio = (rect.width * rect.height) / viewportArea;
      const hasBlockingPosition = style.position === "fixed" || style.position === "sticky";
      if (!hasBlockingPosition && areaRatio < 0.45) continue;

      const signature = [
        element.id,
        element.className,
        element.getAttribute("aria-label"),
        element.getAttribute("role"),
        element.textContent,
        Array.from(element.querySelectorAll("img")).map((image) => `${image.alt} ${image.getAttribute("src")}`).join(" ")
      ]
        .join(" ")
        .replace(/\s+/g, " ");

      const hasDismissControl = Boolean(element.querySelector("button, a[href], [role='button'], input[type='button'], input[type='submit']"));
      if (!loadingPattern.test(signature) || hasDismissControl) continue;

      element.setAttribute("data-locator-stale-loading-hidden", "true");
      element.style.setProperty("display", "none", "important");
      hidden += 1;
      break;
    }

    return hidden;
  }).catch(() => 0);

  if (hiddenLoaders > 0) {
    actions.push(`Hid ${hiddenLoaders} stale loading mask${hiddenLoaders === 1 ? "" : "s"}`);
    await page.waitForTimeout(OVERLAY_SETTLE_MS);
  }

  return actions;
}

function renderErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Could not render that URL.";
  if (/Executable doesn't exist|browserType.launch/i.test(error.message)) {
    return "Could not start Chromium for rendered URL capture. Locally, run `npx playwright install chromium`; on Vercel, redeploy with `@sparticuz/chromium` installed.";
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
