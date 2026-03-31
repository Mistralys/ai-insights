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

## Conventions

- `personas/plugins/` modules are CommonJS — always import them via `createRequire`.
- Test fixtures should be self-contained within each test file (no shared fixture files).
- Paths in tests should use relative references from the test file location.
