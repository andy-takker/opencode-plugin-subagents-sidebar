# Compatibility record

Initial target: OpenCode **2.2.5**, `@opencode/plugin` **2.2.5**,
OpenTUI **0.8.0**, Solid **1.9.17**, Bun **1.3.13**.

| Environment | Automated tests                                  | Packed OpenCode runtime                                                 |
| ----------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| macOS arm64 | Passed locally, including a clean frozen install | Loaded in OpenCode 2.2.5 from an extracted archive outside the checkout |
| Linux       | Passed in GitHub Actions                         | Not verified                                                            |
| Windows     | Not verified                                     | Not verified                                                            |

Do not infer support for future OpenCode releases from peer ranges. The peers
describe the development/runtime contract, not a guarantee of host API stability.
OpenCode V1 is unsupported. Tests use the official renderer at 28 columns, with
Unicode titles, click navigation and lifecycle cleanup.

[CI run 41196041900](https://github.com/andy-takker/opencode-plugin-subagents-sidebar/actions/runs/41196041900)
passed on both `ubuntu-latest` and `macos-latest` at commit `491a81c`:
frozen install, strict types, lint, formatting, all 29 tests, and package checks.

Before expanding this matrix, load the actual npm archive outside the checkout,
confirm its section and navigation in OpenCode, test running/finished transitions,
and check CLI logs for resolver or renderer errors. Record date/version/platform
and distinguish automated tests from manual interaction.

## 2026-10-31 smoke test

An isolated tmux terminal loaded the extracted package with no package-local
`node_modules`, using `OPENCODE_CLI_CONFIG_CONTENT`. The section rendered both an
empty current tree and an existing family with running and completed children.
Opening a child retained the root family. A sidebar mouse click opened the host's
child-session viewer. The global local-path configuration was also checked beside
the existing Orca TUI plugin. No resolver/renderer error was observed in these
screens; the package relied on host-provided runtime modules.

A newly launched review subagent appeared automatically as Running and changed
to Done after completion in the global-config terminal.

The final archive was loaded again after adding collapsed-by-default behavior.
Its `▶ Subagents` header uses the same arrow as the host MCP header; clicking
expands to `▼ Subagents` and displays the completed review task.

Lifecycle transitions, reconnect, deletion races, narrow Unicode layout and
dispose are covered automatically. Interactive failure/interruption and real
network reconnection have not been exercised; do not treat unit tests as those
manual checks.

## 2026-11-01 v0.2.0 verification

The release preparation passes 126 tests (395 assertions), strict types,
recommended lint, formatting, a frozen install and the exact archive allowlist
check. Feature PRs #12–#18 passed Linux/macOS CI, including artifact round trips.

On macOS arm64, OpenCode 2.2.5 loaded the v0.2.0 archive extracted outside the
checkout with no package-local `node_modules`. The collapsed count and expanded
All list restored nine completed tasks with aligned statuses and frozen durations.
`/subagents` opened the chooser; searching and pressing Enter opened the host's
child-session viewer, and Escape returned to the parent. A recent CLI log-tail
check found no error entries referencing that extracted package; this is not a
claim that every host log was error-free.

The same extracted archive then displayed a newly resumed review as Running and
restored a real nested review child under its parent with a `└─` connector; both
finished as Done with frozen durations. Clicking the nested row opened the host
child viewer. In another terminal, the extracted plugin ran beside the existing
Orca TUI plugin. The host session switcher changed from the eleven-descendant
family to an existing empty root and back, restoring the original tree. Executing
`/reload` retained a single working sidebar section and complete nested tree;
navigation worked afterwards. The user's global configuration was not changed.
A final recent CLI log-tail check again found zero errors referencing the package.

Prior feature smoke checks also exercised a real Running clock and Active
filtering, the palette command with the sidebar hidden, cancellation and focus
restoration. Confirmed Waiting transitions are covered by typed integration and
real OpenTUI renderer tests, not by a live human permission flow in this release
smoke check. The README GIF uses demonstration fixtures in Warp with the actual
plugin components; it is a UI demonstration, not host compatibility evidence.
Windows and a Linux host runtime remain unverified.
