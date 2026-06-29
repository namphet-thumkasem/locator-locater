import type { ElementSummary, Framework, LocatorCandidate, SnippetMode, SnippetResult } from "./types";

export function formatSnippet(
  selectedCandidate: LocatorCandidate,
  allCandidates: LocatorCandidate[],
  framework: Framework,
  mode: SnippetMode,
  target: ElementSummary | null
): SnippetResult {
  const candidate = representableCandidate(selectedCandidate, allCandidates, framework);
  const warning =
    candidate.id === selectedCandidate.id
      ? undefined
      : `${frameworkLabel(framework)} cannot represent ${selectedCandidate.strategy} faithfully here, so this uses the best unique ${candidate.strategy} fallback.`;

  const expression = expressionFor(candidate, framework);
  const code = mode === "locator" ? expression : actionFor(expression, framework, target);

  return { code, warning };
}

export function bookmarkletCode(): string {
  const source =
    "(()=>{const b={html:document.documentElement.outerHTML,url:location.href,title:document.title,capturedAt:new Date().toISOString(),viewport:{width:window.innerWidth,height:window.innerHeight}};const t=JSON.stringify(b,null,2);const done=()=>alert('Rendered HTML bundle copied.');const fallback=()=>{const ta=document.createElement('textarea');ta.value=t;ta.setAttribute('readonly','true');ta.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(ta);ta.focus();ta.select();try{if(document.execCommand('copy')){done();return}}catch(e){}finally{ta.remove()}prompt('Copy rendered HTML bundle',t)};try{if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(done).catch(fallback)}else{fallback()}}catch(e){fallback()}})()";

  return `javascript:${source}`;
}

function representableCandidate(
  candidate: LocatorCandidate,
  allCandidates: LocatorCandidate[],
  framework: Framework
): LocatorCandidate {
  if (framework === "playwright") return candidate;
  if (framework === "robot") {
    return candidate.strategy === "role" || candidate.strategy === "label" || candidate.strategy === "text" || candidate.strategy === "compound"
      ? fallbackCandidate(candidate, allCandidates)
      : candidate;
  }
  if (framework === "generic") return candidate;
  if (framework === "selenium") {
    return candidate.strategy === "css" || candidate.strategy === "xpath" || candidate.strategy === "testId"
      ? candidate
      : fallbackCandidate(candidate, allCandidates);
  }

  if (framework === "cypress") {
    return candidate.strategy === "role" || candidate.strategy === "label"
    ? fallbackCandidate(candidate, allCandidates)
    : candidate;
  }

  return candidate;
}

function fallbackCandidate(candidate: LocatorCandidate, allCandidates: LocatorCandidate[]): LocatorCandidate {
  return (
    allCandidates.find((item) => item.unique && (item.strategy === "css" || item.strategy === "xpath")) ??
    allCandidates.find((item) => item.strategy === "css" || item.strategy === "xpath") ??
    candidate
  );
}

function expressionFor(candidate: LocatorCandidate, framework: Framework): string {
  if (framework === "playwright") return playwrightExpression(candidate);
  if (framework === "cypress") return cypressExpression(candidate);
  if (framework === "selenium") return seleniumExpression(candidate);
  if (framework === "robot") return robotExpression(candidate);
  return genericExpression(candidate);
}

function playwrightExpression(candidate: LocatorCandidate): string {
  if (candidate.strategy === "testId") {
    const parsed = parseAttributeSelector(candidate.value);
    if (parsed?.attribute === "data-testid") return `page.getByTestId(${quote(parsed.value)})`;
    return `page.locator(${quote(candidate.value)})`;
  }
  if (candidate.strategy === "role") {
    const parsed = parseRoleValue(candidate.value);
    if (parsed.name) return `page.getByRole(${quote(parsed.role)}, { name: ${quote(parsed.name)} })`;
    return `page.getByRole(${quote(parsed.role)})`;
  }
  if (candidate.strategy === "label") return `page.getByLabel(${quote(candidate.value)})`;
  if (candidate.strategy === "text") return `page.getByText(${quote(candidate.value)})`;
  if (candidate.strategy === "compound") return playwrightCompoundExpression(candidate);
  if (candidate.strategy === "xpath") return `page.locator(${quote(`xpath=${candidate.value}`)})`;
  return `page.locator(${quote(candidate.value)})`;
}

function cypressExpression(candidate: LocatorCandidate): string {
  if (candidate.strategy === "text") return `cy.contains(${quote(candidate.value)})`;
  if (candidate.strategy === "compound") return cypressCompoundExpression(candidate);
  if (candidate.strategy === "xpath") {
    return `cy.xpath(${quote(candidate.value)})`;
  }
  return `cy.get(${quote(candidate.value)})`;
}

function seleniumExpression(candidate: LocatorCandidate): string {
  if (candidate.strategy === "xpath") return `driver.findElement(By.xpath(${quote(candidate.value)}))`;
  return `driver.findElement(By.cssSelector(${quote(cssSelectorFor(candidate))}))`;
}

function robotExpression(candidate: LocatorCandidate): string {
  if (candidate.strategy === "xpath") return `xpath:${candidate.value}`;
  if (candidate.strategy === "testId") return `css:${candidate.value}`;
  if (candidate.strategy === "css") return `css:${candidate.value}`;
  return `css:${cssSelectorFor(candidate)}`;
}

function genericExpression(candidate: LocatorCandidate): string {
  if (candidate.strategy === "xpath") return candidate.value;
  if (candidate.strategy === "testId") return candidate.value;
  if (candidate.strategy === "compound") {
    const css = candidate.parts?.css ?? candidate.value;
    const text = candidate.parts?.text;
    return text ? `${css} hasText ${quote(text)}` : css;
  }
  if (candidate.strategy === "role") return `role=${candidate.value}`;
  if (candidate.strategy === "label") return `label=${candidate.value}`;
  if (candidate.strategy === "text") return `text=${candidate.value}`;
  return candidate.value;
}

function actionFor(expression: string, framework: Framework, target: ElementSummary | null): string {
  const action = actionKind(target);
  if (framework === "playwright") {
    if (action === "fill") return `${expression}.fill("example");`;
    if (action === "check") return `${expression}.check();`;
    return `${expression}.click();`;
  }

  if (framework === "cypress") {
    if (action === "fill") return `${expression}.type("example");`;
    if (action === "check") return `${expression}.check();`;
    return `${expression}.click();`;
  }

  if (framework === "selenium") {
    if (action === "fill") return `${expression}.sendKeys("example");`;
    return `${expression}.click();`;
  }

  if (framework === "robot") {
    if (action === "fill") return `Input Text    ${expression}    example`;
    if (action === "check") return `Select Checkbox    ${expression}`;
    return `Click Element    ${expression}`;
  }

  if (action === "fill") return `${expression} -> fill("example")`;
  if (action === "check") return `${expression} -> check()`;
  return `${expression} -> click()`;
}

function actionKind(target: ElementSummary | null): "click" | "fill" | "check" {
  if (!target) return "click";
  const type = target.attributes.type?.toLowerCase();
  if (target.tagName === "textarea") return "fill";
  if (target.tagName === "select") return "click";
  if (target.tagName === "input" && (type === "checkbox" || type === "radio")) return "check";
  if (target.role === "checkbox" || target.role === "radio" || target.role === "switch") return "check";
  if (target.tagName === "input") return "fill";
  return "click";
}

function cssSelectorFor(candidate: LocatorCandidate): string {
  if (candidate.strategy === "testId") return candidate.value;
  if (candidate.strategy === "compound") return candidate.parts?.css ?? candidate.value;
  return candidate.value;
}

function playwrightCompoundExpression(candidate: LocatorCandidate): string {
  const text = candidate.parts?.text;
  if (candidate.parts?.testIdAttribute === "data-testid" && candidate.parts.testIdValue && text) {
    return `page.getByTestId(${quote(candidate.parts.testIdValue)}).filter({ hasText: ${quote(text)} })`;
  }
  const css = candidate.parts?.css ?? candidate.value;
  if (text) return `page.locator(${quote(css)}, { hasText: ${quote(text)} })`;
  return `page.locator(${quote(css)})`;
}

function cypressCompoundExpression(candidate: LocatorCandidate): string {
  const css = candidate.parts?.css ?? candidate.value;
  const text = candidate.parts?.text;
  if (text) return `cy.get(${quote(css)}).contains(${quote(text)})`;
  return `cy.get(${quote(css)})`;
}

function parseRoleValue(value: string): { role: string; name?: string } {
  const match = value.match(/^([^[]+)\[name="(.+)"\]$/);
  if (!match) return { role: value };
  return { role: match[1], name: match[2] };
}

function parseAttributeSelector(value: string): { attribute: string; value: string } | null {
  const match = value.match(/^\[([^=]+)="(.+)"\]$/);
  if (!match) return null;
  return { attribute: match[1], value: match[2] };
}

function frameworkLabel(framework: Framework): string {
  if (framework === "playwright") return "Playwright";
  if (framework === "cypress") return "Cypress";
  if (framework === "selenium") return "Selenium";
  if (framework === "robot") return "Robot Framework";
  return "Generic output";
}

function quote(value: string): string {
  return JSON.stringify(value);
}
