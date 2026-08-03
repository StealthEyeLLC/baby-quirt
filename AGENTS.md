# Repository instructions

Baby Quirt is a fresh, standalone, private Unix-socket host agent that bootstraps the full Quirt system. It is intentionally small, dependency-light, auditable, and built on Node.js 24 using built-in modules where practical. Communication happens over a private Unix-domain socket only — do not add a public network listener.

## Cursor Cloud specific instructions

### Runtime
- The project requires Node.js `>=24.0.0 <25` (see `engines` in `package.json` on the `build/quirt-core` branch). The base VM ships Node 22 at `/exec-daemon/node`, which sits early in `PATH` and would otherwise shadow any nvm version. Setup installs Node 24 via nvm and adds `node`/`npm`/`npx` symlinks in `/usr/local/cargo/bin` (which is first in `PATH` in every context — Shell, interactive, and npm child processes). As a result `node`/`npm` already resolve to v24; no `nvm use` is needed. Verify with `node --version` (expect `v24.x`).
- There are no external services, databases, caches, or queues. The product is a single Node.js process that listens on a private Unix-domain socket. Nothing extra needs to be started to develop or test it.

### Source layout / running
- On `main` the repo is pre-source: it contains only `README.md` (and this file). The Node scaffolding (`package.json`, `package-lock.json`) lives on the `build/quirt-core` branch; the referenced `src/`, `scripts/`, and `tests/` directories are not committed on any branch yet. Expect `npm start`/`npm test` to no-op or fail with `MODULE_NOT_FOUND` until source is added — this is not an environment problem.
- Standard commands (once source exists) are defined in `package.json` scripts: `npm start` (`node src/main.mjs`), `npm run client`, `npm run check`, `npm test` (Node built-in test runner over `tests/*.test.mjs`), `npm run release:build`, `npm run release:verify`, and `npm run ci`. There is no separate lint script; `npm run check` (`scripts/check.mjs`) is the static-check entry point.
- `npm install` is effectively a no-op today (zero external dependencies) but is safe and kept in the startup update script, guarded on `package.json` existing.
