# Project Synthesis: Dialogue Capture on Error Path & Soft Fails

## Executive Summary
This project aimed to stabilize edge-case behavior and improve internal pipeline observability, specifically pertaining to cross-WP tool usage and stage crash debugging. We successfully implemented a 2-strike soft-fail mechanism in the `restrict_to_wp` tool wrapper, replacing an immediate hard-kill response with a descriptive error string to help course-correct agents gracefully. Additionally, we introduced robust error-path dialogue capture to ensure partial conversational states (`_msgs`) are reliably saved out and marked (`partial=True`) whenever a tool/stage crashes unexpectedly.

All modules have been updated with complete test coverage, and documentation correctly reflects the new soft-fail constraints and partial dialogue log schema.

## Metrics
* **Testing:** 106 existing and new unit tests explicitly passed for tool wrappers and error-path scenarios; overall test suite maintained ~667 passing tests with no regressions.
* **Security & Quality:** WP-001 received a perfect run (0 Critical, 0 High, 0 Medium findings) on OWASP checks; access isolation remains strong while supporting soft resilience.
* **Traceability:** Full code-review approvals on both logical streams with no blocking issues. Documentation accurately mirrors internal constraints via the newly added constraints 12 and 13.

## Strategic Recommendations
* **LLM Ergonomics Pattern:** The inclusion of an explicit attempt/violation counter in tool responses (`"ERROR: ... (violation N of 2 allowed before hard abort)"`) is a highly effective, native way to guide the LLM agent without breaking pipeline continuity. This is a gold-standard pattern for defensive tooling wrappers.
* **Architectural Consistency (Technical Debt):** The slug-directory derivation (`workspace_root / mcp-server / storage / ledger / slug`) is currently duplicated between the success-path and error-path dialogue captures. As highlighted during code-review, this poses a slight maintainability risk and should be extracted into a common private generator function in a future refactor.
* **Concurrency Forethought (Security Audit Info note):** The current implementation uses a shared mutable `list[int]` counter within closures. This is fully appropriate and safe for the current single-threaded asynchronous context of LangGraph, but will require a thread-safe revision if multi-threaded execution is ever adopted.

## Next Steps
* Add a low-priority backlog task to consolidate the duplicated partial-dialogue slug-derivation logic.
* Consider implementing dedicated backend logging for soft-fail threshold triggers (strikes 1 and 2), allowing better offline observability of agent confusions without polluting the critical event stream.
