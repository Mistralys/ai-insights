# AI Insights Presentation

A Reveal.js slide deck introducing the AI Insights project: persona crafting, the persona build
system, the project ledger and multi-agent workflow, and the practicalities of working with models.

Runtime is roughly two hours, structured as four parts with a demo break and recap slides at each
part boundary.

---

## Quick Start

```sh
# from this directory
./build.sh            # build once  → dist/ai-insights-slides.html
./build.sh --watch    # rebuild on any source change
./build.sh --check    # is dist/ up to date? (read-only, exits 1 if stale)
```

On Windows use `build.cmd` with the same arguments.

Then open `dist/ai-insights-slides.html` in a browser. The file is self-contained apart from the
Reveal.js and Google Fonts CDN requests, so it can be copied anywhere with network access.

**Requires:** Node.js (built-ins only — no `npm install`).

---

## Presenting

| Key | Action |
|-----|--------|
| `→` / `Space` | Next slide |
| `←` | Previous slide |
| `Esc` | Slide overview |
| `S` | Speaker-notes window (notes are authored on nearly every slide) |
| `F` | Fullscreen |

Two chrome affordances sit in the top-right corner:

- **☰ Outline** — a navigable drawer listing every slide grouped by section.
- **📄 Persona source** — the full Recipe Curator persona in Markdown, for the "what does one
  actually look like" question.

Some slides carry inline ⓘ links that open a deeper explanation without leaving the slide.

### Checking for overflow

After editing slides, open the deck with `?audit` appended to the URL — or press `Shift+O` at any
time — to log every slide whose content runs past the viewport. Overflow collides with the nav
arrows in the bottom-right corner, which is easy to miss by eye.

---

## Resources

| Resource | What it is |
|----------|-----------|
| [docs/design-reference.md](docs/design-reference.md) | **The design contract.** Tokens, palette, typography, slide anatomy, component inventory, interactive layer, build pipeline, and the add-a-slide checklist. Read this before editing anything. |
| [notes.md](notes.md) | Raw idea backlog — points not yet turned into slides. |
| [changelog.md](changelog.md) | Version history. The top entry's version and date are injected onto the title slide at build time. |
| [slides.json](slides.json) | Slide order and section labels. The deck's table of contents. |

---

## Source Layout

```
presentation/
├── template.html      # shell: head, all CSS, modal markup, Reveal init
├── slides.json        # slide order + section labels
├── slides/            # one <section> per file, grouped into per-section subfolders
├── partials/          # Markdown injected into modals at build time
├── img/               # PNGs, inlined as base64 by the build
├── tools/build.js     # build script (Node built-ins only)
├── docs/              # design reference
└── dist/              # build output — never edited by hand
```

### Where do I edit?

| I want to… | Edit |
|------------|------|
| Change slide text | `slides/{section}/{name}.html` |
| Add a slide | New file in the matching `slides/{section}/` subfolder, then register it in `slides.json` as `{section}/{name}` |
| Reorder or re-section slides | `slides.json` |
| Change styling | The `<style>` block in `template.html` |
| Change modal or chrome behaviour | The Reveal init script in `template.html` |
| Add an image | Drop it in `img/`, then register it in `IMAGE_MAP` in `tools/build.js` |
| Change the recipe comparison content | `partials/recipe-results-*.md` |

Slide fragments never declare a `<style>` block and never load an external asset. See the
[design reference](docs/design-reference.md) for the full set of contracts.

---

## Related Documentation

| Document | Relevance |
|----------|-----------|
| [Persona Design Guide](../../personas/docs/persona-design-guide.md) | The artifact Part 1 describes. |
| [Ledger workflow guide](../../personas/ledger/README.md) | The nine-agent workflow shown in Part 3. |
| [Agents overview](../references/agents-overview.md) | Every persona across all three suites. |
| [Workflow specification](../../mcp-server/docs/agents/workflow-specification/README.md) | State machines and routing behind the ledger slides. |
| [Docs site index](../index.md) | Publishes the built deck. |
