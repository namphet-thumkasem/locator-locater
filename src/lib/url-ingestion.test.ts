import { describe, expect, it, vi } from "vitest";
import { fetchSourceHtml, ingestUrl, inlineStylesheets, normalizeHttpUrl } from "./url-ingestion";

describe("URL ingestion", () => {
  it("normalizes http and https URLs only", () => {
    expect(normalizeHttpUrl(" https://example.test/path ")).toBe("https://example.test/path");
    expect(normalizeHttpUrl("http://localhost:3000")).toBe("http://localhost:3000/");
    expect(normalizeHttpUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeHttpUrl("not a url")).toBeNull();
  });

  it("renders a URL with browser output and returns a rendered bundle shape", async () => {
    const renderPage = vi.fn(async () => ({
      html: "<!doctype html><title>Rendered</title><button>Save</button>",
      title: "Rendered",
      url: "https://example.test/dashboard",
      overlayActions: ["Clicked Accept"],
      viewport: { width: 1440, height: 900 }
    }));

    const result = await ingestUrl("https://example.test/dashboard", { renderPage });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.url).toBe("https://example.test/dashboard");
      expect(result.bundle.title).toBe("Rendered");
      expect(result.bundle.html).toContain("<button>Save</button>");
      expect(result.bundle.capturedAt).toBeTruthy();
      expect(result.bundle.viewport).toEqual({ width: 1440, height: 900 });
      expect(result.bundle.ingestion?.mode).toBe("rendered-dom");
      expect(result.bundle.ingestion?.overlayActions).toEqual(["Clicked Accept"]);
      expect(result.bundle.ingestion?.warnings[0]).toContain("executed page JavaScript");
    }
    expect(renderPage).toHaveBeenCalledWith("https://example.test/dashboard", { dismissOverlays: true });
  });

  it("can render without dismissing overlays when requested", async () => {
    const renderPage = vi.fn(async () => ({
      html: "<!doctype html><title>Rendered</title><button>Save</button>",
      title: "Rendered",
      url: "https://example.test/dashboard"
    }));

    const result = await ingestUrl("https://example.test/dashboard", { dismissOverlays: false, renderPage });

    expect(result.ok).toBe(true);
    expect(renderPage).toHaveBeenCalledWith("https://example.test/dashboard", { dismissOverlays: false });
  });

  it("inlines linked stylesheets into rendered HTML bundles", async () => {
    const fetchLike = vi.fn(async (url: string) => {
      if (url === "https://example.test/assets/app.css") {
        return new Response(".primary { color: red; }", {
          status: 200,
          headers: { "content-type": "text/css" }
        });
      }

      return new Response(
        '<!doctype html><title>Styled</title><link rel="stylesheet" href="/assets/app.css"><button class="primary">Save</button>',
        {
          status: 200,
          headers: { "content-type": "text/html" }
        }
      );
    });
    const renderPage = vi.fn(async () => ({
      html: '<!doctype html><title>Styled</title><link rel="stylesheet" href="/assets/app.css"><button class="primary">Save</button>',
      title: "Styled",
      url: "https://example.test/dashboard"
    }));

    const result = await ingestUrl("https://example.test/dashboard", { fetchLike, renderPage });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.html).toContain('<style data-locator-ingested-css="https://example.test/assets/app.css">');
      expect(result.bundle.html).toContain(".primary { color: red; }");
      expect(result.bundle.html).not.toContain('rel="stylesheet"');
      expect(result.bundle.ingestion?.stylesheetsInlined).toBe(1);
      expect(result.bundle.ingestion?.stylesheetsSkipped).toBe(0);
    }
  });

  it("leaves stylesheet links untouched when stylesheet fetches fail", async () => {
    const fetchLike = vi.fn(async () => new Response("missing", { status: 404 }));
    const html = '<link rel="stylesheet" href="/missing.css"><button>Save</button>';

    await expect(inlineStylesheets(html, "https://example.test/page", fetchLike)).resolves.toEqual({
      html,
      inlined: 0,
      skipped: 1
    });
  });

  it("removes non-visual payload before enforcing the rendered HTML size limit", async () => {
    const renderPage = vi.fn(async () => ({
      html: `<!doctype html><title>Huge App</title><main><button>Apply</button></main><script>${"x".repeat(1_600_000)}</script>`,
      title: "Huge App",
      url: "https://example.test/huge-app"
    }));

    const result = await ingestUrl("https://example.test/huge-app", { renderPage });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.html).toContain("<button>Apply</button>");
      expect(result.bundle.html).not.toContain("<script>");
      expect(result.bundle.ingestion?.scriptsDetected).toBe(1);
      expect(result.bundle.ingestion?.overlayActions?.join("\n")).toContain("Removed 1 script tag");
      expect(result.bundle.ingestion?.warnings.join("\n")).toContain("executed during capture and were removed");
    }
  });

  it("keeps source HTML fallback as an explicit helper", async () => {
    const fetchLike = vi.fn(async () => {
      return new Response("<!doctype html><title>Example &amp; Test</title><button>Save</button>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    });

    const result = await fetchSourceHtml("https://example.test/dashboard", fetchLike);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.ingestion?.mode).toBe("source-html");
      expect(result.bundle.ingestion?.warnings[0]).toContain("does not execute page JavaScript");
    }
  });

  it("reports source HTML HTTP failures without returning HTML", async () => {
    const fetchLike = vi.fn(async () => new Response("nope", { status: 404 }));
    const result = await fetchSourceHtml("https://example.test/missing", fetchLike);

    expect(result).toEqual({ ok: false, status: 404, message: "URL returned HTTP 404." });
  });

  it("rejects pages that are too large", async () => {
    const renderPage = vi.fn(async () => ({
      html: "x".repeat(1_500_001),
      url: "https://example.test/huge"
    }));

    const result = await ingestUrl("https://example.test/huge", { renderPage });

    expect(result).toEqual({ ok: false, status: 413, message: "Fetched page is too large for the workbench." });
  });
});
