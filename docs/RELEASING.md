# npm publication

The distribution is the npm package **`jobzyn-mcp@0.1.1`**, running locally over **stdio**. No hosted JobZyn MCP service is planned. Streamable HTTP remains an optional capability in the package; it is not needed for this release.

## Release identity

- Public package: `jobzyn-mcp`.
- Version: `0.1.1`.
- Source: [Yasmine-Works/jobzyn-mcp](https://github.com/Yasmine-Works/jobzyn-mcp).
- Check the registry for the current publication status: `npm view jobzyn-mcp@0.1.1 version dist.integrity --json`.
- Preparing the package requires no npm login or JobZyn credentials.
- Actual publication requires the intended maintainer's npm account and any account-required authentication.

## Prepare the reviewed artifact

From a clean checkout with Node.js 22+ and npm:

```sh
npm ci
npm run release:prepare
```

The preparation command runs type checking, tests, a clean build, package inspection, and a clean production-only installation. It then checks the installed CLI, TypeScript declarations, and discovery of all five tools using a real MCP stdio client. Discovery does not call JobZyn. The verifier uses the `tar` command available on macOS and the Linux CI runners.

Output files, excluded from Git and the npm package:

```text
.release/jobzyn-mcp-0.1.1.tgz
.release/release-manifest.json
```

The manifest contains the source commit, whether the source had uncommitted changes, the exact package file list, SHA-256, and npm-compatible SHA-512 integrity. It contains no API credentials or candidate data. After committing changes, run `npm run verify:package` once more to produce an artifact with the final source commit and `sourceDirty: false`.

The verifier rejects files outside an explicit reviewed allowlist. It scans file contents for the documented JobZyn API-key pattern, npm-token patterns, private-key markers, and configured secret values from the process environment and local `.env*` files. It never prints matched secrets. This is a targeted check, not a guarantee of detecting every possible credential format. The build clears old `dist` output, preventing stale files from entering a new package.

## Optional live check

Live validation is separate from the release gate and CI. Use a JobZyn key with `read` scope and an existing **external ATS job ID**. An internal numeric JobZyn ID is not interchangeable with an external ID, even if both look numeric.

Put the key in a local `.env` file, never in a source file or a client example:

```dotenv
JOBZYN_API_KEY=YOUR_JOBZYN_API_KEY
```

The `.env` file is ignored by Git and excluded from the package. Restrict its file permissions on macOS/Linux:

```sh
chmod 600 .env
npm run build
npm run test:live -- --job-id YOUR_EXTERNAL_JOB_ID
```

Alternatively, set `JOBZYN_API_KEY` in the environment and run `node scripts/test-live.mjs --job-id YOUR_EXTERNAL_JOB_ID`. Credentials are passed only to the local MCP child process. The helper performs one candidate request with `pageSize: 1`, makes no writes, and prints status/counts only. It does not persist candidates or print their names, contact details, CV URLs, response bodies, or the key. A failed lookup reports the upstream status without echoing the response body.

The key does not belong in `.npmrc`, package metadata, GitHub secrets for this release, tests, screenshots, or release notes. npm login credentials and JobZyn API credentials serve different purposes.

## Review the publication without uploading

```sh
npm publish ./.release/jobzyn-mcp-0.1.1.tgz \
  --access public \
  --registry https://registry.npmjs.org/ \
  --dry-run
```

This examines the prepared tarball without publishing it. Inspect `release-manifest.json`, verify the intended source commit, and keep the reviewed tarball unchanged. The [npm publish documentation](https://docs.npmjs.com/cli/v11/commands/npm-publish/) describes tarball publication, dry runs, and the rule that a published name/version cannot be reused.

## Publish when the release is authorized

Log in interactively on the maintainer's machine. Do not put an npm token in this repository or in chat:

```sh
npm login --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
```

Confirm the reported account is the intended publisher. Then publish the **same reviewed artifact**:

```sh
npm publish ./.release/jobzyn-mcp-0.1.1.tgz \
  --access public \
  --tag latest \
  --registry https://registry.npmjs.org/
```

Complete npm's interactive authentication if requested. Publishing a tarball does not rerun this repository's source release checks; that is why it must first pass `release:prepare`. If publishing the source directory instead, `prepublishOnly` runs the preparation checks and `prepack` rebuilds it, but publishing the verified tarball is the documented release path.

If npm rejects the name or another publisher claims it first, choose a package name/scope your organization controls, update package metadata and client examples, and rebuild. Do not publish under an unrelated existing package.

## Verify the published version

```sh
npm view jobzyn-mcp@0.1.1 version dist.integrity dist.tarball --json
npx --yes jobzyn-mcp@0.1.1 --version
```

Compare the registry integrity with `.release/release-manifest.json`. Record the release commit and npm metadata, then update the changelog with the publication date. Test an actual client using the version-pinned configuration in `examples/claude-desktop-npm.json` or `examples/codex-npm.toml`.


## Subsequent versions

Update the version in `package.json` and `src/config.ts`, refresh the lockfile, update client examples and the changelog, then repeat preparation and publication. The tests check that CLI/package versions agree.

If you later automate npm releases, configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the exact GitHub repository and workflow. That authenticates the release runner without storing a long-lived npm write token. This repository's current CI performs verification only: pushes do not publish packages or deploy services.
