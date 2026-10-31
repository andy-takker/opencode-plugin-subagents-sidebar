# OpenCode Subagents Sidebar

See the subagents in your current session tree, including nested tasks, directly
in the OpenCode terminal sidebar. Click a task to open its session.

**Status: 0.1.0 unreleased.** No npm release is available yet.

Example captured from the real OpenTUI renderer (28 columns):

```text
Subagents
Research API            Done
```

- Running tasks appear first; finished tasks stay visible.
- Navigating into a child keeps the same tree. Switching roots changes the list.
- Restores existing tasks, follows lifecycle events, and uses your current theme.
- Text statuses: `Running`, `Done`, `Error`, `Interrupted`, `Idle`, `Unknown`.
  Idle does not imply success.

## Install locally

Initial target: **OpenCode V2 2.2.5**. See the
[compatibility record](docs/compatibility.md) for verified environments and limits.
Clone this repository and install development dependencies with Bun 1.3.13:

```sh
git clone https://github.com/andy-takker/opencode-plugin-subagents-sidebar.git
cd opencode-plugin-subagents-sidebar
bun install --frozen-lockfile
bun run check
bun run package:check
pwd
```

Back up `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`).
Append the **absolute directory path printed by `pwd`** to its existing `plugins`
array. For example, replacing the example path with your own:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-plugin-subagents-sidebar"],
  "session": { "sidebar": "auto" }
}
```

Preserve your other plugins and settings. OpenCode watches this file; use
`/reload` if needed. Open a session and widen the terminal enough for OpenCode's
sidebar to appear. `Subagents` shows `No subagents` until the tree has children.

### npm installation (after the first release)

Once published, add `"opencode-plugin-subagents-sidebar@0.1.0"` to the same
`cli.json` array instead of the local path. Do not add both entries.
This is a TUI-only plugin; it does not go in the server's `opencode.json`.

## Update or disable

For a local checkout, update its branch, run `bun install --frozen-lockfile`, then
`bun run check` and `/reload`. For npm, change the pinned version in `cli.json`
after reading its release notes. Remove this plugin's array entry to disable it;
session history is retained by OpenCode.

## Troubleshooting

- No sidebar: check `session.sidebar`, terminal width, and that a session is open.
- `Unable to load subagents`: click `Retry`; check your connected server is reachable.
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
