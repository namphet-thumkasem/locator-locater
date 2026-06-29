# Locator Catalog

This context defines the language for a local-first tool that captures web page structure, generates automation locators, and stores locator knowledge for reuse.

## Language

**Project**:
A local catalog boundary that groups related pages and saved locators for one application or automation target.
_Avoid_: Workspace, repository

**Page**:
A named screen or page state within a project, used as the scope for element keys and locator validation.
_Avoid_: URL, route, webpage

**Page Key**:
An identifier-safe name for a page, unique within its project and suggested from capture metadata before user confirmation.
_Avoid_: Page name, URL slug, route name

**HTML Source**:
The original HTML input provided by a user paste or fetched from a public/static URL before the app inspects or normalizes it.
_Avoid_: DOM snapshot, page, source

**Rendered Page**:
The browser-produced DOM after scripts, styles, and runtime rendering have affected the page.
_Avoid_: Snapshot, raw HTML

**Page Snapshot**:
A sanitized and normalized representation of page structure used as the source of truth for locator generation and validation.
_Avoid_: DOM snapshot, raw HTML, rendered page

**Locator Candidate**:
A possible locator for a selected element, including its strategy, value, validation result, score, and warnings.
_Avoid_: Selector, locator

**Preferred Locator Candidate**:
The locator candidate chosen as the primary locator for a saved element.
_Avoid_: Final selector, chosen selector

**Locator Candidate Set**:
The collection of locator candidates generated and retained for a saved element.
_Avoid_: Selector list, locator list

**Action Target**:
The element the user most likely intends to automate when clicking in the preview, usually the nearest semantic or interactive ancestor of the clicked node.
_Avoid_: Clicked node, selected DOM node

**Element Key**:
An identifier-safe name for a saved action target, unique within its page and used to recognize the element in the catalog and future generated automation code.
_Avoid_: Element name, display name, label

**Needs Review**:
A saved element state indicating that its preferred locator candidate no longer validates uniquely against the active page snapshot and requires user confirmation before changing.
_Avoid_: Broken, auto-fixed

**Element Status**:
The catalog health state of a saved element: valid, needs review, or unvalidated.
_Avoid_: Broken state, locator status

**Unvalidated**:
A saved element state indicating that the preferred locator candidate has not yet been checked against the active page snapshot.
_Avoid_: Unknown, pending

**Normalized Text**:
Text derived from a page snapshot by trimming and collapsing whitespace for locator generation, without claiming full browser-visible text accuracy.
_Avoid_: Visible text, text content

**Test Id Attribute**:
A project-level attribute name used to generate test-id locator candidates, with default values and support for multiple custom attributes.
_Avoid_: Hardcoded test id, selector attribute

**Catalog Data**:
The user's saved projects, pages, page snapshots, elements, locator candidate sets, and preferences stored locally in the browser.
_Avoid_: Server data, shared catalog

**Project Export**:
A JSON file containing one project's pages, active page snapshots, saved elements, locator candidate sets, and project-level settings.
_Avoid_: Full backup, shared database

**Shadow Boundary Warning**:
A warning shown when selected content appears to involve shadow DOM that v1 cannot fully model or format across frameworks.
_Avoid_: Shadow DOM support, web component support

**Frame Boundary Warning**:
A low-priority warning shown when selected content appears to involve an iframe that v1 cannot inspect as part of the page snapshot.
_Avoid_: Iframe support, frame locator support

**URL Ingestion**:
The server-side process that fetches an HTML source from a user-provided URL for conversion into a page snapshot.
_Avoid_: Browser fetch, crawler, scraper

**Rendered HTML Paste**:
An HTML source copied from an already-rendered page by the user, used as the v1 escape hatch for authenticated or client-rendered pages.
_Avoid_: Live iframe, authenticated URL capture

**Snapshot Preview**:
The sandboxed iframe view of a page snapshot used for selecting action targets, not a live embedded website.
_Avoid_: Live iframe, browser tab

**Capture Bookmarklet**:
A user-installed browser bookmarklet that copies rendered page HTML from the current tab for use as rendered HTML paste.
_Avoid_: Browser extension, live capture

**Rendered HTML Bundle**:
Rendered HTML plus capture metadata such as URL, title, capture time, and viewport, produced by a capture bookmarklet or equivalent manual capture.
_Avoid_: HTML paste, page snapshot

**Workbench Input**:
The pasted content accepted by the locator workbench, interpreted as either an HTML source or a rendered HTML bundle.
_Avoid_: Import source, upload

**Snapshot Sanitization**:
The process of removing executable or sensitive content from imported HTML while preserving enough structure, attributes, text, and styling context for accurate action target selection.
_Avoid_: HTML cleanup, minification

**Preserved Inline Styling**:
Sanitized inline style information retained in a page snapshot, including style tags, style attributes, and class attributes, without fetching external stylesheets.
_Avoid_: External CSS capture, full visual fidelity

**Element Chain**:
A structural chain of the clicked node and its relevant ancestors used to inspect or adjust the selected action target when the visual preview is insufficient.
_Avoid_: Breadcrumb, DOM tree

**Snippet Mode**:
The copy output style for a locator candidate, either a locator expression or a common action using that locator.
_Avoid_: Export type, code generation

**Framework Formatter**:
A converter that turns a locator candidate into automation code for a specific framework and snippet mode.
_Avoid_: Exporter, generator

**Framework Compatibility Warning**:
A warning shown when a locator candidate cannot be represented faithfully or idiomatically in the selected framework.
_Avoid_: Formatter error, unsupported selector

**Manual Locator Candidate**:
A locator candidate added by the user rather than generated by the locator engine, still stored and validated as part of the locator candidate set.
_Avoid_: Custom selector, override
