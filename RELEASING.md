# Releasing

`@notionhq/notion-mcp-server` is published to npm via GitHub Actions using npm
**OIDC trusted publishing** (no long-lived npm token in CI), with build
provenance attestation. This mirrors the setup used by `notion-sdk-js`.

## One-time setup (required before the first automated publish)

OIDC trusted publishing must be enabled on the npm side, or the publish step
will fail with an auth error:

1. On npmjs.com, open the package settings for **@notionhq/notion-mcp-server**
   → **Trusted Publishers** (org admin required).
2. Add a GitHub Actions trusted publisher:
   - Repository: `makenotion/notion-mcp-server`
   - Workflow filename: `publish.yml`
   - Environment: _(leave blank)_
3. Confirm the npm org's 2FA/publishing policy allows automation/OIDC publishes.

No `NPM_TOKEN` secret is needed once this is configured.

## Cutting a release

1. **Bump the version.** Run the **Increment Version** workflow
   (Actions → Increment Version → Run workflow) and pick `patch` / `minor` /
   `major`. It opens a `Bump version to vX.Y.Z` PR. (Or bump `package.json`
   manually in a PR with a commit message starting `Bump version to`.)
2. **Merge the bump PR to `main`.**
3. The **Publish Package** workflow runs on push to `main`: it builds, tests,
   `npm publish --provenance` (skipping if that version already exists), and
   pushes a `vX.Y.Z` git tag.

That's it — the published artifact is the bundled CLI (`bin/cli.mjs`), rebuilt
in CI so it can never go stale relative to source.

## Manual publish (fallback)

Only if the workflow is unavailable. Requires npm publish rights:

```bash
npm ci
npm run build      # regenerates bin/cli.mjs — do NOT skip
npm test
npm publish --access public
```
