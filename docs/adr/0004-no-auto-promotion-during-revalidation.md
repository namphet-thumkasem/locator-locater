# No Auto-Promotion During Revalidation

Status: Superseded for MVP-2 by ADR 0029. This rule applies only if a durable locator catalog is introduced later.

When a preferred locator candidate no longer validates uniquely, the saved element is marked Needs Review and replacement candidates may be suggested, but the preferred candidate is not changed automatically. This protects the locator catalog from silently changing test intent when the page structure drifts.
