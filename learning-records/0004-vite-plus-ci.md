# 0004 — Running Vite+ checks in GitHub Actions CI

Research for the wayfinder map _"CI pipeline + light local loop (offload 4GB lint to GitHub Actions)"_.
Resolves ticket **Research: how does Vite+ run checks in CI?** (issue #102).

## Findings

### `vp` is a local binary, not a global install

The `vite-plus` devDependency ships the `vp` CLI as a `bin` entry, so after
`vp install` (or `pnpm install`) it exists at `node_modules/.bin/vp`. On a clean
runner you do **not** need `npm i -g vite-plus`.

- Source: `node_modules/vite-plus/package.json` — `bin.vp = "./bin/vp"` (also ships `vpr`, `oxlint`, `oxfmt`). Version currently `0.2.9`.

### The official CI setup is the `voidzero-dev/setup-vp` action

Vite+ documents a first-party GitHub Action that installs Vite+, the required
Node.js version, and the package manager in one step, and can cache
package-manager data automatically. The canonical minimal workflow:

```yaml
- uses: actions/checkout@v4
- uses: voidzero-dev/setup-vp@<setup-vp-version>
  with:
    node-version: "24"
    cache: true
- run: vp install
- run: vp check
- run: vp test
- run: vp build
```

- Source: `node_modules/vite-plus/docs/guide/ci.md` (§ "GitHub Actions").
- `cache: true` makes `setup-vp` handle dependency caching; no separate
  `setup-node` / `pnpm/action-setup` / `actions/cache` steps are needed.

### Pin `setup-vp` to an exact version, never `v1`

`setup-vp` uses the same convention as the ecosystem (pin exact versions for
supply-chain safety). The docs say explicitly: **do not use the `v1` tag** — it
no longer receives updates. Use an exact release or commit SHA.

- Source: `node_modules/vite-plus/docs/guide/ci.md` (§ "setup-vp Versioning").
- Latest release at research time: **`v1.17.0`** (2026-08-06).
  Source: `gh release list --repo voidzero-dev/setup-vp`.
- Optionally add `.github/dependabot.yml` with a `github-actions` entry to keep
  it fresh (pattern shown in the same doc).

### `vp check` = fmt + lint + typecheck in one command

`vp check` merges formatting (Oxfmt), linting (Oxlint), and — when
`lint.options.typeCheck` is enabled — TypeScript type checking via the
type-aware path (TypeScript Go toolchain + tsgolint). This is the same command
the local `staged` hook already runs (`vp check --fix`).

- Source: `node_modules/vite-plus/docs/guide/check.md`.

The 4GB local failure is this type-aware path: `vite.config.ts` sets
`lint.options: { typeAware: true, typeCheck: true }`.

### `vp test` = Vitest, non-watch by default

`vp test` runs tests once (no watch mode by default, unlike bare Vitest).
Configuration lives in the `test` block of `vite.config.ts`, not a separate
`vitest.config.ts`.

- Source: `node_modules/vite-plus/docs/guide/test.md`.
- Note: `vp test` is a built-in, distinct from a `package.json` `test` script —
  but this repo's `test` script is `vp test run`, so they agree.

### Memory headroom

The GitHub-hosted standard runner has substantially more RAM than the local
machine. The Vite+ docs prescribe no memory flag for `vp check`/type-aware
lint, and the type-aware path is Rust/Go-native (tsgolint), not a V8 heap, so
`NODE_OPTIONS=--max-old-space-size` is not the relevant knob. The ~4GB type-aware
lint is expected to fit on the standard `ubuntu-latest` runner.

- Source: `node_modules/vite-plus/docs/guide/ci.md` (no memory flag prescribed);
  runner hardware per GitHub's runner-images repo (`ubuntu-latest` → Ubuntu 24.04 x64).
- **Confirm empirically** on the first CI run. If it ever OOMs, the fix is a
  larger runner (GitHub Team/Enterprise) or splitting checks into separate jobs —
  not a Node flag.

### Env-gating is plain JS

`vite.config.ts` is just JavaScript, so the `typeAware` flag can be gated on an
env var (GitHub Actions sets `CI=true` automatically):

```ts
lint: {
  options: {
    typeAware: !!process.env.CI,
    typeCheck: !!process.env.CI,
  },
},
```

Local `vp check` then skips the 4GB type-aware path; CI runs it. This is the
implementation for the "light local loop" decision. (Draft belongs to the
Prototype ticket, issue #103.)

## Open / to verify

- Exact RAM of the standard public-repo runner at first-run time (empirical).
- Whether the first type-aware lint run is green or surfaces existing findings
  (tracked in the map's "Not yet specified").
