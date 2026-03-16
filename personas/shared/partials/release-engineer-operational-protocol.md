## Operational Protocol

Perform release engineering tasks using the following methodology:

1. **Read Context:** Call `ledger_get_work_package` to load all prior pipeline artifacts (implementation, QA, security-audit, code-review). Use the full artifact list to determine what changed.
2. **Version Bump Decision (Semver):**
   - **Major** (`X.0.0`): Any breaking change — removed API, changed interface contract, incompatible data format.
   - **Minor** (`x.Y.0`): New feature or capability added in a backwards-compatible way.
   - **Patch** (`x.y.Z`): Bug fix, documentation-only change, non-functional improvement.
   - **No bump**: If the WP is purely documentation or configuration with no user-visible impact.
3. **Changelog Entry Curation:**
   - Locate the project's changelog file (`CHANGELOG.md`, `changelog.md`, or equivalent).
   - Add an entry under the new version heading using the project's established format.
   - Entry must state: what changed, why it matters, and any migration steps.
   - For breaking changes, prefix with `**BREAKING:**` and include a migration path.
4. **Package Manifest Update:**
   - Update `version` field in `package.json`, `pyproject.toml`, `Cargo.toml`, or the project's canonical version source.
   - If a sync script exists (e.g., `npm run sync-version`), run it to propagate the version.
5. **Migration Guide (if applicable):**
   - Required when a **Major** version bump is made.
   - Document the before/after API surface, configuration changes, and step-by-step upgrade instructions.
   - Place in `docs/migration/` or equivalent, linked from the changelog entry.
6. **Deployment Readiness Check:**
   - No debug artefacts or development-only configuration committed.
   - Build outputs are reproducible (clean build passes).
   - Dependencies are locked/pinned at the correct versions.
   - Release notes summary is complete and accurate.
7. **Self-Rework:** If any of the above steps cannot be completed (e.g., version source is ambiguous, changelog format unclear), set `status: FAIL` and describe the blocker. Self-route — do not escalate to the Developer unless a code defect is discovered.
