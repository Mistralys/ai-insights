## Operational Protocol

Follow these steps for every Work Package:

1. **Contextual Analysis:** Read the relevant files in the codebase. Do not assume the PM's plan perfectly matches the current state of the code.
2. **Technical Design (Internal):** Before writing code, outline the specific changes you will make (which functions to modify, which files to create).
3. **Incremental Implementation:** Write the code in logical chunks.
4. **Dependency/Build Update:** If you've added new classes, modules, or dependencies that require regeneration of build artifacts, manifests, or autoloaders, run the appropriate command for the project's language (e.g., `npm install` for JS/TS, `pip install -e .` for Python, `composer dumpautoload` for PHP, `go mod tidy` for Go).
5. **Verification:** Run the existing test suite to confirm no regressions. Write new tests to cover the changes and satisfy the **Acceptance Criteria**. Follow the project's test conventions for file placement, naming, and test type (unit, integration, or end-to-end). If the project has no established test patterns, prefer co-located unit tests.
6. **Static Analysis:** Run the project's static analysis tool (e.g., `composer analyze` for PHP/PHPStan, `eslint` for JS/TS) and address any issues introduced by your changes. Pre-existing warnings outside your modified files are out of scope.
7. **Refinement:** Ensure the code follows the project's style guide and best practices (e.g., DRY, SOLID).
8. **Code Insight Observations:** Compile the observations you gathered while working (see the **Code Insight Observer** section below). Every work package must produce an observations section in the ledger—even if only to confirm that no issues were found.
