# Spec — Persona-Builder Local Dev Linking Infrastructure

**Date:** 2026-08-25
**Status:** Spec — ready for planning
**Audience:** Planner

---

## Purpose

Give `ai-insights` a documented, low-friction way to develop and test `@mistralys/persona-builder`
changes locally — across both repos — before publishing a new version to npm. Today this requires
reconstructing the `npm link` workflow from scratch each time, because no skill, script, or AGENTS.md
section describes it.

---

## Background

`ai-insights/personas/package.json` depends on `@mistralys/persona-builder` via a registry semver
range (currently `^2.6.0`). This is correct for production and CI — the `release-check` skill in
`ai-insights` explicitly checks for and rejects `file:` paths in `personas/package-lock.json`
(`.github/skills/release-check/SKILL.md` §3a), because those break `npm ci` on any machine that
doesn't have `ai-persona-builder` checked out as a sibling directory.

That guard is correct, but it leaves a gap: there is no *sanctioned alternative* for the case where
someone is actively changing `ai-persona-builder` source and wants to see the effect in a real
`ai-insights` persona build without a publish/version-bump/install round trip. This gap was
rediscovered ad hoc during this session (2026-08-25) while fulfilling a request to "update the persona
builder to the latest version, and configure it as a symlink in AI Insights."

## What Was Done Ad Hoc This Session

1. `cd ai-persona-builder && npm run build && npm link` — builds `dist/` from current `main` and
   registers the package in the global npm link store.
2. `cd ai-insights/personas && npm link @mistralys/persona-builder` — replaces
   `personas/node_modules/@mistralys/persona-builder` with a symlink to the local
   `ai-persona-builder` checkout (`../../../../ai-persona-builder` relative path, since both repos
   are sibling directories under the same workspace root).
3. Verified with `node scripts/build-personas.js --check` (129 personas processed, all suites).
4. Confirmed `git status` on `ai-insights` showed zero diff — `npm link` only touches the gitignored
   `node_modules/` tree, never `package.json` or `package-lock.json`. Fully reversible via a plain
   `npm install` in `personas/`.

No committed file changed as a result. This is exactly the safe/reversible property the workflow
needs, but it was arrived at by trial and error rather than following a documented procedure.

## Friction Encountered

- **No discoverable workflow.** Neither `ai-persona-builder/AGENTS.md` nor
  `ai-insights/personas/docs/agents/project-manifest/` mentions `npm link` as the sanctioned path for
  cross-repo local development. The only existing reference to the two repos' relationship in
  `ai-insights` is the `release-check` skill's warning to *avoid* `file:` dependencies — a rule with
  no accompanying "here's what to do instead during development" companion.
- **Version-field drift caused a false lead.** `ai-persona-builder/package.json` reports `2.5.1`,
  while `CHANGELOG.md` documents `v2.6.1` and Git tags go up to `v2.6.0`. Investigation found the
  `v2.6.0` version-bump commit (`52f1e63`, message `"2.6.0"`) landed on a branch that was never merged
  into `main` — `main` has all the *content* commits (changelog-derived versioning, tools serializer,
  docs bundling) but the version-bump commit itself is an orphaned sibling. This is a real defect in
  the release history, independent of the linking task, and cost investigation time before it could be
  ruled out as "linking picked up the wrong ref."
- **No rebuild-on-change reminder.** The symlink makes `ai-persona-builder`'s `dist/` visible to
  `ai-insights` immediately, but `dist/` is not rebuilt automatically — there's no watch script wired
  up (`npm run dev` exists in `ai-persona-builder` via `tsup --watch` but nothing documents that this
  is the intended pairing for the linked workflow). Forgetting this step silently serves stale
  library code with no error.

---

## Requested Infrastructure

1. **A documented local-linking procedure**, placed where an agent or developer entering either repo
   would find it before reinventing the steps. Candidate locations (Planner to decide the best fit):
   - A new section in `ai-persona-builder/AGENTS.md` (e.g. under a "Local Development" or
     "Cross-Repo Testing" heading), and/or
   - A new section in `ai-insights/personas/docs/agents/project-manifest/tech-stack.md` or
     `constraints.md`, alongside the existing `@mistralys/persona-builder` dependency row, and/or
   - A short-form entry in the `release-check` skill's context section clarifying that `npm link` is
     the correct *development-time* counterpart to the `file:`-path rule it enforces at
     *release-time*.
2. **Explicit mention of the `npm run dev` (tsup watch) pairing** — i.e., when linked, run the watch
   build in `ai-persona-builder` rather than one-shot `npm run build`, so edits propagate without a
   manual rebuild step. Document the trade-off (watch mode leaves a background process running) so
   the agent chooses correctly per session length.
3. **A revert/unlink step** — `cd ai-insights/personas && npm install` restores the registry-resolved
   version. This should be documented alongside the link steps, not left implicit, since forgetting to
   unlink before committing/testing a release could mask the exact `file:`-path class of bug the
   `release-check` skill's step 3a exists to catch (though `npm link` itself never touches
   `package-lock.json`, so the two failure modes are actually distinct — worth stating plainly so
   nobody conflates them).
4. **Fix or flag the `ai-persona-builder` version-field drift** (`package.json` at `2.5.1` vs.
   `CHANGELOG.md`/tags at `2.6.1`/`v2.6.0`) as a small separate cleanup — either cherry-pick the
   orphaned `52f1e63` version bump onto `main`, or run a fresh `npm version` pass reconciling
   `package.json` to match the changelog's top entry, per that repo's own `release-check` skill
   (§1, "Changelog version ahead check"). This is not blocking for the linking workflow itself, but
   should not be left to be rediscovered by the next session.

## Non-Goals

- This spec does not propose any change to the `release-check` skill's `file:`-path rejection rule —
  that guard remains correct and necessary for CI/fresh-clone safety.
- This spec does not propose publishing a new `@mistralys/persona-builder` version. The version-field
  drift noted above is a documentation/process cleanup, not a release trigger.
- This spec does not cover `cli-menu`, which has the same sibling-repo relationship to `ai-insights`
  as `ai-persona-builder`; if the Planner judges the same linking documentation should generically
  cover any local sibling-repo dependency rather than being persona-builder-specific, that
  generalization is in scope for the Planner to decide, not prescribed here.

## Subsequent Additions by the User

### Addition 1

THe developer reported this during their last task. When developing AI Insights, we occasionally need to make changes in the persona builder and CLI Menu sibling projects. To make this easier, both packages can be symlinked into the project to make implementation and testing possible without first publishing those packages. The publishing is always a separate step that I organize manually once I am satisfied with the implementation, and when it has been sufficiently tested.

This means that we also need a simple way for agents to swich between DEV symlink mode and PROD mode (using live npm installed dependencies) - in addition to a marker to identify which mode the project is currently in.

A sister feature is a git commit guard that ensures that no changes to package files can be committed that point to local folder symlinks.

### Addition 2

Project documentation should also tell agents to switch to dev mode autonomously when changes are requested to any of the sibling packages. 

### Addition 3

And also integrate the switch into the CLI menu for the user to access manually.
