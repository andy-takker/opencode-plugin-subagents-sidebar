# Releases

The package is **unreleased**. Publishing a GitHub release triggers npm publishing;
do not publish a release until the following preparation and smoke test are done.

## One-time setup

The repository is `andy-takker/opencode-plugin-subagents-sidebar`. Verify npm
ownership of the exact unscoped name; a registry 404 is not a reservation.
The first publication may require a maintainer's interactive npm login/2FA to
establish package ownership before package-level trusted publishing is available.
Do not commit or store an npm token in this repository.

In the npm package's Settings → Trusted publishing, configure GitHub Actions:

- Owner: `andy-takker`
- Repository: `opencode-plugin-subagents-sidebar`
- Workflow filename: `release.yml`
- Environment: `npm`
- Allow direct `npm publish` (new trust configurations default to stage-only).

Create the `npm` GitHub environment. The workflow uses GitHub-hosted runners,
Node 24 and npm 11.21.0 (OIDC requires npm >=11.5.1 and Node >=22.14.0).
A new trust configuration must complete its first publish within two days or be
recreated. See [npm's current requirements](https://docs.npmjs.com/trusted-publishers).

## Each release

1. Update `package.json`, `bun.lock` if needed and CHANGELOG. In 0.x, breaking
   changes increment minor, compatible fixes increment patch. Version is owned
   by `package.json`; the tag must be exactly `v${package.version}`.
2. Run `bun install --frozen-lockfile`, `bun run check`, and
   `bun run package:check --output release.tgz` (choose a new output path).
3. Extract the archive into a fresh directory and load that directory using
   `OPENCODE_CLI_CONFIG_CONTENT` with an absolute path in its `plugins` array.
   Open a root with nested children; verify titles, running/terminal statuses,
   click navigation, switching trees, reload and coexistence with other plugins.
   Check CLI logs. Update the compatibility record with actual evidence.
4. Merge the reviewed change, wait for both CI platforms, tag the reviewed commit,
   and publish a GitHub release with compatibility notes. Publication is an
   explicit maintainer action. Prerelease GitHub releases are excluded by this
   initial workflow; design dist-tag handling before adding prereleases.
5. The release workflow checks tag/version equality, runs all checks on Linux
   and macOS, and uploads the verified Linux tarball. A separate job publishes
   those exact bytes with `--access public --provenance` using OIDC. No repack
   occurs in the publish job. Verify registry metadata and provenance afterwards.

`prepack` runs the project checks for ordinary source packaging. The archive
checker uses `--ignore-scripts` to avoid recursion. Its optional output is created
only after validation and never overwrites an existing file. It checks the exact
allowlist, entrypoint and internal runtime imports; it is not a replacement for
the real host smoke test. GitHub Actions and Bun lockfile updates are proposed
weekly by Dependabot (`bun` ecosystem supports text `bun.lock` >=1.1.39).
