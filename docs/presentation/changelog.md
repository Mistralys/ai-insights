# Presentation Slides Changelog

## v1.2.0 (2026-08-31) - **WIP UNRELEASED**
- New Part 1 slide on trigger anchoring: a persona's limit is instruction salience, not length,
  with an info modal on gates that only look observable.
- Title and cross-reference audit: corrected two mislabelled section labels, the README Curator
  team-card description, and three speaker-note pointers naming the wrong slide or part.
- Part 1 now matches the injected persona source: workflow steps, section names and the
  constraints heading were stale, and the line and step counts have been dropped.
- New opening slide on the project philosophy: focus on what works with any model, and on
  tooling that stays under our own control.
- New Part 3 slide on the multi-store system: splitting ledger data by concern, and sharing a
  store to give a team the same history and knowledge.
- Added an `.ext-link` utility for outbound links in slide text; first use points at the
  example ledger storage repository.
- Added a screenshot carousel component; the Keeping Track slide now switches between the
  project overview, work package states, project detail, and a stored knowledge insight.
- Carousel screenshots are clickable, opening a fullscreen zoom lightbox that closes on any
  click or `ESC`.
- Carousel screenshots ship as downscaled JPGs, trimming the build output.
- Part 3 now covers every execution environment: an overview slide plus a detail slide each
  for VS Code, the orchestrator, and Claude Code.
- Corrected the VS Code slide: handoffs are automatic through to synthesis, and full
  visibility of the run is the differentiator rather than manual stage invocation.
- Added a scrollable screenshot modal for images too tall to place on a slide, opened from a
  `data-shot` `.info-link`. First use: a full-length VS Code workflow transcript.
- The orchestrator slide was rewritten as an environment detail slide and renamed to
  `ledger-workflow/env-orchestrator`.
- Slide fragments now live in per-section subfolders under `slides/` (e.g. `agent-personas/`,
  `build-system/`) instead of one flat directory, matching the deck's part structure.
- Added an overflow audit: open the deck with `?audit` or press `Shift+O` to find slides
  running past the viewport.
- Images are now inlined once instead of per occurrence, so reusing a screenshot across
  slides no longer duplicates its payload.
- Recap slides share a `.recap-stack` density preset sized for the longest part of the deck.
- Design reference documents the contrast reference stop, the audit, and the image lookup.
- Part 3 gained four slides on the ledger itself: what is on disk, how handoffs are routed,
  what happens when a stage fails, and the GUI that makes it all reviewable.
- The GUI screenshot moved from the demo divider to the new Part 3 slide, halving the build output.
- Part 3 recap updated and condensed to cover the added ground.
- Added a design reference and a resource index README under `docs/presentation/`.
- The deck now honours `prefers-reduced-motion` in both the stylesheet and the Reveal config.
- Extracted the repeated card-stack, glass-card and muted-text recipes into named classes.
- Build script gained `--check`, wired into the pre-commit hook as an advisory warning.
- New Part 1 slide on the Persona Design Guide: domain-neutral, build-agnostic, versioned.
- Info modal explaining audit stamps and documented deviations.
- Added a reusable inline info modal, opened from a clickable `.info-link` in slide text.
- MCP slide: "A human can be an MCP server" now opens an `ask_expert` walkthrough.
- New "Newer Is Not Simply Better" slide on model versions not being a linear progression.
- All modals now scale their text with the window, matching the rest of the deck.
- Reframed the strategic vision slide around the architect's own lens.
- Made explicit that the whole pipeline inherits the vision, not just the Planner.
- Added a "Working With the Model" part covering the limits of the approach.
- Added a slide on the project documentation an agent needs to work meaningfully.
- Promoted the strategic vision from a footnote to its own slide.
- Added slides on personas vs. skills, AX, MCP basics, and per-stage model selection.
- Added an "IDE is not only for developers" slide with a real non-developer example.
- Added recap slides at each part boundary and a questions slide.
- Updated the plan count to 550+ and the standalone persona count to 24.

## v1.1.5 (2026-06-17) - Improved Onboarding
- Added new slides for a smoother start.

## v1.1.4 (2026-06-16) - Minor Tweaks
- Using a better carbonara recipe example.
- Wording adjustments for a non-technical audience.

## v1.1.3 (2026-06-15) - Improved Workflow
- Workflow slide now shows the agentic loop.
- Marked the optional agents in the workflow slide.

## v1.1.2 (2026-06-15) - New slides
- Added an Orchestrator slide.
- Added a template syntax slide.
- Added a statistics slide.

## v1.1.1 (2026-06-15) - Wording & Layout
- Tweaked wording in some slides.
- Tweaked layout in some slides.

## v1.1.0 (2026-06-15) - Slide Registry Refactor
- Refactored to use individual slide partials.
- Order of slices now handled via `slides.json`.

## v1.0.0 (2026-06-15) - Initial Release
- Initial release.
