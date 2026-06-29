# Locator-Aware Snapshot Sanitization

Imported HTML is sanitized before becoming a Page Snapshot by removing executable content and sensitive values while preserving locator-relevant attributes, normalized text, and enough styling context for accurate target selection. This balances safety with the product need for a Snapshot Preview that still resembles the captured UI.
