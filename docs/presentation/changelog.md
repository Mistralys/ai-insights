# Presentation Slides Changelog

## v1.2.0 (2026-08-31) - **WIP UNRELEASED**
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
