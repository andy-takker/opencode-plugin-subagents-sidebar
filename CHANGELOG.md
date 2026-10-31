# Changelog

## 0.2.1 — 2026-11-01

- Fix npm-name loading in OpenCode 2.2.5 by publishing precompiled Solid JavaScript
  instead of raw TSX. Runtime packages remain external and host-owned.
- Add a packed `node_modules` renderer/navigation regression. Source checkouts
  now require `bun run build` after changes (included in `bun run check`).

## 0.2.0 — 2026-11-01

Complete session-tree monitoring and keyboard navigation. Nested rows are now
grouped parent-first rather than globally sorted by activity; Active can include
separately counted inactive ancestors. Public package exports are unchanged.

- Add the **Open subagent** command and `/subagents` for searchable, keyboard-only
  navigation through the current session tree, with live state and guarded opening.

- Group nested subagents into an active-subtree-first tree with bounded `tree`-style
  connectors. Active retains muted, separately counted ancestors for context.

- Align statuses and durations in separate shared columns, including mixed
  duration lengths and clock updates, while preserving title truncation.

- Show latest-execution duration beside each status, with rerun reset, frozen
  completion time and unknown-time handling. Update visible ongoing timers
  locally without polling, and clean up clocks when hidden or disposed.

- Show confirmed pending permissions/forms as Waiting, include Waiting in Active,
  and show disjoint running/waiting/error counts while collapsed. Restore pending
  state on reconnect; surface failed reads and bound/drain pending-request I/O.

- Add an All/Active filter with live counts, All by default, and a per-context
  preference. History remains available through All.

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
