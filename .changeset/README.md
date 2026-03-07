# Changesets

Release management for `@sororail/sdk`.

A PR that changes published behaviour needs a changeset. Run:

```bash
pnpm changeset
```

pick the bump, and describe the change in a sentence a consumer would
understand. Commit the generated file with your PR.

`@sororail/web` is in `ignore`: the reference app is not published, so it does
not get versioned or released.

## Releasing

```bash
pnpm changeset version   # applies pending changesets, updates CHANGELOG
pnpm changeset publish   # publishes to npm
```

The `@sororail` npm scope is **not yet reserved**, and nothing has been
published. Reserve it before the first release, or `publish` will fail.

## Versioning rules

`@sororail/sdk` tracks the contracts' ABI. Two things force a **major** bump
regardless of how small the code change looks:

- a change to the meaning of any error code in `src/errors/codes.ts`
- a change to a contract entry point's signature

Both silently break consumers who decode failures by number or call by name.
