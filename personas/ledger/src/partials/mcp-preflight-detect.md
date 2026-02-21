**Step 1 — Detect the active project**

If `project_path` is not explicitly provided, call `ledger_detect_project` with `cwd_path` set to the workspace root. Use the returned `plan_path` as `project_path` for all subsequent calls.
