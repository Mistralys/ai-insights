# Orchestrator Changelog

## v0.4.0 - Manifest-Driven Configuration
- Config: Pipeline routing constants now derived from `shared/workflow-manifest.json` at startup.
- Supervisor: Updated routing to align with manifest-defined role and pipeline definitions.
- Tests: Added config test suite covering manifest-derived constants.
- Tests: Expanded supervisor routing test coverage.
- Docs: Added CTX Generator module context file.

## v0.3.0 - Nine-Stage Pipeline Support
- Nodes: Added stub implementations for the security auditor and release engineer stages.
- Config: Extended pipeline routing to include `security-audit` and `release-engineering` stages.
- Docs: Updated README and architecture documentation to reflect the expanded 9-stage pipeline.

## v0.2.1 - Documentation Structure
- Docs: Updated and split READMEs for clarity.

## v0.2.0 - Ledger Delegation Architecture (Breaking-S)
- Architecture: Delegated all logic execution to the ledger system.
- Scripts: Replaced the primary execution script.

### Breaking Changes
This release significantly refactors the orchestration logic, moving execution responsibility to the ledger. Previous local execution patterns may be deprecated.

## v0.1.1 - Logic Cycle Stabilization
- Logic: Fixed issues in the third logic cycle execution.

## v0.1.0 - Initial Release
- Core: Initial implementation of the LangGraph-based pipeline.
- Core: Completed post-development rework and stabilization.
- Config: Updated `.env.example`.
- Housekeeping: Removed temporary folders.
