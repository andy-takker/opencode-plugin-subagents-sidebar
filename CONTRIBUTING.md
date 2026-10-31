# Contributing

Biome's recommended lint rules are enabled. The DOM-specific static-element
interaction rule is disabled only for `src/tui.tsx`: OpenTUI terminal elements
use mouse handlers without HTML roles.

Use Bun **1.3.13**, Node **24** with npm, and macOS or Linux. Start from a feature
branch, run `bun install --frozen-lockfile`, then `bun run check` and
`bun run package:check`. Use `bun run format` before committing. Individual
commands are `bun test`, `bun run typecheck`, `bun run lint`, and
`bun run format:check`.

Keep public APIs typed from the official SDK. Keep tree logic independent of
OpenCode and rendering. Add a regression test for behavior changes, using the
real OpenTUI test renderer for interactions. Avoid timers and snapshot-only
tests. See [architecture](docs/architecture.md) for lifecycle invariants.

Dependency changes must update `bun.lock` and pass a frozen install. SDK and
OpenTUI changes require a packed-plugin smoke test in OpenCode; unit tests alone
do not establish runtime compatibility. Document newly tested versions in
[compatibility](docs/compatibility.md).

PRs should state the user-visible change, tests run and compatibility impact.
Keep unrelated refactors separate. Use the issue templates for bugs and ideas;
follow [SECURITY](SECURITY.md) for vulnerabilities. Contributions are under MIT.
