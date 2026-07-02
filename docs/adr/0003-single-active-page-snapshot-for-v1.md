# Single Active Page Snapshot For V1

Status: Superseded for MVP-2 by ADR 0029. MVP-2 uses only the active workbench snapshot and does not persist pages.

For the first version, each Page keeps one active Page Snapshot rather than a snapshot history. The snapshot still records capture time and a content hash so locator validation has provenance, while avoiding history management until the core catalog workflow is proven.
