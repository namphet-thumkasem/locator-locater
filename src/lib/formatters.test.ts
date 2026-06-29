import { describe, expect, it } from "vitest";
import { formatSnippet } from "./formatters";
import { createPageSnapshot, documentFromSnapshot } from "./html";
import { generateLocatorCandidates, summarizeElement } from "./locator";

describe("framework snippet formatting", () => {
  it("formats Playwright checkbox actions from the selected target type", () => {
    const { candidates, target } = candidatesFor(`
      <form>
        <label for="terms">Accept terms</label>
        <input id="terms" name="terms" type="checkbox" />
      </form>
    `);
    const labelCandidate = candidates.find((candidate) => candidate.strategy === "label")!;
    const snippet = formatSnippet(labelCandidate, candidates, "playwright", "action", summarizeElement(target));

    expect(snippet.code).toBe('page.getByLabel("Accept terms").check();');
    expect(snippet.warning).toBeUndefined();
  });

  it("formats Cypress compound locators without falling back", () => {
    const { candidates, target } = candidatesFor(`
      <main>
        <button class="primary">Save</button>
        <button class="secondary">Save</button>
        <button class="primary">Cancel</button>
      </main>
    `);
    const compound = candidates.find((candidate) => candidate.strategy === "compound")!;
    const snippet = formatSnippet(compound, candidates, "cypress", "locator", summarizeElement(target));

    expect(snippet.code).toBe('cy.get("button.primary").contains("Save")');
    expect(snippet.warning).toBeUndefined();
  });

  it("formats generic compound output as a raw selector plus text filter", () => {
    const { candidates, target } = candidatesFor(`
      <main>
        <button class="primary">Save</button>
        <button class="secondary">Save</button>
        <button class="primary">Cancel</button>
      </main>
    `);
    const compound = candidates.find((candidate) => candidate.strategy === "compound")!;
    const snippet = formatSnippet(compound, candidates, "generic", "locator", summarizeElement(target));

    expect(snippet.code).toBe('button.primary hasText "Save"');
    expect(snippet.warning).toBeUndefined();
  });

  it("warns when Cypress falls back from a semantic label candidate", () => {
    const { candidates, target } = candidatesFor(`
      <form>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" />
      </form>
    `);
    const labelCandidate = candidates.find((candidate) => candidate.strategy === "label")!;
    const snippet = formatSnippet(labelCandidate, candidates, "cypress", "action", summarizeElement(target));

    expect(snippet.code).toBe('cy.get("#email").type("example");');
    expect(snippet.warning).toContain("Cypress cannot represent label faithfully");
  });
});

function candidatesFor(html: string) {
  const snapshot = createPageSnapshot(html);
  const document = documentFromSnapshot(snapshot.html);
  const target = document.querySelector("button, input, textarea, select, a")!;

  return {
    candidates: generateLocatorCandidates(document, target),
    target
  };
}
