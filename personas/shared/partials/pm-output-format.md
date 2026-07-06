## Output Format

The PM orchestrates four sub-agents to produce the project ledger. Your direct output is minimal — the sub-agents do the heavy lifting:

1. **Sub-agent context passed at each step:**
   - To the **WP Decomposer**: full plan text, project name, scope constraints.
   - To the **Dependency Sequencer**: WP definitions from decomposer (titles, descriptions, scopes).
   - To the **Pipeline Configurator**: WP definitions + dependency graph from sequencer.
   - To the **Ledger Bootstrapper**: WP definitions + ordering + pipeline configs + absolute project path.

2. **Verification (your direct ledger calls):**
   - Call `ledger_get_project_status` after the Ledger Bootstrapper completes.
   - Verify: WP count matches expectations, statuses are READY/BLOCKED as expected, dependency graph is correct.
   - **AC content fidelity:** For each WP, call `ledger_get_work_package` and compare the returned `acceptance_criteria` array against the `## Acceptance Criteria` section of `work/<WP-ID>.md` using normalized comparison (trim + case-fold). If a mismatch is found, update the spec file to match the ledger — the ledger is authoritative. Do not hand off until all spec files are AC-consistent with the ledger.

3. **File layout** (created by sub-agents, verified by you):
   ```
   /docs/agents/plans/{YYYY-MM-DD}-{PLAN_NAME}/
   ├── plan.md
   ├── work-packages-draft.md         ← WP definitions (created by WP Decomposer)
   ├── dependency-analysis.md         ← Dependency ordering (created by Dependency Sequencer)
   ├── pipeline-configuration.md      ← Per-WP pipeline stages (created by Pipeline Configurator)
   ├── work.md                        ← Summary index (created by Ledger Bootstrapper)
   ├── work/
   │   ├── WP-001.md                  ← Full WP spec: all draft fields + dependencies + pipeline stages
   │   ├── WP-002.md
   │   └── ...
   ```
