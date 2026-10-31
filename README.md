# OpenCode Subagents Sidebar

[![CI](https://github.com/andy-takker/opencode-plugin-subagents-sidebar/actions/workflows/ci.yml/badge.svg)](https://github.com/andy-takker/opencode-plugin-subagents-sidebar/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/andy-takker/opencode-plugin-subagents-sidebar)](https://github.com/andy-takker/opencode-plugin-subagents-sidebar/releases/latest)
[![MIT license](https://img.shields.io/github/license/andy-takker/opencode-plugin-subagents-sidebar)](LICENSE)
[![OpenCode V2](https://img.shields.io/badge/OpenCode-V2%202.2.5-18181b)](docs/compatibility.md)

**A live subagent monitor for the OpenCode terminal UI.** Track parallel AI agents,
nested tasks and execution status in a collapsible sidebar. Click any task to
open its session without losing sight of the rest of the session tree.

[Installation](#installation) · [Features](#features) ·
[Compatibility](docs/compatibility.md) · [Contributing](CONTRIBUTING.md) ·
[Report a bug](https://github.com/andy-takker/opencode-plugin-subagents-sidebar/issues/new?template=bug_report.yml)

**Latest GitHub release: [v0.1.0](https://github.com/andy-takker/opencode-plugin-subagents-sidebar/releases/tag/v0.1.0).**
No npm release is available yet.

## Demo

![OpenCode running in Warp: collapsed subagent count updates live, then the expanded sidebar shows completed review tasks](https://raw.githubusercontent.com/andy-takker/opencode-plugin-subagents-sidebar/main/docs/assets/demo.gif)

Captured from a real OpenCode session in **Warp**. Time-compressed: a review agent
starts while the list is collapsed, then the expanded list shows completed tasks.
The recording is cropped to the sidebar; no conversation content is included.

## Features

Collapsed by default; click the arrow or header to expand the list:

```text
▶ Subagents · 5 · 2 running
```

Expanded example:

```text
▼ Subagents · 1
Research API            Done
```

- Counts keep updating while collapsed. The expanded/collapsed choice survives
  navigation for this plugin context; restarting OpenCode or reloading the plugin resets it.
- Running tasks appear first; finished tasks stay visible.
- Navigating into a child keeps the same tree. Switching roots changes the list.
- Restores existing tasks, follows lifecycle events, and uses your current theme.
- Text statuses: `Running`, `Done`, `Error`, `Interrupted`, `Idle`, `Unknown`.
  Idle does not imply success.

## Installation

Tested with **OpenCode V2 2.2.5**. CI runs on Linux and macOS; see the
[compatibility record](docs/compatibility.md) for host verification and limits.

### GitHub release

Download `opencode-plugin-subagents-sidebar-0.1.0.tgz` from the GitHub release,
extract it to a permanent directory, and add the absolute path of the extracted
`package` directory to `cli.json` as shown below. OpenCode supplies the runtime;
the release archive does not need a separate dependency installation.

### Source checkout

Clone this repository and install development dependencies with Bun 1.3.13:

```sh
git clone --branch v0.1.0 https://github.com/andy-takker/opencode-plugin-subagents-sidebar.git
cd opencode-plugin-subagents-sidebar
bun install --frozen-lockfile
bun run check
bun run package:check
pwd
```

### Enable the plugin

Back up `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`).
Append the **absolute path to the extracted `package` directory or source checkout**
to its existing `plugins` array. Replace the example path with your own:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-plugin-subagents-sidebar"],
  "session": { "sidebar": "auto" }
}
```

Preserve your other plugins and settings. OpenCode watches this file; use
`/reload` if needed. Open a session and widen the terminal enough for OpenCode's
sidebar to appear. Expand `Subagents` to see the list, or `No subagents` when empty.

### npm installation (not yet available)

Once published, add `"opencode-plugin-subagents-sidebar@0.1.0"` to the same
`cli.json` array instead of the local path. Do not add both entries.
This is a TUI-only plugin; it does not go in the server's `opencode.json`.

## Update or disable

For a local checkout, update its branch, run `bun install --frozen-lockfile`, then
`bun run check` and `/reload`. For npm, change the pinned version in `cli.json`
after reading its release notes. Remove this plugin's array entry to disable it;
session history is retained by OpenCode.

For a release archive, extract the new version into a new permanent directory,
update the plugin path in `cli.json`, and use `/reload`. For a tagged checkout,
fetch tags and switch to the desired release tag before running the checks.

## Troubleshooting

- No sidebar: check `session.sidebar`, terminal width, and that a session is open.
- `Error` in the header: expand it and click `Retry`; check your connected server is reachable.
- No section: verify the package path and inspect
  `~/.local/share/opencode/log/opencode.log` for plugin loading errors.
- Include OpenCode version, OS, installation method and reproduction steps in an
  [issue](https://github.com/andy-takker/opencode-plugin-subagents-sidebar/issues).
  Remove private task names, paths and credentials from logs.

The plugin reads session metadata through OpenCode's authenticated client; it
does not read messages, modify sessions, poll on a timer, or send telemetry.

## Development

```sh
bun install --frozen-lockfile
bun run check          # types, lint, formatting, tests
bun run package:check  # inspect actual npm archive and internal imports
bun run format        # apply formatting
```

See [CONTRIBUTING](CONTRIBUTING.md), [architecture](docs/architecture.md),
[release process](docs/releases.md), [changelog](CHANGELOG.md) and
[security policy](SECURITY.md). MIT licensed.
