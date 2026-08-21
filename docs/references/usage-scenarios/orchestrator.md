# Usage Scenarios — Orchestrator

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC42] Start a new orchestrator run

1. The user navigates to `#/orchestrator`, enters an absolute plan path, and clicks "Run Preflight".
2. A checklist of preflight checks appears, each showing pass/fail with a detail message and, on failure, a suggested fix command; when every check passes, the "Start Run" button becomes enabled.
3. The user clicks "Start Run". A success banner confirms the launch (including the process PID when available) and the run queue below refreshes to show the new entry.

- [ ] Spec approved
- [ ] Implementation verified

## [SC43] See preflight failures block the Start Run button

**Preconditions:** At least one preflight check fails (e.g. missing venv, stale build).

1. The user runs preflight against a plan path with an unmet prerequisite.
2. The failing check is marked with a red indicator and a "Fix:" command suggestion; the "Start Run" button remains disabled until the user resolves the issue and re-runs preflight successfully.

- [ ] Spec approved
- [ ] Implementation verified

## [SC44] View the live run queue

1. The user opens `#/orchestrator`.
2. The Run Queue section lists all known runs with plan name, status badge, elapsed time, and progress; the queue refreshes automatically every 5 seconds.

- [ ] Spec approved
- [ ] Implementation verified

## [SC45] Kill a pending run from the queue

**Preconditions:** A run in the queue has status "pending" (actively running).

1. The user clicks the "Kill" button on that queue row and confirms the prompt.
2. The underlying process is terminated and the queue refreshes to reflect the run's new (dead) status.

- [ ] Spec approved
- [ ] Implementation verified

## [SC46] Dismiss a dead run from the queue

**Preconditions:** A run in the queue has status "dead" (process exited without completing).

1. The user clicks the "Dismiss" button on that queue row.
2. The entry is removed from the queue view.

- [ ] Spec approved
- [ ] Implementation verified

## [SC47] Jump to a completed run's project from the queue

**Preconditions:** A queue entry's project now exists and its repository/slug are known.

1. The user clicks "View Project" on that queue row.
2. The browser navigates to the corresponding project's detail page.

- [ ] Spec approved
- [ ] Implementation verified

## [SC48] Expand a queue row to preview its live log

**Preconditions:** A queue entry has an associated log file.

1. The user clicks the row's expand toggle (▶).
2. The row expands to show a live-updating log preview beneath it; toggling again collapses the preview and stops its polling. A "View Log →" link is also shown when the run's project/slug are resolvable.

- [ ] Spec approved
- [ ] Implementation verified

## [SC49] Copy the CLI reference commands

1. The user scrolls to the CLI reference card at the bottom of the Orchestrator page.
2. Example CLI commands for running the orchestrator headlessly are shown for copy/paste use outside the GUI.

- [ ] Spec approved
- [ ] Implementation verified
</content>
