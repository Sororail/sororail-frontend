# Changesets

Release management for `@sororail/sdk`.

A PR that changes published behaviour needs a changeset. Run:

```bash
pnpm changeset
```

pick the bump, and describe the change in a sentence a consumer would
understand. Commit the generated file with your PR.

`@sororail/web` and `@sororail/docs` are in `ignore`: the reference app and the
documentation site are not published, so they do not get versioned or
released, and they have no changelog. Their changes are described in the pull
requests that make them.

## Where the changelog lands

Release notes are written to
[`packages/sdk/CHANGELOG.md`](../packages/sdk/CHANGELOG.md), newest release
first. Until a release is cut, merged changes wait here as individual
changeset files. The changelog is committed with the version bump and ships
inside the published package, so a consumer can read it on GitHub, in
`node_modules/@sororail/sdk/CHANGELOG.md`, or at
`https://unpkg.com/@sororail/sdk/CHANGELOG.md`.

## Releasing

```bash
pnpm changeset version   # applies pending changesets, writes packages/sdk/CHANGELOG.md, bumps the version
pnpm changeset publish   # publishes to npm
```

Commit the updated `CHANGELOG.md`, `package.json` and the removal of the
consumed changeset files together, before publishing.

The `@sororail` npm scope is **not yet reserved**, and nothing has been
published. Reserve it before the first release, or `publish` will fail.

## Versioning rules

`@sororail/sdk` tracks the contracts' ABI. Two things force a **major** bump
regardless of how small the code change looks:

- a change to the meaning of any error code in `src/errors/codes.ts`
- a change to a contract entry point's signature

Both silently break consumers who decode failures by number or call by name.
