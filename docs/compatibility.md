# Compatibility record

Initial target: OpenCode **2.2.5**, `@opencode/plugin` **2.2.5**,
OpenTUI **0.8.0**, Solid **1.9.17**, Bun **1.3.13**.

| Environment | Automated tests                                  | Packed OpenCode runtime                                                 |
| ----------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| macOS arm64 | Passed locally, including a clean frozen install | Loaded in OpenCode 2.2.5 from an extracted archive outside the checkout |
| Linux       | CI configured; not yet run                       | Not verified                                                            |
| Windows     | Not verified                                     | Not verified                                                            |

Do not infer support for future OpenCode releases from peer ranges. The peers
describe the development/runtime contract, not a guarantee of host API stability.
OpenCode V1 is unsupported. Tests use the official renderer at 28 columns, with
Unicode titles, click navigation and lifecycle cleanup.

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

Lifecycle transitions, reconnect, deletion races, narrow Unicode layout and
dispose are covered automatically. Interactive failure/interruption and real
network reconnection have not been exercised; do not treat unit tests as those
manual checks.
