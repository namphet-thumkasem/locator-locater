# MVP-1: Locator Workbench

## Goal

Build the first playable version of the locator tool as a Next.js workbench. MVP-1 proves the core loop: paste page HTML or render a page URL, preview a sanitized page snapshot, click an action target, generate ranked locator candidates, and copy framework snippets.

MVP-1 is not the catalog product yet. It should feel useful enough to test locator quality before adding durable project/page/element storage.

## Implementation Status

Status as of 2026-06-26: MVP-1 is implemented as a Next.js workbench with a small URL ingestion endpoint.

The playable acceptance loop is covered:

- Import raw HTML or rendered HTML bundle.
- Render a page URL through the workbench endpoint, execute page JavaScript in Chromium, capture the rendered DOM, inline linked stylesheets on a best-effort basis, and import it as a rendered HTML bundle.
- Sanitize and preview the page snapshot in a sandboxed iframe.
- Click a preview target and select the nearest action target.
- Show selected target details, element chain adjustment, and ranked locator candidates.
- Recommend a unique candidate when available.
- Format locator/action snippets for Playwright, Cypress, Selenium, Robot Framework, and generic output.
- Copy the minimal capture bookmarklet with clipboard and manual fallback behavior.
- Restore the last workbench input from browser storage.

Hardening completed before MVP-2:

- Candidate-level limitation warnings are visible in the inspector.
- Unit coverage includes sanitizer/input parsing, locator ranking, duplicate/compound cases, framework fallbacks, formatter action modes, and bookmarklet fallback behavior.

## Scope

MVP-1 includes:

- A single workbench input that auto-detects either raw HTML or a rendered HTML bundle.
- Snapshot sanitization that removes executable content while preserving enough structure and inline styling for target selection.
- A sandboxed snapshot preview rendered from the page snapshot, not a live third-party iframe.
- Click-to-select action target behavior, defaulting to the nearest semantic or interactive ancestor.
- An element chain panel so the user can adjust the selected target when the visual preview is imperfect.
- Locator candidate generation with at most five ranked candidates.
- A recommended candidate when a unique candidate exists.
- URL ingestion through a small Next.js endpoint that renders pages in Chromium.
- Framework snippet copy for Playwright, Cypress, Selenium, and generic output.
- Snippet modes for locator expression and common action.
- A minimal capture bookmarklet that produces a rendered HTML bundle.
- Convenience restore of the last workbench input/result from browser storage if simple to add.

MVP-1 excludes:

- Durable project/page/element catalog storage.
- Manual locator candidates.
- Revalidation of saved locators.
- Project import/export.
- Browser extension support.
- Full shadow DOM or iframe locator support.
- Page object file generation.

## Stack

- Next.js with React and TypeScript.
- The workbench remains browser-owned for locator state.
- URL ingestion uses a small Next.js API route to render the URL in Chromium, execute page JavaScript, capture the rendered DOM, inline reachable linked stylesheets within size limits, and return a rendered HTML bundle shape.
- Vercel remains the intended deployment target.
- Do not add auth, database, or catalog plumbing for MVP-1.
- Use a DOM accessibility helper library for role/name semantics rather than hand-rolling accessible-name rules. Prefer `dom-accessibility-api` plus ARIA role metadata unless implementation finds a clearly better maintained equivalent.
- Use browser DOM APIs for snapshot querying, CSS validation, XPath validation, and preview interaction.

## Workbench Input

Use a source panel with HTML and URL modes.

HTML mode:

- If the pasted value parses as JSON and has an `html` string field, treat it as a rendered HTML bundle.
- Otherwise treat the pasted value as HTML source.
- If JSON parses but lacks a valid `html` field, show a format error.

URL mode:

- POST the URL to a small Next.js endpoint.
- Render the URL server-side in Chromium to avoid browser CORS limits and support JavaScript-rendered apps.
- Return the same rendered HTML bundle shape used by bookmarklet capture.
- Feed the returned bundle into the same snapshot sanitization and preview flow as pasted bundles.

Rendered HTML bundle shape:

```json
{
  "html": "<!doctype html>...",
  "url": "https://example.test/dashboard",
  "title": "Dashboard",
  "capturedAt": "2026-06-25T00:00:00.000Z",
  "viewport": {
    "width": 1440,
    "height": 900
  },
  "ingestion": {
    "mode": "rendered-dom",
    "stylesheetsInlined": 1,
    "stylesheetsSkipped": 0,
    "scriptsDetected": 12,
    "warnings": ["URL capture executed page JavaScript in Chromium, then froze the rendered DOM for sandbox preview."]
  }
}
```

Metadata should be shown when present but should not be required.

## Snapshot And Preview

Create a page snapshot from imported HTML by applying snapshot sanitization:

- Remove scripts and executable event handler attributes.
- Remove sensitive input values, especially password or token-like values.
- Keep locator-relevant attributes such as `id`, `name`, `type`, `role`, `aria-*`, `alt`, `title`, `placeholder`, `for`, built-in test id attributes, and useful `data-*`.
- Keep class attributes.
- Preserve sanitized inline styling: `style` tags, `style` attributes, and class attributes.
- URL ingestion renders the page server-side and may fetch linked stylesheets server-side to inline them into the imported bundle. The snapshot preview itself should not fetch external stylesheets or external resources for visual fidelity.

Minimum sanitizer contract:

- Remove `script`, `noscript`, `iframe`, `object`, `embed`, external `link` stylesheets, and meta refresh.
- Remove executable attributes such as `on*` handlers.
- Remove or neutralize URL-bearing resource attributes that would fetch external content, including `src`, `srcset`, `poster`, and CSS `url(...)` references.
- Remove CSS `@import` rules and `javascript:` URLs.
- Preserve locator-bearing links through `href` only when they are non-executable; otherwise remove the value.

Render the page snapshot in a sandboxed iframe as a snapshot preview. Use `srcdoc` and a restrictive sandbox with scripts disabled. This iframe is for selecting action targets from sanitized content, not for embedding or inspecting live websites.

## Selection Model

When the user clicks in the snapshot preview:

- Select the nearest action target by default, usually the closest semantic or interactive ancestor such as `button`, `a`, `input`, `textarea`, `select`, or an element with strong ARIA semantics.
- Show the clicked node and selected action target through an element chain.
- Allow the user to adjust the selected target via the element chain.

## Locator Candidates

Generate at most five ranked locator candidates for the selected action target.

MVP-1 strategies:

- `testId`: built-in defaults `data-testid`, `data-test`, `data-cy`.
- `role`: semantic role/name when confidently derived.
- `label`: form controls with label, aria-label, or placeholder.
- `text`: normalized text for unique text-based candidates.
- `css`: short unique CSS fallback.
- `xpath`: fallback when other candidates are weak.

Do not include visual locators, AI-generated locators, manual candidates, shadow DOM locators, or frame locators in MVP-1.

## Ranking And Validation

Use snapshot validation, not framework runtime validation.

Ranking rules:

- A recommended candidate must be unique in the page snapshot when possible.
- Uniqueness is the first gate.
- Semantic and test-id candidates outrank structural CSS/XPath candidates.
- Stable attributes outrank generated-looking values.
- Shorter readable selectors outrank long structural selectors.
- Framework selection should affect formatted output, not the core candidate score.

Locator priority:

1. `data-testid`, `data-cy`, `data-qa`, `data-test`.
2. Static-looking `id` attributes only, such as `submit-btn`, `login-form`, or `email-input`.
3. ARIA attributes and roles, such as `aria-label`, `role`, and `aria-describedby`.
4. Stable `href` attributes for links, without obvious tracking/session parameters.
5. `name` attributes for inputs, textareas, selects, and buttons.
6. Human-written class names that are readable and not generated.
7. Tag plus meaningful attribute combinations.
8. Stable ancestor plus unique child attribute combinations.
9. Short text content only when it is unlikely to change.
10. Generated/framework class fallback, such as `.css-abc123`, `.MuiBox-root`, `.sc-xyz`, and `.styles__Button`, only when no better stable selector exists.
11. Compound generated/framework class fallback plus short text, such as `div.MuiBox-root.css-dq5rxc hasText "Save"`, before positional selectors.
12. XPath and positional CSS such as `:nth-child` and `:nth-of-type` only as a last resort.

Avoid unstable selector parts unless they are the best remaining fallback:

- Auto-incremented IDs such as `#ember123`, `#react-select-2`, `#mui-123`, and `#popper-456`.
- Full absolute XPath such as `//html/body/div[1]/div[2]/...`.
- Positional selectors when a stable attribute or readable scoped selector exists.

Generated/framework classes may be emitted as a lower-priority CSS fallback with a warning when they are still better than positional selectors.

XPath candidates should not be recommended while any unique non-XPath candidate exists, including CSS plus text compound candidates.

Minimum semantic contract:

- Role and label candidates should use the chosen accessibility helper library.
- Do not emit role or label candidates with empty names unless the role itself is enough to be useful and unique.
- Treat duplicate semantic names as valid candidates but not recommended unless another qualifier makes them unique.
- Text candidates use normalized text from the page snapshot and should not claim browser-visible text accuracy.

Validation behavior:

- CSS and test-id candidates validate with DOM querying.
- XPath candidates validate with `document.evaluate`.
- Role, label, and text candidates validate with snapshot-based accessibility/text approximations.

## Snippet Output

Framework support tiers:

- Playwright is primary.
- Cypress is supported.
- Selenium is supported-basic, mostly CSS/XPath-oriented.
- Generic output supports raw CSS/XPath/test-id style expressions.

Snippet modes:

- Locator snippet: expression only.
- Action snippet: expression plus common action such as click, fill, or check when element type makes that obvious.

For MVP-1, copy should work for the main cases. If a selected candidate cannot be represented faithfully in a framework, the formatter should either use the best unique CSS/XPath fallback candidate or show a minimal compatibility warning instead of producing misleading code. Warning polish can wait for hardening.

## Minimal Capture Bookmarklet

Provide a minimal bookmarklet helper in MVP-1:

- User can copy bookmarklet code from the app.
- Bookmarklet captures `document.documentElement.outerHTML`.
- Bookmarklet adds metadata: `location.href`, `document.title`, `capturedAt`, and viewport size.
- Bookmarklet copies the rendered HTML bundle JSON to clipboard.
- If clipboard write fails, it falls back to a prompt where the user can copy the bundle manually.

Do not auto-send data to the app, compress payloads, inline computed styles, or capture a selected element in MVP-1.

## UI Layout

Use a three-pane workbench layout on desktop:

- Left: workbench input, bookmarklet helper, and source metadata.
- Center: snapshot preview with selected action target outline.
- Right: selected target details, element chain, locator candidates, framework selector, snippet mode selector, and copy action.

For smaller screens, panels may stack or become tabs, but desktop is the primary MVP target.

## Acceptance Criteria

The first playable MVP-1 is accepted when:

1. Pasted HTML or rendered HTML bundle can be imported.
2. A sanitized page snapshot is created and previewed.
3. Clicking a button, input, or link selects a sensible action target.
4. The element chain is shown and can adjust the target.
5. Up to five locator candidates are generated.
6. The recommended candidate is unique in the snapshot when such a candidate exists.
7. Changing framework and snippet mode updates copied code.
8. The minimal capture bookmarklet can produce a rendered HTML bundle, with a manual fallback.
9. A URL can be fetched through the workbench endpoint and imported into the same snapshot preview flow.

Before moving into MVP-2, harden:

- Warning quality for text, semantic, visual fidelity, shadow boundary, and frame boundary limitations.
- Unit coverage for locator engine, scoring, formatters, duplicate cases, and bundle parsing.

## Future MVP-2

MVP-2 continues the lightweight locator extraction workflow rather than introducing the catalog. It is tracked in `docs/mvp-2-lightweight-locator-workbench.md`.

MVP-2 adds:

- Editable test id attribute settings for candidate generation.
- A temporary manual locator tester for CSS, XPath, test id, and text selectors.
- Better copy-focused workflows around generated and manual locators.
- Lightweight local restore of the current workbench input and settings.

The catalog direction is deferred until there is a proven need for durable project/page/element collections.
