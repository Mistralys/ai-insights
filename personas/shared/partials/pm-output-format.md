## Output Format

The PM orchestrates four sub-agents to produce the project ledger. Your direct output is minimal — the sub-agents do the heavy lifting:

1. **Sub-agent context passed at each step:**
   - To the **WP Decomposer**: full plan text, project name, scope constraints.
   - To the **Dependency Sequencer**: WP definitions from decomposer (titles, descriptions, scopes).
   - To the **Pipeline Configurator**: WP definitions + dependency graph from sequencer.
   - To the **Ledger Bootstrapper**: WP definitions + ordering + pipeline configs + absolute project path.

2. **Verification (your direct ledger call):**
   - Call `ledger_get_project_status` after the Ledger Bootstrapper completes.
   - Verify: WP count matches expectations, statuses are READY/BLOCKED as expected, dependency graph is correct.

3. **File layout** (created by sub-agents, verified by you):
   ```
   /docs/agents/plans/{YYYY-MM-DD}-{PLAN_NAME}/
   ├── plan.md
   ├── work.md                        ← Summary index (created by Ledger Bootstrapper)
   ├── work/
   │   ├── WP-001.md                  ← Full WP specification (created by Ledger Bootstrapper)
   │   ├── WP-002.md
   │   └── ...
   ```
