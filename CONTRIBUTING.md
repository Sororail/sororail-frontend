# Contributing to so4-oracle

Thanks for helping build SO4 Markets. This guide covers how to set up, what to work on, and how to get your changes merged.

---

## Setup

**Prerequisites**

- Rust stable (install via [rustup](https://rustup.rs))
- `wrangler` CLI for the oracle worker: `npm i -g wrangler`
- A Cloudflare account (only needed for deploying the worker, not for local dev)
- Optional: Redis (for the APIs cache layer)

**Clone and build**

```bash
git clone git@github.com:SO4-Markets/so4-oracle.git
cd so4-oracle

# Build both crates
cargo build

# Check without building
cargo check

# Run tests
cargo test
```

**Run the APIs server locally**

```bash
cargo run -p apis
# → listening on 0.0.0.0:3000
```

**Run the oracle worker locally**

```bash
# Install worker-build once
cargo install worker-build@^0.8

# Start local dev server (hot-reloads on save)
wrangler dev
```

---

## Project Layout

```
so4-oracle/
├── oracle/src/lib.rs     Cloudflare Worker entry — HTTP handler, price submission
└── apis/src/main.rs      Axum server entry — REST + WebSocket endpoints
```

When adding a feature to `oracle`, work in `oracle/src/`. When adding an API endpoint, work in `apis/src/`. Shared types (if needed) go in a new `crates/shared` workspace member — propose this in an issue before creating it.

---

## Finding Work

All open issues are tracked on [GitHub Issues](https://github.com/SO4-Markets/so4-oracle/issues). Issues are labelled:

| Label | Meaning |
|---|---|
| `good first issue` | Self-contained, well-defined, good starting point |
| `oracle-worker` | Work in the `oracle/` Cloudflare Worker crate |
| `apis` | Work in the `apis/` Axum server crate |
| `contracts` | Work in the [contracts repo](https://github.com/SO4-Markets/contracts) but referenced here |
| `testing` | Adding or improving test coverage |
| `infrastructure` | CI, deploy scripts, Docker, tooling |
| `documentation` | Docs, comments, diagrams |

Before starting, leave a comment on the issue so no one duplicates effort.

---

## Workflow

1. **Fork** the repo (external contributors) or create a branch (team members).
2. Branch naming: `feat/short-description`, `fix/short-description`, `test/short-description`.
3. Make your changes. Keep commits focused — one logical change per commit.
4. **Run checks locally** before opening a PR:
   ```bash
   cargo fmt --all
   cargo clippy --all-targets -- -D warnings
   cargo test --all
   ```
5. Open a PR against `main`. Fill in the PR template.
6. Request a review from a maintainer.

---

## Pull Request Guidelines

- **Title:** Start with a type prefix: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- **Description:** What does this do, and why? Link the relevant issue (`Closes #N`).
- **Tests:** New functionality must include tests. Bug fixes should include a regression test.
- **No partial implementations:** If a function is not yet complete, leave it as a stub with a `todo!()` rather than committing broken logic.
- **No unnecessary refactors:** Keep PRs focused on the stated issue. Separate cleanup PRs are welcome but should be their own PR.

---

## Code Style

- `cargo fmt` is enforced in CI. Run it before pushing.
- `cargo clippy -- -D warnings` must pass. Address all warnings.
- No comments explaining *what* code does — names should do that. Add a comment only when the *why* is non-obvious.
- No emojis in code or commit messages.

---

## Testing

- Unit tests go in the same file: `#[cfg(test)] mod tests { ... }`.
- Integration tests (multi-contract) go in `tests/` at the crate root.
- For Soroban contract tests, use the `soroban-sdk` test environment.
- For HTTP endpoint tests, use `axum::test` or `reqwest` against a spawned server.

---

## Commit Messages

```
type(scope): short summary (≤72 chars)

Optional body — explain the why, not the what.
```

Types: `feat`, `fix`, `test`, `docs`, `chore`, `refactor`
Scopes: `oracle`, `apis`, `workspace`

---

## Questions

Open a discussion on GitHub or drop a message in the team channel. Don't open an issue just to ask a question.
