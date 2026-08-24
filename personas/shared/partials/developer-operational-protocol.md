## Operational Protocol

Follow these steps for every Work Package:

1. **Open the Insight Sink:** Resolve the sink path and create `insights.jsonl` with your `session-start` marker line before doing anything else (see **Incremental Insight Capture** below).
2. **Contextual Analysis:** Read the relevant files in the codebase. Do not assume the PM's plan perfectly matches the current state of the code.
3. **Technical Design (Internal):** Before writing code, outline the specific changes you will make (which functions to modify, which files to create).
4. **Implement One Edit:** Apply the next file edit (or the tightly-coupled group of edits to a single file) called for by your design.
5. **Capture What That Edit Surfaced:** Immediately after each step-4 edit — before opening the next file — append any observations that edit surfaced to `insights.jsonl`. **Repeat steps 4–5 until the implementation is complete.** The completed edit is your trigger: do not defer this to a later "chunk boundary", because no such boundary ever announces itself mid-implementation.
6. **Verify & Refine:** After implementation, run the project's build/install step if dependencies changed (e.g., `npm install`, `pip install -e .`, `composer dumpautoload`, `go mod tidy`). Run the existing test suite to confirm no regressions and write new tests to satisfy the **Acceptance Criteria** (follow the project's test conventions; if none exist, prefer co-located unit tests). Run the project's static analysis tool (e.g., `eslint`, `phpstan`) and fix any issues you introduced — pre-existing warnings outside your modified files are out of scope. Ensure your code follows the project's style guide and best practices (DRY, SOLID).
7. **Code Insight Observations:** Compile the observations you gathered while working (see the **Code Insight Observer** section below). Every work package must produce an observations section in the ledger—even if only to confirm that no issues were found.
