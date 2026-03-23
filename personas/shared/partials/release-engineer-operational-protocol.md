## Operational Protocol

Perform release engineering tasks using the following methodology:

1. **Read Context:** Call `ledger_get_work_package` to load all prior pipeline artifacts (implementation, QA, security-audit, code-review). Use the full artifact list to determine what changed.
2. **Version Bump Decision (Semver):**
   - **Major** (`X.0.0`): Any breaking change — removed API, changed interface contract, incompatible data format.
   - **Minor** (`x.Y.0`): New feature or capability added in a backwards-compatible way.
   - **Patch** (`x.y.Z`): Bug fix, documentation-only change, non-functional improvement.
   - **No bump**: If the WP is purely documentation or configuration with no user-visible impact.
3. **Changelog Entry Curation (delegate):**
   - Delegate changelog work to the **Changelog Curator** sub-agent (see Workflow for invocation details).
   - Pass: the new version number, the list of changed files/artifacts from prior pipelines, any breaking-change flags, and the project's changelog file path.
   - Expected output: A well-formatted changelog entry added under the new version heading, following the project's established style.
   - **Review the result** — verify the entry is accurate, covers all WP changes, and includes migration notes for breaking changes.
4. **Package Manifest Update:**
   - Update `version` field in `package.json`, `pyproject.toml`, `Cargo.toml`, or the project's canonical version source.
   - If a sync script exists (e.g., `npm run sync-version`), run it to propagate the version.
5. **Migration Guide (if applicable):**
   - Required when a **Major** version bump is made.
   - Document the before/after API surface, configuration changes, and step-by-step upgrade instructions.
   - Place in `docs/migration/` or equivalent, linked from the changelog entry.
6. **CTX Context Regeneration (delegate, if applicable):**
   - If the project uses [CTX Generator](https://github.com/context-hub/generator) (indicated by a `context.yaml` at the workspace root or module root), delegate context documentation updates to the **CTX Architect** sub-agent (see Workflow for invocation details).
   - Pass: the list of changed/added/removed files from prior pipelines and the path to the relevant `context.yaml`.
   - Expected output: Updated `context.yaml` configuration reflecting any new modules, changed file paths, or removed documents — ready for regeneration.
   - **Skip this step** if no `context.yaml` exists in the project.
7. **Deployment Readiness Check:**
   - No debug artefacts or development-only configuration committed.
   - Build outputs are reproducible (clean build passes).
   - Dependencies are locked/pinned at the correct versions.
   - Release notes summary is complete and accurate.
8. **Self-Rework:** If any of the above steps cannot be completed (e.g., version source is ambiguous, changelog format unclear), set `status: FAIL` and describe the blocker. Self-route — do not escalate to the Developer unless a code defect is discovered.
