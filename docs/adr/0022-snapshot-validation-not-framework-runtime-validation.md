# Snapshot Validation Not Framework Runtime Validation

MVP-1 validates locator candidates against the Page Snapshot rather than running each target automation framework. CSS, test id, and XPath use DOM querying, while semantic candidates use snapshot-based accessibility approximations and compatibility warnings communicate framework gaps.
