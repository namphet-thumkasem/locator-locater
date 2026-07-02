import { describe, expect, it, vi } from "vitest";
import { bookmarkletCode, formatSnippet } from "./formatters";
import { createPageSnapshot, documentFromSnapshot } from "./html";
import { findByLocatorId, generateLocatorCandidates, manualLocatorCandidate, summarizeElement } from "./locator";

describe("locator candidates", () => {
  it("recommends the best unique candidate for a selected action target", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <button data-testid="create-order">Create order</button>
        <button>Create order</button>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("[data-testid='create-order']");

    expect(target).not.toBeNull();
    const candidates = generateLocatorCandidates(document, target!);
    const recommended = candidates.find((candidate) => candidate.recommended);

    expect(candidates).toHaveLength(5);
    expect(recommended?.strategy).toBe("testId");
    expect(recommended?.unique).toBe(true);
  });

  it("treats data-qa as a first-priority test id attribute", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <button id="save-button" data-qa="save-order" class="primary">Save</button>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("button")!;
    const candidates = generateLocatorCandidates(document, target);
    const recommended = candidates.find((candidate) => candidate.recommended);

    expect(recommended?.strategy).toBe("testId");
    expect(recommended?.value).toBe('[data-qa="save-order"]');
  });

  it("uses configured test id attributes for lightweight workbench settings", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <button data-pw="create-order">Create order</button>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("button")!;
    const candidates = generateLocatorCandidates(document, target, { testIdAttributes: ["data-pw"] });
    const recommended = candidates.find((candidate) => candidate.recommended);

    expect(recommended?.strategy).toBe("testId");
    expect(recommended?.value).toBe('[data-pw="create-order"]');
  });

  it("validates temporary manual locator tester candidates without saving them", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <button class="primary">Save</button>
        <button>Cancel</button>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const uniqueManual = manualLocatorCandidate(document, "css", "button.primary");
    const broadManual = manualLocatorCandidate(document, "css", "button");

    expect(uniqueManual.unique).toBe(true);
    expect(uniqueManual.matchCount).toBe(1);
    expect(broadManual.unique).toBe(false);
    expect(broadManual.matchCount).toBe(2);
    expect(broadManual.warnings).toContain("Manual locator is not unique in the page snapshot.");
  });

  it("parses copied compound CSS selectors in the manual locator tester", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <div class="MuiBox-root css-dq5rxc">รวมแบรนด์เด็ด</div>
        <div class="MuiBox-root css-dq5rxc">สินค้าแนะนำ</div>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const manual = manualLocatorCandidate(document, "css", 'div.MuiBox-root.css-dq5rxc hasText "รวมแบรนด์เด็ด"');
    const snippet = formatSnippet(manual, [manual], "playwright", "locator", null);

    expect(manual.strategy).toBe("compound");
    expect(manual.unique).toBe(true);
    expect(manual.matchCount).toBe(1);
    expect(manual.parts).toMatchObject({ css: "div.MuiBox-root.css-dq5rxc", text: "รวมแบรนด์เด็ด" });
    expect(snippet.code).toBe('page.locator("div.MuiBox-root.css-dq5rxc", { hasText: "รวมแบรนด์เด็ด" })');
  });

  it("uses static ids but skips generated-looking ids", () => {
    const goodSnapshot = createPageSnapshot('<button id="submit-btn" class="primary">Save</button>');
    const goodDocument = documentFromSnapshot(goodSnapshot.html);
    const goodCandidates = generateLocatorCandidates(goodDocument, goodDocument.querySelector("button")!);
    const goodCss = goodCandidates.find((candidate) => candidate.strategy === "css");

    expect(goodCss?.value).toBe("#submit-btn");

    const badSnapshot = createPageSnapshot(`
      <main>
        <section class="toolbar">
          <button id="ember456" class="primary">Save</button>
        </section>
      </main>
    `);
    const badDocument = documentFromSnapshot(badSnapshot.html);
    const badCandidates = generateLocatorCandidates(badDocument, badDocument.querySelector("button")!);

    expect(badCandidates.some((candidate) => candidate.value === "#ember456")).toBe(false);
  });

  it("prefers human classes over generated classes when both exist", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <section class="billing-actions">
          <button class="MuiBox-root css-a1b2c3 sc-xyz primary">Pay now</button>
        </section>
        <section class="footer-actions">
          <button class="MuiBox-root css-a1b2c3 sc-xyz primary">Cancel</button>
        </section>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector(".billing-actions button")!;
    const candidates = generateLocatorCandidates(document, target);

    expect(candidates.some((candidate) => candidate.value.includes("MuiBox-root"))).toBe(false);
    expect(candidates.some((candidate) => candidate.value.includes("css-a1b2c3"))).toBe(false);
    expect(candidates.some((candidate) => candidate.value.includes("sc-xyz"))).toBe(false);
    expect(candidates.find((candidate) => candidate.strategy === "css")?.value).toBe("section.billing-actions button.primary");
  });

  it("allows generated classes as a fallback before positional selectors", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <button class="MuiBox-root css-a1b2c3 sc-xyz">Pay now</button>
        <button class="MuiBox-root css-a1b2c3 sc-abc">Cancel</button>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("button")!;
    const candidates = generateLocatorCandidates(document, target);
    const css = candidates.find((candidate) => candidate.strategy === "css");

    expect(css?.unique).toBe(true);
    expect(css?.value).toBe("button.MuiBox-root.css-a1b2c3.sc-xyz");
    expect(css?.value).not.toContain(":nth-of-type");
    expect(css?.warnings).toContain("Generated class fallback may be unstable across rebuilds.");
  });

  it("uses generated CSS plus text before recommending XPath", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <div class="MuiBox-root css-dq5rxc">รวมแบรนด์เด็ด</div>
        <div class="MuiBox-root css-dq5rxc">สินค้าแนะนำ</div>
        <section><a><div><div>รวมแบรนด์เด็ด</div></div></a></section>
        <aside><span>รวมแบรนด์เด็ด</span></aside>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("div.MuiBox-root")!;
    const candidates = generateLocatorCandidates(document, target);
    const recommended = candidates.find((candidate) => candidate.recommended);
    const compound = candidates.find((candidate) => candidate.strategy === "compound");

    expect(compound?.value).toBe('div.MuiBox-root.css-dq5rxc hasText "รวมแบรนด์เด็ด"');
    expect(compound?.unique).toBe(true);
    expect(recommended?.strategy).toBe("compound");
    expect(recommended?.strategy).not.toBe("xpath");
  });

  it("uses generated link CSS plus a stable text fragment for long product text", () => {
    const productText =
      "[พรีออเดอร์] แอลจี เครื่องซักผ้าฝาบน 17 กก. รุ่น T2517VBTM สีเทาเข้ม2-4 วัน฿8,990฿ 18,990-52%";
    const snapshot = createPageSnapshot(`
      <main>
        ${Array.from({ length: 39 }, (_, index) => {
          return `<a class="MuiBox-root css-1jnkcok">สินค้าอื่น ${index} ราคาโปรโมชันพร้อมส่ง</a>`;
        }).join("")}
        <a class="MuiBox-root css-1jnkcok">${productText}</a>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = Array.from(document.querySelectorAll("a")).find((element) => element.textContent === productText)!;
    const candidates = generateLocatorCandidates(document, target);
    const recommended = candidates.find((candidate) => candidate.recommended);
    const compound = candidates.find((candidate) => candidate.strategy === "compound");

    expect(compound?.value).toContain("a.MuiBox-root.css-1jnkcok hasText");
    expect(compound?.value.length).toBeLessThan(productText.length + "a.MuiBox-root.css-1jnkcok hasText ".length);
    expect(compound?.unique).toBe(true);
    expect(recommended?.strategy).toBe("compound");
  });

  it("uses stable href as a high-priority CSS candidate for links", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <a class="MuiBox-root css-1jnkcok" href="/products/lg-washer-t2517vbtm">LG Washer</a>
        <a class="MuiBox-root css-1jnkcok" href="/products/samsung-washer">Samsung Washer</a>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("a")!;
    const candidates = generateLocatorCandidates(document, target);
    const recommended = candidates.find((candidate) => candidate.recommended);

    expect(recommended?.strategy).toBe("css");
    expect(recommended?.value).toBe('a[href="/products/lg-washer-t2517vbtm"]');
  });

  it("combines duplicate href with text before using generated classes or XPath", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <a class="MuiBox-root css-1jnkcok" href="/campaign">รวมแบรนด์เด็ด</a>
        <a class="MuiBox-root css-1jnkcok" href="/campaign">สินค้าแนะนำ</a>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("a")!;
    const candidates = generateLocatorCandidates(document, target);
    const recommended = candidates.find((candidate) => candidate.recommended);

    expect(recommended?.strategy).toBe("compound");
    expect(recommended?.value).toBe('a[href="/campaign"] hasText "รวมแบรนด์เด็ด"');
  });

  it("does not emit broad non-unique scoped bare-tag CSS like #__next div", () => {
    const snapshot = createPageSnapshot(`
      <div id="__next">
        <div><div><div><span>Noise</span></div></div></div>
        <div><div><div><span>More noise</span></div></div></div>
        <div><div><div><span>Still noise</span></div></div></div>
        <div><div><div><button>Save</button></div></div></div>
      </div>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("button")!;
    const candidates = generateLocatorCandidates(document, target);

    expect(candidates.some((candidate) => candidate.value === "#__next div")).toBe(false);
    expect(candidates.find((candidate) => candidate.strategy === "css")?.unique).toBe(true);
  });

  it("formats unsupported Selenium semantic candidates using structural fallback", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <button id="save-order">Save order</button>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("button")!;
    const candidates = generateLocatorCandidates(document, target);
    const roleCandidate = candidates.find((candidate) => candidate.strategy === "role")!;
    const snippet = formatSnippet(roleCandidate, candidates, "selenium", "action", summarizeElement(target));

    expect(snippet.code).toContain("By.cssSelector");
    expect(snippet.code).toContain("#save-order");
    expect(snippet.warning).toContain("cannot represent role faithfully");
  });

  it("keeps XPath as a low-scoring fallback when CSS can be made unique structurally", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <button class="primary">Save</button>
        <button class="primary">Save</button>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("button")!;
    const candidates = generateLocatorCandidates(document, target);
    const css = candidates.find((candidate) => candidate.strategy === "css");
    const xpath = candidates.find((candidate) => candidate.strategy === "xpath");

    expect(css?.unique).toBe(true);
    expect(css?.value).toContain(":nth-of-type");
    expect(xpath).toBeDefined();
    expect(xpath!.score).toBeLessThan(css!.score);
  });

  it("prefers readable ancestor-scoped CSS before structural selectors", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <section class="toolbar">
          <button class="primary">Save</button>
        </section>
        <section class="footer">
          <button class="primary">Save</button>
        </section>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector(".toolbar button")!;
    const candidates = generateLocatorCandidates(document, target);
    const recommended = candidates.find((candidate) => candidate.recommended);
    const css = candidates.find((candidate) => candidate.strategy === "css");

    expect(css?.unique).toBe(true);
    expect(css?.value).toBe("section.toolbar button.primary");
    expect(css?.value).not.toContain(":nth-of-type");
    expect(recommended?.strategy).toBe("css");
  });

  it("does not let unique text outrank a readable scoped CSS selector", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <section class="billing-actions">
          <button class="primary">Archive invoice</button>
        </section>
        <section class="footer-actions">
          <button class="primary">Download invoice</button>
        </section>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector(".billing-actions button")!;
    const candidates = generateLocatorCandidates(document, target);
    const recommended = candidates.find((candidate) => candidate.recommended);

    expect(recommended?.strategy).toBe("css");
    expect(recommended?.value).toBe("section.billing-actions button.primary");
  });

  it("builds scoped CSS around stable target attributes", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <form class="search-form">
          <input name="q" placeholder="Search" />
        </form>
        <form class="newsletter-form">
          <input name="q" placeholder="Search" />
        </form>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector(".search-form input")!;
    const candidates = generateLocatorCandidates(document, target);
    const css = candidates.find((candidate) => candidate.strategy === "css");

    expect(css?.unique).toBe(true);
    expect(css?.value).toBe('form.search-form input[name="q"]');
  });

  it("does not use placeholder or accessible label text as CSS locator attributes", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <form class="search-form">
          <input aria-label="Search jobs" placeholder="Job title or company" />
        </form>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("input")!;
    const candidates = generateLocatorCandidates(document, target);
    const cssCandidates = candidates.filter((candidate) => candidate.strategy === "css");
    const labelCandidate = candidates.find((candidate) => candidate.strategy === "label");

    expect(labelCandidate?.value).toBe("Search jobs");
    expect(cssCandidates.some((candidate) => candidate.value.includes("placeholder"))).toBe(false);
    expect(cssCandidates.some((candidate) => candidate.value.includes("aria-label"))).toBe(false);
    expect(cssCandidates.some((candidate) => candidate.value.includes("Search jobs"))).toBe(false);
    expect(cssCandidates.some((candidate) => candidate.value.includes("Job title or company"))).toBe(false);
  });

  it("promotes a CSS plus text compound locator when single-strategy candidates are ambiguous", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <button class="primary">Save</button>
        <button class="secondary">Save</button>
        <button class="primary">Cancel</button>
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("button.primary")!;
    const candidates = generateLocatorCandidates(document, target);
    const recommended = candidates.find((candidate) => candidate.recommended);
    const compound = candidates.find((candidate) => candidate.strategy === "compound");
    const xpath = candidates.find((candidate) => candidate.strategy === "xpath");

    expect(recommended?.strategy).toBe("compound");
    expect(compound?.unique).toBe(true);
    expect(compound?.value).toBe('button.primary hasText "Save"');
    expect(xpath).toBeDefined();
    expect(compound!.score).toBeGreaterThan(xpath!.score);

    const snippet = formatSnippet(compound!, candidates, "playwright", "action", summarizeElement(target));
    expect(snippet.code).toBe('page.locator("button.primary", { hasText: "Save" }).click();');
  });

  it("formats Robot Framework locators and actions", () => {
    const snapshot = createPageSnapshot(`
      <main>
        <input id="customer-email" aria-label="Customer email" />
      </main>
    `);
    const document = documentFromSnapshot(snapshot.html);
    const target = document.querySelector("input")!;
    const candidates = generateLocatorCandidates(document, target);
    const labelCandidate = candidates.find((candidate) => candidate.strategy === "label")!;
    const snippet = formatSnippet(labelCandidate, candidates, "robot", "action", summarizeElement(target));

    expect(snippet.code).toBe("Input Text    css:#customer-email    example");
    expect(snippet.warning).toContain("cannot represent label faithfully");
  });

  it("can find a target again through its injected locator id", () => {
    const snapshot = createPageSnapshot("<button>Save</button>");
    const document = documentFromSnapshot(snapshot.html);
    const locatorId = document.querySelector("button")?.getAttribute("data-locator-id");

    expect(locatorId).toBeTruthy();
    expect(findByLocatorId(document, locatorId!)).toBe(document.querySelector("button"));
  });

  it("generates a bookmarklet with clipboard and manual fallbacks", () => {
    const bookmarklet = bookmarkletCode();

    expect(bookmarklet).toMatch(/^javascript:\(\(\)=>/);
    expect(bookmarklet).toContain("navigator.clipboard&&window.isSecureContext");
    expect(bookmarklet).toContain("document.execCommand('copy')");
    expect(bookmarklet).toContain("prompt('Copy rendered HTML bundle',t)");
  });

  it("runs the bookmarklet fallback when clipboard is unavailable", () => {
    const bookmarklet = bookmarkletCode();
    const script = bookmarklet.replace(/^javascript:/, "");
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => true), configurable: true });
    const execCommand = vi.mocked(document.execCommand);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

    document.body.innerHTML = "<main><button>Save</button></main>";
    eval(script);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(alert).toHaveBeenCalledWith("Rendered HTML bundle copied.");
    alert.mockRestore();
  });
});
