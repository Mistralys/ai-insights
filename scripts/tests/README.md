# scripts/tests/

Integration and ported test suites for workspace scripts and plugins.

## CJS/ESM Bridge Pattern

The workspace root uses **ESM** (Vitest runs in ESM mode), but modules under `personas/plugins/` are **CommonJS** (ported from the TypeScript library as CJS for compatibility with the CJS `persona-build.config.js` loader chain). To import CJS modules from ESM test files, use the `createRequire` bridge:

```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { ledgerPlugin } = require('../../personas/plugins/ledger/index.js');
```

This pattern is required because ESM's `import` cannot directly load CommonJS modules that use `module.exports`. The `createRequire` function creates a Node.js `require()` scoped to the calling file's directory, allowing standard `require()` resolution of CJS modules.

## File Naming

Test files use the `.test.js` extension and ESM syntax. Vitest processes them as ES modules.

## Running Tests

From the workspace root:

```bash
# Run all scripts/tests
npx vitest run scripts/tests/

# Run a specific test file
npx vitest run scripts/tests/ledger-plugin.test.js

# Watch mode
npx vitest scripts/tests/
```

Tests are included automatically via the root `vitest.config.ts` include pattern: `scripts/tests/**/*.test.{js,ts}`.

## Subprocess-Spawning Suites

A suite whose tests — or the library code under test — spawn a real child process
(`spawnSync`/`execFileSync`/`spawn`/`exec`) can exceed Vitest's default 5000 ms per-test
timeout under parallel load, causing flaky failures unrelated to the code being tested.

`scripts/tests/helpers/timeouts.js` exports `SUBPROCESS_TEST_TIMEOUT_MS` (`30_000`) for
exactly this case. Apply it as the `describe()` block's own timeout (third positional
argument) — not per-`it()` — so every test in that suite is covered without repetition:

```js
import { SUBPROCESS_TEST_TIMEOUT_MS } from './helpers/timeouts.js';

describe('myFeature', () => {
  // ...
}, SUBPROCESS_TEST_TIMEOUT_MS);
```

Only apply the constant to `describe()` blocks that actually spawn a subprocess (directly
or via the library function under test) — giving it to a suite that never spawns
misrepresents why the timeout exists, and a suite that merely contains the word "spawn"
in a string literal it inspects (e.g. static-source-text assertions) does not qualify.
`vitest.config.ts`'s global `testTimeout` is intentionally left at the Vitest default, so
that a genuine hang in a pure-unit suite still fails fast instead of being masked by a
blanket 30-second ceiling.

Find the current set of suites using this constant with:

```bash
grep -l SUBPROCESS_TEST_TIMEOUT_MS scripts/tests/*.test.js
```

A suite that injects a `spawn`/`spawnSync` stub instead of invoking the real one — for
example `mcp-dist-freshness.test.js` — does not qualify for the constant even though its
code under test (`ensureMcpDistFresh()`) can spawn a real subprocess in production: no
real child process ever runs in the test itself, so there is nothing for the timeout to
protect against.

## Conventions

- `personas/plugins/` modules are CommonJS — always import them via `createRequire`.
- Test fixtures should be self-contained within each test file (no shared fixture files).
- Paths in tests should use relative references from the test file location.
- A suite that spawns a real child process applies `SUBPROCESS_TEST_TIMEOUT_MS` (see
  above) at the `describe()` level rather than raising the global `testTimeout`.
