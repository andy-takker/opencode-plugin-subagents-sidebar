# Changelog

## Unreleased

- Ignore confirmed unrelated session events without reloading the visible tree.
  Resolve unknown ancestry with bounded, deduplicated metadata reads while
  preserving new-child discovery and full reconnect recovery.

## 0.1.0 — 2026-10-31

First public GitHub release. The npm package has not been published.

- Add a clickable, theme-aware subagent section to the OpenCode V2 sidebar.
- Start collapsed with total/running counts; toggle the header to expand or collapse.
- Restore complete nested trees with pagination and active-first ordering.
- Track running and terminal outcomes with reconnect, retry and cleanup support.
- Add typed integration, lifecycle and real-renderer tests, package verification,
  Linux/macOS CI and an OIDC release workflow.
- Initial integration target: OpenCode 2.2.5; see `docs/compatibility.md`.
