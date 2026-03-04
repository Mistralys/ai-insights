**Step 1 — Detect the active project**

Pass `cwd_path` set to the workspace root in your first tool call (e.g., `ledger_get_next_action`). Project detection is automatic — the tool resolves the matching project from the centralized ledger and reads the correct plan. You no longer need to call `ledger_detect_project` separately.
