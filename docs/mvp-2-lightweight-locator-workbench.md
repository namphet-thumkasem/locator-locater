# MVP-2: Lightweight Locator Workbench

## Goal

MVP-2 keeps the product as a focused locator extraction tool. The app should help a user bring in page HTML or a rendered URL, click the element they care about, inspect ranked locator candidates, and copy a framework-ready snippet into their real test code.

MVP-2 is not a locator catalog. It should not ask users to create projects, save pages, maintain element collections, revalidate stored locators, or manage import/export archives.

## Primary Use Case

The main loop is:

1. Import a page snapshot from pasted HTML, a rendered HTML bundle, a URL, or the bookmarklet.
2. Preview the sanitized snapshot.
3. Click a target element.
4. Review ranked locators and warnings.
5. Copy a locator or action snippet for the selected framework.
6. Optionally test a manual selector against the current snapshot.

The user then takes the copied locator to their own test suite, page object, or automation codebase.

## Included

- HTML and rendered bundle input.
- URL rendering through the existing endpoint.
- Sanitized sandbox preview.
- Click-to-select target details.
- Ranked locator candidates and a recommended unique candidate.
- Framework snippet output for Playwright, Cypress, Selenium, Robot Framework, and generic output.
- Locator/action snippet modes.
- Minimal capture bookmarklet.
- Lightweight local restore of the last input and test id settings.
- Project-level-looking but app-local test id attribute settings, such as `data-testid`, `data-test`, `data-cy`, and `data-qa`.
- Manual locator tester for CSS, XPath, test id, and text selectors, showing match count, warnings, and highlighted matches in the preview.
- Fast copy actions for the selected selector, selected snippet, all generated candidates, manual selector, and manual snippet.

## Excluded

- Project catalog.
- Page storage.
- Saved elements.
- IndexedDB catalog persistence.
- Stored locator revalidation.
- Project JSON import/export.
- Rename/delete project/page/element flows.
- Collaboration, auth, server-side catalog storage, or cloud sync.
- Page object file generation.

## Manual Locator Tester

The manual tester is not a saved-candidate feature. It exists so a user can quickly answer:

- Does this CSS selector match the current snapshot?
- Is this XPath unique?
- Does this test id value exist?
- Is this text selector too broad?

Manual test results should be temporary and scoped to the active snapshot. They may be copied, but they are not saved.

## Acceptance Criteria

1. A user can import pasted HTML or a rendered bundle.
2. A user can render a URL through the endpoint and import the result.
3. A sanitized snapshot is previewed in a sandboxed iframe.
4. Clicking a button, input, link, or semantic control selects a sensible target.
5. Selected target details are shown without requiring catalog-style element management.
6. Up to five ranked locator candidates are shown.
7. The recommended candidate is unique when a unique candidate exists.
8. Changing framework and snippet mode updates the copied snippet.
9. The bookmarklet can be copied.
10. Test id attributes can be edited locally and affect generated candidates.
11. A manual CSS/XPath/test-id/text locator can be tested against the active snapshot with match count, warnings, and preview highlights.
12. Refreshing the browser restores only lightweight workbench state, not a catalog.
