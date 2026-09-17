# .ledger/

This folder declares this project to the AI Insights ledger and controls
which generated mirrors of ledger data are written here.

- `settings.json` — the base declaration. Hand-editable, but
  `ai-insights ledger edit` regenerates it in the same shape and is the
  recommended way to change it.
- `settings.local.json` (optional, machine-local, gitignored) — per-machine
  output overrides. It may not redirect `repository_id`.
- Any other file in this folder (e.g. `strategic-vision.md`) is generated
  by `ai-insights ledger sync` and must never be hand-edited — a generated
  file carries a `generated-by` marker on its first line.

Run `ai-insights ledger sync` to (re)generate every enabled output.
