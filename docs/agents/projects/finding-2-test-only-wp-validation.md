# Finding: Pre-verify Production Method Existence for Test-Only WPs

**Origin:** Observed during a ledger workflow run (2026-03-15) where a WP was scoped as test-only but required production code changes.
**Status:** Implemented (2026-03-16)
**Priority:** High

---

## Problem

A work package was planned as test-only — its sole purpose was to add setup calls (e.g., `setItemsPerPageURLTemplate()`) to existing test methods. However, the method being called did not yet exist in production code. The Developer correctly added it as real production code, but this was an invisible scope expansion: the plan said "test-only", yet production files were modified.

When a WP's `active_pipeline_stages` excludes `implementation` (making it test-only or verification-only), there is currently no validation step that checks whether the methods/functions being tested actually exist in production.

## Recommendation

Before any WP is classified as test-only or verification-only (via `active_pipeline_stages` excluding `implementation`), verify that all methods and functions referenced in the WP's scope already exist in production code. A grep or manifest check is sufficient. If a required method does not exist, the WP should be reclassified to include the `implementation` stage.

## Where to Incorporate

### Primary target: PM persona workflow

The Project Manager persona (`personas/ledger/src/content/2-project-manager.md`) should gain a validation rule in its Workflow section (after ledger bootstrapping): for any WP whose `active_pipeline_stages` excludes `implementation`, verify that all methods/functions referenced in the WP's scope already exist in production code.

### Alternative target: Pipeline Configurator sub-agent

The Pipeline Configurator sub-agent (invoked by the PM to decide which stages are active per WP) is the agent that would most naturally enforce this rule during WP decomposition.

### Secondary targets

- The MCP server's help/FAQ content could add an entry about test-only WPs and the production-method prerequisite.
- The workflow specification's edge-cases document could add a case about test-only WP method validation.

## Current Schema State

- `active_pipeline_stages` field exists on work packages (optional array of pipeline types).
- There is no dedicated `test-only` flag or WP type field.
- There is no server-side validation preventing creation of test-only WPs for non-existent methods (this is a planning discipline issue, not a schema issue).
