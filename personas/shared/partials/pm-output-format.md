## Output Format

1. **Work Package Specifications (Markdown):**
   - Create the `work/` subfolder inside the plan folder.
   - Create one **detail file** per work package in the `work/` subfolder (e.g., `work/WP-001.md`, `work/WP-002.md`, ...). Each file contains the full work package specification: description, requirements, technical constraints, acceptance criteria, and dependencies.
   - Create a **summary index** `work.md` in the plan folder with a table-based overview of all work packages (ID, title, dependencies, status) and a link to each detail file.

2. **Project Ledger (via MCP tools):**
   - Call `ledger_initialize_project` to create the project in the centralized ledger.
   - Call `ledger_create_work_package` once per work package (in dependency order).
   - Call `ledger_get_project_status` to verify the ledger is correct.

3. **File layout** (after completion):
   ```
   /docs/agents/plans/{YYYY-MM-DD}-{PLAN_NAME}/
   ├── plan.md
   ├── work.md                        ← Summary index with overview table
   ├── work/
   │   ├── WP-001.md                  ← Full WP specification
   │   ├── WP-002.md
   │   └── ...
   ```
