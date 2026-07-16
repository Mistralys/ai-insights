# Synthesis Report — insights-audit-persona-skill

**Plan:** `2026-07-15-insights-audit-persona-skill`
**Date:** 2026-07-15
**Status:** COMPLETE

---

## Executive Summary

This project delivered the `insights-audit-persona` skill and, more broadly, a complete skills build
pipeline for the ai-insights workspace. The skill launches the Persona Curator agent in Audit mode
via `context: fork`, enabling any IDE or Claude Code user to invoke a persona compliance audit in a
single step. Alongside the skill itself, the project introduced `scripts/build-skills.js` (a custom
`TargetRegistry`-based builder using the `@mistralys/persona-builder` API), `scripts/publish-skills.js`
(a deploy script that preserves hand-written sibling skill directories), and CLI integration via
`build-skills` and `publish-skills` commands in `scripts/cli.js`. The full pipeline is documented
in `AGENTS.md`, `README.md`, `skills/README.md`, and `docs/references/menu-guide.md`. All 4 work
packages passed with zero test regressions.

---

## Metrics

| Metric | Value |
|---|---|
| Work packages | 4 / 4 COMPLETE |
| Pipeline stages | 17 total (16 planned + 1 rework implementation) |
| Stages passed | 17 |
| Stages failed (terminal) | 0 |
| Rework cycles | 1 (WP-003 code-review FAIL → rework implementation PASS) |
| Workspace tests (final) | 84 / 84 PASS |
| MCP server tests (final) | 3353 / 3353 PASS |
| New files created | 6 (skills/meta/_shared.yaml, skills/meta/insights-audit-persona.yaml, skills/src/insights-audit-persona.md, skills/README.md, scripts/build-skills.js, scripts/publish-skills.js) |
| Files modified | 5 (scripts/cli.js, scripts/publish-locations.js, AGENTS.md, README.md, docs/references/menu-guide.md) |
| Generated artifacts | .github/skills/insights-audit-persona/SKILL.md, ~/.claude/skills/insights-audit-persona/SKILL.md |

---

## Strategic Recommendations

- **The skills pipeline pattern is reusable.** Adding a new skill now requires only two files: a
  YAML metadata file in `skills/meta/` and a Markdown content file in `skills/src/`. Running
  `node scripts/cli.js publish-skills` builds and deploys all skills in one step. This is the
  right pattern for any future agent-launcher skills.

- **Custom TargetRegistry over persona-builder CLI.** The decision to call the `build()` API
  directly with a custom `TargetRegistry` (rather than hacking the CLI with config files) is
  architecturally correct and proven by the nexus-personas reference implementation. Future skill
  authors should follow this pattern if additional output targets are needed.

- **`getPublishLocations()` scope must remain persona-only.** The blocking bug caught in WP-003
  (skills directory accidentally added to the persona publish-locations list, causing `clean-agents`
  to delete skill files) validates the value of code review. The fix (removing the errant entry,
  importing `getClaudeCodeSkillsDir()` directly) is the right pattern: path helpers may be imported
  individually; only persona-scoped directories belong in the central array.

- **skills/README.md agent-field warning is high-value.** The `⚠️ Runtime Dependency: the agent
  field` section in `skills/README.md` explains that skills using `agent:` require the named
  persona to be deployed via `scripts/sync-personas.js` first. This prevents silent IDE misses and
  should be preserved and expanded as the skill library grows.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Description | Type | Priority |
|---|---|---|---|---|---|
| 1 | WP-003, WP-004 (multiple agents) | Developer / QA | `cmdPublishSkills()` forwards CLI args (e.g. `--dry-run`) to the build step only — the publish step always writes. Passing `--dry-run` to `publish-skills` produces a misleading experience: build runs in check mode but files are still published. | deferred | low |
| 2 | WP-004 QA | QA | No automated test covers the build→publish sequencing or the abort-on-build-fail guard in `cmdPublishSkills()`. A unit test mocking `runScript()` would catch regressions if call order is changed. | deferred | low |
| 3 | WP-002, WP-003 (multiple agents) | Developer / QA / Reviewer | `scripts/build-skills.js` Claude Code frontmatter template emits a cosmetic blank line between `context: fork` and `agent: persona-curator` (caused by Handlebars `{{/if}}{{#if agent}}` delimiter newlines). Functionally valid YAML; cosmetically inconsistent with persona frontmatter rendering. | deferred | low |
| 4 | WP-003 Reviewer | Reviewer | `scripts/publish-skills.js` pre-build cleanup removes only top-level `.md` files. If a future skill produced subdirectory output, stale files in those subdirectories would linger. No concern with the current flat structure. | out-of-scope | low |
| 5 | WP-002 Developer | Developer | `scripts/build-skills.js` uses `import.meta.dirname` (ESM-only). If a CJS consumer ever needs to run this script it would require a wrapper. No concern for current usage (workspace root has `type: module`). | out-of-scope | low |

---

## Next Steps

1. **Add more skills.** The pipeline is ready. Any new agent launcher skill can be added by
   creating `skills/meta/{slug}.yaml` + `skills/src/{slug}.md` and running `node scripts/cli.js
   publish-skills`. Good candidates: a `changelog-curator` skill, a `planner` skill, a
   `release-check` skill that replaces the hand-written one.

2. **Address `--dry-run` asymmetry.** If `scripts/publish-skills.js` ever gains a `--dry-run`
   flag, update `cmdPublishSkills()` in `scripts/cli.js` to forward CLI args to both scripts.
   Update `docs/references/menu-guide.md` accordingly (the bash comment explaining the asymmetry
   should then be removed).

3. **Add a unit test for `cmdPublishSkills()`.** A test that mocks `runScript()` and verifies the
   build→publish call order and abort-on-build-fail guard would protect against regressions.

4. **Run `node scripts/cli.js ctx-generate`** to regenerate `.context/` now that `AGENTS.md`,
   `README.md`, and `docs/references/menu-guide.md` have been updated. The CTX snapshot will be
   stale until regenerated.

5. **Tag a release.** The skills pipeline is a meaningful new capability. Consider bumping the
   workspace root version and tagging once any remaining changelog entries are written.
