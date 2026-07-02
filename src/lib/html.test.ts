import { describe, expect, it } from "vitest";
import { createPageSnapshot, documentFromSnapshot, parseWorkbenchInput } from "./html";

describe("workbench input parsing", () => {
  it("accepts rendered HTML bundles", () => {
    const parsed = parseWorkbenchInput(
      JSON.stringify({
        html: "<button>Save</button>",
        url: "https://example.test",
        title: "Example"
      })
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.source.kind).toBe("bundle");
      expect(parsed.source.metadata?.url).toBe("https://example.test");
    }
  });

  it("rejects JSON without an html string", () => {
    expect(parseWorkbenchInput(JSON.stringify({ title: "No HTML" }))).toEqual({
      ok: false,
      message: "Bundle JSON is missing a non-empty html string."
    });
  });
});

describe("snapshot sanitization", () => {
  it("removes executable content, external resources, and sensitive values", () => {
    const snapshot = createPageSnapshot(`
      <html>
        <head>
          <link rel="stylesheet" href="https://cdn.example/app.css" />
          <style>@import url("https://cdn.example/theme.css"); .hero { background: url("/x.png"); }</style>
        </head>
        <body>
          <script>alert("x")</script>
          <button onclick="steal()" data-testid="save-button">Save</button>
          <img src="https://example.test/image.png" alt="Logo" />
          <input type="password" name="password" value="secret" />
        </body>
      </html>
    `);
    const document = documentFromSnapshot(snapshot.html);

    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("link")).toBeNull();
    expect(document.querySelector("button")?.getAttribute("onclick")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("src")).toBeNull();
    expect(document.querySelector("input")?.getAttribute("value")).toBeNull();
    expect(document.querySelector("button")?.getAttribute("data-locator-id")).toBeTruthy();
    expect(document.querySelector("style")?.textContent).not.toContain("url(");
  });

  it("keeps ingested inline CSS while neutralizing CSS resource URLs", () => {
    const snapshot = createPageSnapshot(`
      <html>
        <head>
          <style data-locator-ingested-css="https://example.test/app.css">
            .primary { color: red; background-image: url("/asset.png"); }
          </style>
        </head>
        <body><button class="primary">Save</button></body>
      </html>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const style = document.querySelector("style[data-locator-ingested-css]");

    expect(style?.textContent).toContain(".primary");
    expect(style?.textContent).toContain("color: red");
    expect(style?.textContent).not.toContain("url(");
  });

  it("can inflate empty HTML divs so zero-size boxes stay targetable in preview", () => {
    const snapshot = createPageSnapshot("<main><div id=\"empty-target\"></div><div>Content</div></main>", {
      inflateEmptyHtmlElements: true
    });
    const document = documentFromSnapshot(snapshot.html);
    const emptyTarget = document.querySelector("#empty-target");

    expect(emptyTarget?.getAttribute("data-locator-empty-box")).toBe("true");
    expect(emptyTarget?.getAttribute("style")).toContain("min-width: 24px");
    expect(emptyTarget?.getAttribute("style")).toContain("min-height: 24px");
    expect(snapshot.warnings).toContain("Expanded 1 empty HTML div for preview targeting.");
    expect(document.querySelector("div:not(#empty-target)")?.getAttribute("data-locator-empty-box")).toBeNull();
  });

  it("does not inflate empty divs unless requested", () => {
    const snapshot = createPageSnapshot("<div id=\"empty-target\"></div>");
    const document = documentFromSnapshot(snapshot.html);

    expect(document.querySelector("#empty-target")?.getAttribute("data-locator-empty-box")).toBeNull();
  });
});
