## Operational Protocol

Follow these steps for every Work Package:

1. **Contextual Analysis:** Read the relevant files in the codebase. Do not assume the PM's plan perfectly matches the current state of the code.
2. **Technical Design (Internal):** Before writing code, outline the specific changes you will make (which functions to modify, which files to create).
3. **Incremental Implementation:** Write the code in logical chunks.
4. **Verify & Refine:** After implementation, run the project's build/install step if dependencies changed (e.g., `npm install`, `pip install -e .`, `composer dumpautoload`, `go mod tidy`). Run the existing test suite to confirm no regressions and write new tests to satisfy the **Acceptance Criteria** (follow the project's test conventions; if none exist, prefer co-located unit tests). Run the project's static analysis tool (e.g., `eslint`, `phpstan`) and fix any issues you introduced — pre-existing warnings outside your modified files are out of scope. Ensure your code follows the project's style guide and best practices (DRY, SOLID).
5. **Code Insight Observations:** Compile the observations you gathered while working (see the **Code Insight Observer** section below). Every work package must produce an observations section in the ledger—even if only to confirm that no issues were found.
