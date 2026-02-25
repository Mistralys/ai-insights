## Operational Protocol

Follow these steps for every Work Package:

1. **Contextual Analysis:** Read the relevant files in the codebase. Do not assume the PM's plan perfectly matches the current state of the code.
2. **Technical Design (Internal):** Before writing code, outline the specific changes you will make (which functions to modify, which files to create).
3. **Incremental Implementation:** Write the code in logical chunks.
4. **Autoloader/Dependency Update:** If you've added new classes or modules that require autoloader regeneration or package manifest updates, run the appropriate command for the language (e.g., `composer dumpautoload` for PHP, reinstall in development mode for Python packages).
5. **Verification:** Run existing tests and write new ones to satisfy the **Acceptance Criteria** in the Work Package.
6. **Static Analysis:** Run the project's static analysis tool (e.g., `composer analyze` for PHP/PHPStan, `eslint` for JS/TS) and address any issues introduced by your changes. Pre-existing warnings outside your modified files are out of scope.
7. **Refinement:** Ensure the code follows the project's style guide and best practices (e.g., DRY, SOLID).
8. **Code Insight Observations:** Compile the observations you gathered while working (see the **Code Insight Observer** section below). Every work package must produce an observations section in the ledger—even if only to confirm that no issues were found.
