import { computeAccessibleName, getRole } from "dom-accessibility-api";
import { roles } from "aria-query";
import { cssEscape, normalizeText, testIdAttributes } from "./html";
import type { ElementSummary, LocatorCandidate, LocatorCandidateParts, LocatorStrategy } from "./types";

const INTERACTIVE_SELECTORS = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[role='textbox']"
].join(",");

const STRONG_ARIA_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "option",
  "textbox",
  "combobox",
  "listbox",
  "slider",
  "spinbutton"
]);

const GENERATED_VALUE_PATTERN = /(^|[-_])([a-f0-9]{8,}|[0-9]{4,}|css-[a-z0-9]{6,})([-_]|$)/i;
const GENERATED_ID_PATTERN = /^(ember|mui|popper|react-select|headlessui|downshift|radix)[-_]?\d+/i;
const GENERATED_CLASS_PATTERNS = [
  /^css-[a-z0-9]+$/i,
  /^Mui[A-Za-z0-9-]+$/,
  /^sc-[a-z0-9]+$/i,
  /^styles__[A-Za-z0-9_-]+$/,
  /^[A-Za-z0-9_-]+__[A-Za-z0-9_-]+--[A-Za-z0-9_-]+$/,
  GENERATED_VALUE_PATTERN
];

export function findActionTarget(clickedElement: Element): Element {
  let current: Element | null = clickedElement;

  while (current && current !== current.ownerDocument.body) {
    if (isActionTarget(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return clickedElement;
}

export function getElementChain(element: Element): ElementSummary[] {
  const chain: ElementSummary[] = [];
  let current: Element | null = element;

  while (current && current !== current.ownerDocument.body.parentElement) {
    if (current instanceof HTMLElement || current instanceof SVGElement) {
      chain.push(summarizeElement(current));
    }

    if (current === current.ownerDocument.body) break;
    current = current.parentElement;
  }

  return chain;
}

export function summarizeElement(element: Element): ElementSummary {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === "data-locator-id") continue;
    if (attribute.name === "data-locator-selected") continue;
    if (attribute.name === "data-locator-hover") continue;
    attributes[attribute.name] = attribute.value;
  }

  return {
    locatorId: element.getAttribute("data-locator-id") ?? "",
    tagName: element.tagName.toLowerCase(),
    role: getSemanticRole(element),
    name: safeAccessibleName(element),
    text: normalizeText(element.textContent ?? "").slice(0, 140),
    attributes
  };
}

export function generateLocatorCandidates(document: Document, target: Element): LocatorCandidate[] {
  const allCandidates = [
    ...testIdCandidates(document, target),
    ...roleCandidates(document, target),
    ...labelCandidates(document, target),
    ...textCandidates(document, target),
    ...compoundCandidates(document, target),
    ...cssCandidates(document, target),
    ...xpathCandidates(document, target)
  ];

  const deduped = dedupeCandidates(allCandidates)
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length)
    .slice(0, 5);

  const firstUnique = deduped.find((candidate) => candidate.unique && candidate.strategy !== "xpath") ??
    deduped.find((candidate) => candidate.unique);
  return deduped.map((candidate) => ({
    ...candidate,
    recommended: Boolean(firstUnique && firstUnique.id === candidate.id)
  }));
}

export function findByLocatorId(document: Document, locatorId: string): Element | null {
  return document.querySelector(`[data-locator-id="${cssEscape(locatorId)}"]`);
}

function isActionTarget(element: Element): boolean {
  if (element.matches(INTERACTIVE_SELECTORS)) return true;
  const role = getSemanticRole(element);
  return role ? STRONG_ARIA_ROLES.has(role) : false;
}

function getSemanticRole(element: Element): string | null {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) {
    const firstRole = explicitRole.split(/\s+/)[0]?.trim();
    if (firstRole && roles.has(firstRole)) return firstRole;
  }
  return getRole(element);
}

function safeAccessibleName(element: Element): string {
  try {
    return normalizeText(computeAccessibleName(element));
  } catch {
    return "";
  }
}

function testIdCandidates(document: Document, target: Element): LocatorCandidate[] {
  return testIdAttributes().flatMap((attribute) => {
    const value = target.getAttribute(attribute);
    if (!value) return [];
    const selector = `[${attribute}="${cssEscape(value)}"]`;
    const matchCount = document.querySelectorAll(selector).length;
    return [
      makeCandidate("testId", `${attribute}=${value}`, selector, matchCount, {
        baseScore: 100,
        stable: !GENERATED_VALUE_PATTERN.test(value)
      })
    ];
  });
}

function roleCandidates(document: Document, target: Element): LocatorCandidate[] {
  const role = getSemanticRole(target);
  const name = safeAccessibleName(target);
  if (!role) return [];

  if (!name && !STRONG_ARIA_ROLES.has(role)) return [];

  const matches = Array.from(document.body.querySelectorAll("*")).filter((element) => {
    if (getSemanticRole(element) !== role) return false;
    if (!name) return true;
    return safeAccessibleName(element) === name;
  });

  const value = name ? `${role}[name="${name}"]` : role;
  const warnings = name ? [] : ["Role has no accessible name; use only if the role is uniquely meaningful."];

  return [
    makeCandidate("role", value, value, matches.length, {
      baseScore: name ? 92 : 74,
      stable: true,
      warnings
    })
  ];
}

function labelCandidates(document: Document, target: Element): LocatorCandidate[] {
  if (!isFormControl(target)) return [];
  const label = labelTextFor(document, target);
  if (!label) return [];

  const matches = Array.from(document.querySelectorAll("input, textarea, select")).filter(
    (element) => labelTextFor(document, element) === label
  );

  return [
    makeCandidate("label", label, label, matches.length, {
      baseScore: 88,
      stable: true
    })
  ];
}

function textCandidates(document: Document, target: Element): LocatorCandidate[] {
  const text = normalizeText(target.textContent ?? "");
  if (!text || text.length > 90) return [];

  const matches = Array.from(document.body.querySelectorAll("*")).filter(
    (element) => normalizeText(element.textContent ?? "") === text
  );

  return [
    makeCandidate("text", text, text, matches.length, {
      baseScore: 58,
      stable: true,
      warnings: ["Text is normalized from the page snapshot and may differ from browser-visible text."]
    })
  ];
}

function compoundCandidates(document: Document, target: Element): LocatorCandidate[] {
  const text = compoundTextFor(target);
  if (!text) return [];

  const selectors = [
    ...testIdAttributes().flatMap((attribute) => {
      const value = target.getAttribute(attribute);
      return value
        ? [{ css: `[${attribute}="${cssEscape(value)}"]`, baseScore: 86, testIdAttribute: attribute, testIdValue: value }]
        : [];
    }),
    { css: stableHrefSelector(target), baseScore: 82 },
    { css: shortClassSelector(target), baseScore: 58 },
    { css: generatedClassFallbackSelector(target), baseScore: 54 },
    { css: target.tagName.toLowerCase(), baseScore: 44 }
  ].filter((entry) => entry.css && queryCount(document, entry.css) > 1);

  return selectors
    .flatMap((entry) => {
      const css = entry.css;
      if (!css) return [];
      const matchCount = Array.from(document.querySelectorAll(css)).filter((element) => {
        return normalizeText(element.textContent ?? "").includes(text);
      }).length;

      if (matchCount === 0) return [];

      const parts: LocatorCandidateParts = {
        css,
        text,
        testIdAttribute: "testIdAttribute" in entry ? entry.testIdAttribute : undefined,
        testIdValue: "testIdValue" in entry ? entry.testIdValue : undefined
      };

      return [
        makeCandidate("compound", `${css} hasText "${text}"`, `${css} hasText "${text}"`, matchCount, {
          baseScore: entry.baseScore,
          stable: !GENERATED_VALUE_PATTERN.test(css),
          warnings: selectorUsesGeneratedClasses(css)
            ? [
                "Compound locator combines a generated class fallback with normalized snapshot text.",
                "Generated class fallback may be unstable across rebuilds."
              ]
            : ["Compound locator combines a base selector with normalized snapshot text."],
          parts
        })
      ];
    })
    .filter((candidate) => candidate.unique)
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length)
    .slice(0, 2);
}

function compoundTextFor(target: Element): string {
  const text = normalizeText(target.textContent ?? "");
  if (!text) return "";
  if (text.length <= 90) return text;
  return text.slice(0, 64).trim();
}

function cssCandidates(document: Document, target: Element): LocatorCandidate[] {
  const selectors = [
    { selector: uniqueIdSelector(target), baseScore: 96 },
    { selector: attributeSelector(target, "aria-label"), baseScore: 88 },
    { selector: attributeSelector(target, "role"), baseScore: 86 },
    { selector: attributeSelector(target, "aria-describedby"), baseScore: 84 },
    { selector: isNameBearingElement(target) ? attributeSelector(target, "name") : null, baseScore: 82 },
    { selector: stableHrefSelector(target), baseScore: 80 },
    { selector: shortClassSelector(target), baseScore: 74 },
    ...meaningfulAttributeSelectors(target),
    ...scopedCssSelectors(target),
    { selector: generatedClassFallbackSelector(target), baseScore: 34 },
    { selector: structuralSelector(target), baseScore: 20 }
  ].flatMap(({ selector, baseScore }) => {
    if (!selector) return [];
    const matchCount = queryCount(document, selector);
    if (matchCount === 0) return [];

    const warnings = [];
    if (matchCount > 1) warnings.push("CSS selector is not unique in the page snapshot.");
    if (selectorUsesGeneratedClasses(selector)) warnings.push("Generated class fallback may be unstable across rebuilds.");
    if (selector.includes(":nth-of-type")) warnings.push("Structural CSS fallback may be brittle.");

    return [
      makeCandidate("css", selector, selector, matchCount, {
        baseScore,
        stable: !GENERATED_VALUE_PATTERN.test(selector),
        warnings
      })
    ];
  });

  const uniqueCss = selectors.filter((candidate) => candidate.unique);
  const fallbackSelectors = selectors.filter((candidate) => !isBroadScopedBareTagSelector(candidate.value));
  return (uniqueCss.length ? uniqueCss : fallbackSelectors)
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length)
    .slice(0, 1);
}

function xpathCandidates(document: Document, target: Element): LocatorCandidate[] {
  const xpath = xpathFor(target);
  const matchCount = evaluateXPathCount(document, xpath);
  return [
    makeCandidate("xpath", xpath, xpath, matchCount, {
      baseScore: 18,
      stable: false,
      warnings: ["XPath is a structural fallback and may be brittle."]
    })
  ];
}

function makeCandidate(
  strategy: LocatorStrategy,
  label: string,
  value: string,
  matchCount: number,
  options: { baseScore: number; stable: boolean; warnings?: string[]; parts?: LocatorCandidateParts }
): LocatorCandidate {
  const unique = matchCount === 1;
  const score =
    options.baseScore +
    (unique ? 20 : -30) +
    (options.stable ? 8 : -12) +
    Math.max(-16, 12 - Math.floor(value.length / 12));

  return {
    id: `${strategy}:${value}`,
    strategy,
    label,
    value,
    score,
    unique,
    matchCount,
    recommended: false,
    warnings: options.warnings ?? [],
    parts: options.parts
  };
}

function dedupeCandidates(candidates: LocatorCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.strategy}:${candidate.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFormControl(element: Element): boolean {
  return ["input", "textarea", "select"].includes(element.tagName.toLowerCase());
}

function labelTextFor(document: Document, element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeText(ariaLabel);

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (normalizeText(text)) return normalizeText(text);
  }

  const id = element.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (label?.textContent) return normalizeText(label.textContent);
  }

  const wrappingLabel = element.closest("label");
  if (wrappingLabel?.textContent) return normalizeText(wrappingLabel.textContent);

  const placeholder = element.getAttribute("placeholder");
  return placeholder ? normalizeText(placeholder) : "";
}

function uniqueIdSelector(target: Element): string | null {
  const id = target.getAttribute("id");
  if (!id || !isStaticId(id)) return null;
  return `#${cssEscape(id)}`;
}

function attributeSelector(target: Element, attribute: string): string | null {
  const value = target.getAttribute(attribute);
  if (!value) return null;
  return `${target.tagName.toLowerCase()}[${attribute}="${cssEscape(value)}"]`;
}

function stableHrefSelector(target: Element): string | null {
  if (target.tagName.toLowerCase() !== "a") return null;
  const href = target.getAttribute("href");
  if (!href || !isStableHref(href)) return null;
  return `a[href="${cssAttributeValue(href)}"]`;
}

function shortClassSelector(target: Element): string | null {
  const classList = stableClassNames(target);
  if (!classList.length) return null;
  return `${target.tagName.toLowerCase()}.${classList.slice(0, 2).map(cssEscape).join(".")}`;
}

function scopedCssSelectors(target: Element): Array<{ selector: string; baseScore: number }> {
  const targetDescriptors = targetCssDescriptors(target);
  if (!targetDescriptors.length) return [];

  const selectors: Array<{ selector: string; baseScore: number }> = [];
  let ancestor = target.parentElement;

  while (ancestor && ancestor !== target.ownerDocument.body) {
    const ancestorSelector = readableAncestorSelector(ancestor);
    if (ancestorSelector) {
      for (const targetDescriptor of targetDescriptors) {
        selectors.push({
          selector: `${ancestorSelector} ${targetDescriptor.selector}`,
          baseScore: targetDescriptor.baseScore
        });
      }
    }

    if (selectors.length >= 8) break;
    ancestor = ancestor.parentElement;
  }

  return selectors;
}

function targetCssDescriptors(target: Element): Array<{ selector: string; baseScore: number }> {
  return [
    { selector: isNameBearingElement(target) ? attributeSelector(target, "name") : null, baseScore: 72 },
    { selector: attributeSelector(target, "aria-label"), baseScore: 70 },
    { selector: attributeSelector(target, "aria-describedby"), baseScore: 68 },
    { selector: shortClassSelector(target), baseScore: 66 }
  ].filter((entry): entry is { selector: string; baseScore: number } => Boolean(entry.selector));
}

function readableAncestorSelector(element: Element): string | null {
  const id = element.getAttribute("id");
  if (id && isStaticId(id)) return `#${cssEscape(id)}`;

  const classList = stableClassNames(element);
  if (!classList.length) return null;

  return `${element.tagName.toLowerCase()}.${classList.slice(0, 2).map(cssEscape).join(".")}`;
}

function stableClassNames(element: Element): string[] {
  return Array.from(element.classList).filter(isHumanClassName);
}

function generatedClassFallbackSelector(target: Element): string | null {
  if (stableClassNames(target).length) return null;
  const classList = Array.from(target.classList).filter((className) => !isHumanClassName(className));
  if (!classList.length) return null;
  return `${target.tagName.toLowerCase()}.${classList.slice(0, 3).map(cssEscape).join(".")}`;
}

function isStaticId(id: string): boolean {
  return !GENERATED_ID_PATTERN.test(id) && !GENERATED_VALUE_PATTERN.test(id);
}

function isHumanClassName(className: string): boolean {
  return !GENERATED_CLASS_PATTERNS.some((pattern) => pattern.test(className));
}

function selectorUsesGeneratedClasses(selector: string): boolean {
  return selector
    .split(/\s+|>/)
    .flatMap((part) => part.match(/\.[A-Za-z0-9_-]+/g) ?? [])
    .map((classSelector) => classSelector.slice(1))
    .some((className) => !isHumanClassName(className));
}

function isBroadScopedBareTagSelector(selector: string): boolean {
  return /[#.][^\s>]+\s+[a-z]+$/i.test(selector);
}

function isNameBearingElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return ["input", "textarea", "select", "button"].includes(tagName);
}

function meaningfulAttributeSelectors(target: Element): Array<{ selector: string; baseScore: number }> {
  return [
    { selector: attributeSelector(target, "placeholder"), baseScore: 70 },
    { selector: attributeSelector(target, "title"), baseScore: 68 },
    { selector: attributeSelector(target, "alt"), baseScore: 68 },
    { selector: attributeSelector(target, "type"), baseScore: 62 }
  ].filter((entry): entry is { selector: string; baseScore: number } => Boolean(entry.selector));
}

function isStableHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#" || /^javascript:/i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed, "https://locator.local");
    const unstableParams = ["session", "sid", "token", "auth", "utm_source", "utm_medium", "utm_campaign", "fbclid", "gclid"];
    return !unstableParams.some((param) => url.searchParams.has(param));
  } catch {
    return false;
  }
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function structuralSelector(target: Element): string {
  const segments: string[] = [];
  let current: Element | null = target;

  while (current && current !== current.ownerDocument.body) {
    const tag = current.tagName.toLowerCase();
    const currentTagName = current.tagName;
    const parent: Element | null = current.parentElement;
    if (!parent) break;

    const siblings = Array.from(parent.children as HTMLCollectionOf<Element>).filter(
      (child) => child.tagName === currentTagName
    );
    const index = siblings.indexOf(current) + 1;
    segments.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);

    if (segments.length >= 4) break;
    current = parent;
  }

  return segments.join(" > ");
}

function queryCount(document: Document, selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function xpathFor(target: Element): string {
  const segments: string[] = [];
  let current: Element | null = target;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    const currentTagName = current.tagName;
    if (current === current.ownerDocument.body) {
      segments.unshift("body");
      break;
    }

    const parent: Element | null = current.parentElement;
    if (!parent) break;

    const siblings = Array.from(parent.children as HTMLCollectionOf<Element>).filter(
      (child) => child.tagName === currentTagName
    );
    const index = siblings.indexOf(current) + 1;
    segments.unshift(siblings.length > 1 ? `${tag}[${index}]` : tag);
    current = parent;
  }

  return `//${segments.join("/")}`;
}

function evaluateXPathCount(document: Document, xpath: string): number {
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return result.snapshotLength;
  } catch {
    return 0;
  }
}
