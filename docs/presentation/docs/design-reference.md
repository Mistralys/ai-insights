# Presentation Design Reference

The visual and structural contract for the AI Insights slide deck. Read this before adding a slide,
introducing a component, or touching `template.html`.

The deck is built on [Reveal.js 5.1.0](https://revealjs.com/) loaded from a CDN, themed on top of
`theme/black.css`. Everything below describes the layer this project adds on top of that theme.

---

## 1. Source Layout

| Path | Role |
|------|------|
| `template.html` | The shell: `<head>`, all CSS, modal markup, chrome, and the Reveal init script. **All styling lives here.** |
| `slides/{section}/*.html` | One `<section>` per file, grouped into a subfolder per deck section (e.g. `slides/agent-personas/`). Content only — no `<style>` blocks. |
| `slides.json` | Slide order and section labels, referenced as `{section}/{name}` (no `.html`). A fragment not listed here is not in the deck. |
| `partials/*.md` | Markdown injected into modals at build time. |
| `img/*.png` | Raster assets, inlined as base64 by the build. |
| `dist/ai-insights-slides.html` | Build output. Single self-contained file. Never edited by hand. |

**Rule:** a slide fragment never declares a `<style>` block and never loads an external asset.
New reusable styling belongs in the `<style>` block in `template.html`.

---

## 2. Design Tokens

Declared on `:root` in `template.html`. Prefer the token over the literal value.

### Reveal overrides

| Token | Value | Purpose |
|-------|-------|---------|
| `--r-background-color` | `#0f0f1a` | Base canvas (the visible background is the gradient below). |
| `--r-main-color` | `#e0e0e0` | Body text. |
| `--r-heading-color` | `#ffffff` | Heading text. |
| `--r-link-color` | `#64b5f6` | Links. |
| `--r-heading-font` / `--r-main-font` | `'Inter'` | Headings and body. Weights 300/400/600/700. |
| `--r-code-font` | `'JetBrains Mono'` | Code and monospace blocks. Weights 400/600. |
| `--r-main-font-size` | `28px` | Base size at the 1280×720 design viewport. |

### Glass surface

| Token | Value |
|-------|-------|
| `--glass-bg` | `rgba(255, 255, 255, 0.04)` |
| `--glass-border` | `rgba(255, 255, 255, 0.08)` |
| `--glass-shadow` | `0 8px 32px rgba(0, 0, 0, 0.3)` |

### Card-stack knobs

Set these on a `.card-stack` element to tune per-slide density. They are the **only**
sanctioned way to vary a stack — never re-declare the layout inline.

| Property | Default | Controls |
|----------|---------|----------|
| `--stack-width` | `800px` | `max-width` of the column. |
| `--stack-size` | `0.75em` | `font-size` of the column. |
| `--stack-gap` | `0.55em` | Vertical gap between items. |
| `--card-padding` | `0.6em 1em` | Padding on descendant `.glass-card` elements. |

### Background

The viewport gradient is the deck's signature and is not tokenised:

```css
radial-gradient(ellipse at 20% 50%, #162447 0%, #0f0f1a 50%, #0a0a14 100%)
```

---

## 3. Colour Palette

Semantic first — reach for a utility class before a hex literal.

| Class | Colour | Meaning |
|-------|--------|---------|
| `.accent` | `#ffd54f` amber | Emphasis, "the point of the slide", forward pointers. |
| `.accent-green` | `#81c784` green | Positive, resolved, "after" state, checkmarks. |
| `.accent-red` | `#ef9a9a` red | Negative, problem, "before" state. |
| `.accent-blue` | `#64b5f6` blue | Structural / system-level emphasis. |

Colours used directly in CSS and (sparingly) inline:

| Hex | Role |
|-----|------|
| `#64b5f6` | Primary blue — section labels, `h3`, numbers, arrows, links, focus rings. |
| `#90caf9` | Lighter blue — modal titles, hover states, gradient start. |
| `#ce93d8` | Purple — human-in-the-loop markers, `h2` gradient end. |
| `#90a4ae` | Muted grey-blue — secondary and supporting copy. **The most-used colour in the deck.** |
| `#b0bec5` | Slightly brighter muted grey — `em`, modal body secondary text. |
| `#c0c8d0` | Monospace body text inside modals. |
| `#ffffff` / `#fff` | Maximum-emphasis text, `strong`. |

For secondary copy, use the `.muted` class rather than an inline `color: #90a4ae`.

**Non-negotiable:** never introduce a fifth accent hue. If a new state needs signalling, express it
with weight, size, border, or an existing accent — not a new colour.

---

## 4. Typography

| Element | Size | Weight | Notes |
|---------|------|--------|-------|
| `h1` | `2.2em` | 700 | Title slide only. Layered text-shadow + blue glow. |
| `h2` | `1.6em` | 600 | Every content slide. Blue→purple gradient clipped to the text. |
| `h3` | `1.2em` | 600 | Sub-headings, coloured `#90caf9`. |
| Body | `1em` (`28px`) | 300 | `letter-spacing: -0.01em` deck-wide. |
| `.subtitle` | `0.7em` | — | Under `h1`. |
| `.section-label` | `0.5em` | — | Uppercase, `0.15em` tracking, blue. Sits **above** the `h2`. |
| `.lead` | `0.8em` | — | One-line framing sentence under the `h2`. |
| `.sidenote` | `0.65em` | — | Italic aside with a blue left rule. |

Dense content blocks are typically scaled to `0.7em`–`0.78em` and constrained to a
`max-width` of `760px`–`800px` with `margin: 0 auto`.

The `h2` gradient relies on `-webkit-background-clip: text` with a transparent fill. Do not add a
`color` declaration to an `h2` — it will be ignored in WebKit/Blink and will *win* elsewhere,
producing an inconsistent heading.

---

## 5. Slide Anatomy

Every content slide follows the same skeleton:

```html
<section>
  <p class="section-label">Part 2 &mdash; Build System</p>
  <h2>Slide Title</h2>
  <p class="lead">One sentence framing what follows.</p>

  <div class="card-stack" style="--stack-size: 0.73em;">
    <div class="glass-card">
      <strong class="accent">Point headline.</strong><br>
      <span class="muted">Supporting detail.</span>
    </div>
  </div>

  <aside class="notes">
    Speaker notes. Plain prose, blank-line separated paragraphs.
  </aside>
</section>
```

### Contracts

1. **Every content slide has exactly one `h2`.** The outline panel is built by querying `h2`
   inside each section — a slide without one is invisible in the outline. The title slide is the
   only intentional exception (it carries `h1`).
2. **Every content slide has `<aside class="notes">`.** Part dividers are the exception; they carry
   only a label, an `h2`, and a one-line strapline.
3. **Section labels mirror `slides.json`.** The label on the slide should match the section it is
   registered under.
4. **Entities are named, never counted.** No "3 personas", "12 agents" — counts go stale between
   the slide, the notes, and the codebase.

### Slide archetypes

| Archetype | Shape |
|-----------|-------|
| **Title** | `h1` + `.subtitle` + version line + author. |
| **Part divider** | `.section-label` (`Part N`) + `h2` + one `.muted` strapline. No notes. |
| **Stacked cards** | `.card-stack` of `.glass-card` items, each `strong.accent` headline + `.muted` body. The deck's default body layout. |
| **Comparison** | `.compare` with a `.label.before` / `.label.after` pair. |
| **Diagram** | A dedicated component (`.pipeline`, `.build-flow`, `.platform-grid`). |
| **Table** | `.equipment-table` or `.rainbow-table`. |
| **Recap** | Flex column of `✓`-prefixed lines + a `Next:` pointer using `.accent`. |
| **Image** | Centred `<img>`; global styling applies a radius and drop shadow. |

---

## 6. Component Inventory

All defined in `template.html`. Reuse before inventing.

### Layout

| Class | Purpose |
|-------|---------|
| `.card-stack` | **The default body layout.** Centred, left-aligned, constrained flex column. Tuned via the knobs in §2. |
| `.recap-stack` | Density preset for recap slides, applied alongside `.card-stack`. Sized for the longest part in the deck and zeroes `p` margins so the flex gap is the only rhythm. Do not override its knobs per slide — shorten the copy instead. |
| `.glass-card` | A single item inside a `.card-stack`, or standalone. Padding via `--card-padding`. |
| `.two-col` | Flex row, equal-width children, `2em` gap. |
| `.glass` | The glass surface as a standalone utility: bg, blur, border, radius, shadow. |
| `.compare` | Two-or-more glass columns for before/after. Children take `.label.before` / `.label.after`. |

`.glass` and `.glass-card` are distinct on purpose: `.glass` blurs its backdrop and carries the
deeper `--glass-shadow`; `.glass-card` is the flatter, cheaper card used inside stacks.

### Diagrams

| Class | Purpose |
|-------|---------|
| `.pipeline` | Horizontal agent row. Children: `.agent-wrapper` → `.agent-card` (with `.num`, `.name`, `.role`) separated by `.arrow`. |
| `.agent-card.optional` | Adds a `*` marker top-right. |
| `.agent-card.has-subagents` | Amber border, pairs with a `.subagents` block. |
| `.subagents` / `.pill` | Amber sub-agent pills rendered below a card. |
| `.loop-bracket` / `.loop-label` | Dashed bracket around a repeating stage range. |
| `.human-marker` | Purple caption above a card marking a human-in-the-loop point. |
| `.build-flow` | Horizontal step row of `.box` items separated by an arrow `div`. Modifiers `.box.source` (green), `.box.engine` (amber), `.box.target` (blue). Also used for non-build step cycles; wrap it in `.loop-bracket` to close the loop. |
| `.platform-grid` | Two-column capability matrix. Status classes: `.status-full`, `.status-partial`, `.status-none`. |
| `.ledger-roles` | Vertical list of `.role-item` (`.role-name` + `.role-desc`). |
| `.knowledge-scopes` | Side-by-side glass panels with `h3` headings. |
| `.persona-structure` | Numbered section list: `.section` → `.num` + `.label` + `.desc`. |
| `.team-grid` | Four-column card grid: `.team-card` → `.team-icon` + `.team-name` + `.team-desc`. |
| `.shot-carousel` | Switchable screenshots with a per-image caption footnote (see §7). |
| `.shot-zoom` | Generated button wrapping a carousel image; opens the zoom lightbox (see §7). |

### Tables

| Class | Purpose |
|-------|---------|
| `.equipment-table` | `0.6em` glass table, blue headers. |
| `.rainbow-table` | `0.55em` glass table; supports `.color-dot` swatches. |

### Text utilities

| Class | Purpose |
|-------|---------|
| `.muted` | Secondary copy in `#90a4ae`. Use instead of an inline colour. |
| `.card-eyebrow` | Small uppercase category label at the top of a card. |
| `.principle-quote` | A quoted principle, set apart as its own block within a card. |
| `.sidenote` | Italic aside with blue left rule. |
| `.strike` / `.better` | Red strikethrough vs. green replacement. |
| `.info-link` | Inline button opening an info modal (see §7). |
| `.ext-link` | Inline anchor to an external URL. The `.info-link` counterpart for a real `<a>`: same blue, same focus ring, a `↗` glyph instead of `ⓘ`. Always pair with `target="_blank"` and `rel="noopener noreferrer"`. |

> Inline `style` attributes remain acceptable for genuine one-offs — a single `font-size` or
> `margin-top` on one element. They are **not** acceptable for anything that repeats across slides;
> that becomes a class here.

---

## 7. Interactive Layer

Four modals and two chrome toggles, all wired in the Reveal `.then()` callback in
`template.html`.

### Info modal — the extensible one

The pattern to use for any "explain this in more depth" affordance. Content lives in a `<template>`
inside the slide fragment, so it stays next to the text that references it:

```html
<p>
  … makes maintenance a
  <button type="button" class="info-link"
          data-info="info-audit-stamp"
          data-info-title="Audit stamps &amp; accepted deviations">mechanical check</button>.
</p>

<template id="info-audit-stamp">
  <p>Explanatory prose. <code>inline code</code> is styled.</p>
</template>
```

| Attribute | Meaning |
|-----------|---------|
| `data-info` | `id` of the `<template>` holding the body. Required. |
| `data-info-title` | Modal heading text. |

Behaviour: real `<button>`, keyboard-activated by Enter *and* Space (Space is intercepted so Reveal
does not advance the slide), focus moves to the close button on open and returns to the trigger on
close, Tab is trapped, and `Escape` / `Enter` / `Space` all close it.

### Screenshot modal — for tall images

For a screenshot too tall to sit on a slide, e.g. a full-length chat transcript. Uses the same
`.info-link` trigger styling, distinguished by a `⤢` glyph instead of `ⓘ`:

```html
<button type="button" class="info-link"
        data-shot="img/full-vscode-workflow.png"
        data-shot-title="A full workflow run in VS Code"
        data-shot-alt="…">See a whole run</button>
```

| Attribute | Meaning |
|-----------|---------|
| `data-shot` | `IMAGE_MAP` key of the image. Required, and must be registered in `tools/build.js`. |
| `data-shot-title` | Modal heading text. |
| `data-shot-alt` | `alt` text for the image; falls back to `data-shot-title`. |

The image is resolved from the build-injected `imageData` lookup, so it costs no extra payload if the
same file is also used on a slide.

The frame is a fixed `height: 92vh` rather than a `max-height` — the image is taller than any
viewport, so the frame claims the space rather than being sized by its content. The image fills the
frame width; scrolling happens in `.shot-scroll`.

Behaviour: focus lands on the **scroll pane**, not the close button, because arrow keys are the
point. Inside the modal, `↑` `↓` scroll by a step, `PgUp` / `PgDn` / `Space` by a near-page, `Home` /
`End` jump to the ends, `Tab` alternates pane ↔ close, and `Escape` closes. Every key is swallowed
before Reveal sees it, so the deck never advances while the modal is open.

### Screenshot carousel — for a set of related screenshots

For several screenshots that make one point together, where the slide only has room for one at a
time. A fragment declares the figures; the arrows and dots are generated at load:

```html
<div class="shot-carousel">
  <div class="shot-stage">
    <figure class="shot-slide">
      <img src="img/ledger-gui.jpg" alt="…">
      <figcaption>Filterable overview of projects</figcaption>
    </figure>
    <figure class="shot-slide">…</figure>
  </div>
</div>
```

| Knob | Default | Controls |
|------|---------|----------|
| `--shot-height` | `370px` | Height of the stage. Fixed, so the caption and controls never move between images. |
| `--shot-width` | `92%` | Width of the stage within the slide. |
| `--shot-caption-space` | `40px` | Space reserved below the image for the caption footnote. |
| `--shot-space-above` | `20px` | Gap above the stage. Replaces the top margin a bare slide `<img>` would contribute — the carousel zeroes that margin, because inside the zoom button's flex box it overflows the box instead of spacing it. |

Contracts:

- Every `.shot-slide` carries exactly one `<img>` and one `<figcaption>`. The caption text also
  becomes the dot's `aria-label`, so it must read as a standalone description.
- Each image must be registered in `IMAGE_MAP` (§10), like any other slide image.
- A carousel with fewer than two figures is left alone — no controls are generated.
- The `<img>` is sized by `max-height`, not stretched to the frame with `object-fit`. The global
  `.reveal img` shadow paints around the *element box*, so a letterboxed image would draw its
  shadow around empty space rather than the screenshot.

Behaviour: real `<button>` arrows and dots, `aria-label` from each caption, `aria-current` on the
active dot, and `aria-hidden` maintained on the inactive figures. While focus is inside the
controls, `←` `→` switch images and Space activates the focused button — all three are swallowed
before Reveal sees them, so the deck never advances. Active state is signalled by dot width as
well as colour.

Each image is also wrapped in a `.shot-zoom` button at load, opening the zoom lightbox below. A
`click to enlarge` hint is appended to the caption and marked `aria-hidden` — the trigger's own
`aria-label` already carries it.

### Zoom lightbox — for a wide image

A fullscreen fit-to-viewport view of a single image. The counterpart to the screenshot modal:
`#shot-modal` scrolls an image *taller* than any viewport, `#zoom-modal` fits a *wide* one.

There is no `data-` trigger attribute — the lightbox is opened from JS via
`openZoom(src, alt, caption, opener)`, and the carousel is currently its only caller. The whole
overlay is the close affordance, so it carries `cursor: zoom-out` and the focus ring rather than
hosting a close button.

Behaviour: any click closes, as do `Escape`, `Enter` and Space. Focus moves to the overlay on open
and returns to the trigger on close, and `Tab` is pinned to the overlay so focus cannot reach the
slide behind it. Every key is swallowed before Reveal sees it. The image is capped at `84vh` so the
caption and the close hint always stay in view.

### Recipe modal

Driven by `data-modal="before"` / `data-modal="after"` on `.compare` children. Bodies come from
`partials/recipe-results-vanilla.md` and `partials/recipe-results-persona.md`, rendered to HTML at
build time. A `click to expand` hint is generated via `::after`.

### Persona source modal

Opened from the `📄` toggle at `top: 16px; right: 64px`. Shows
`personas/standalone/src/content/recipe-curator.md` verbatim in a `<pre>`.

### Outline panel

Opened from the hamburger toggle at `top: 16px; right: 16px`. A 320px right-hand drawer built at
runtime from the build-injected outline data (section label + slide `h2`), with the current slide
highlighted.

### Modal type scale

Modals track Reveal's own slide scale so their text matches deck text at any window size:

```css
--modal-scale: clamp(0.6, var(--slide-scale, 1), 1.6);
```

`--slide-scale` is set by Reveal on `.reveal-viewport`. The `clamp()` floor and ceiling keep extreme
window sizes readable. Any new modal must adopt this variable rather than a fixed `px` font size.

### Overflow audit

A development aid, not presenter chrome. It walks every slide and reports any whose bottom edge runs
past the viewport — the deck's most common defect, and the easiest to miss because the overflow
collides with the nav arrows in a corner you are not watching.

| Trigger | Effect |
|---------|--------|
| `?audit` in the URL | Runs once on load. |
| `Shift+O` | Runs on demand at the current window size. |
| `auditOverflow()` in the console | Returns a promise resolving to the failure array. |

Failures are printed with `console.table` as slide number, title, and overflow in pixels; a clean
run logs the viewport it passed at. The audit needs Reveal's normal slide mode — at very small
windows Reveal switches to its scroll view, where per-slide overflow is meaningless, and the audit
warns and exits instead of reporting nonsense.

---

## 8. Motion

Motion is used only where it signals interactivity or state:

| Effect | Where |
|--------|-------|
| `transform: translateY(-2px)` + deeper shadow on hover | `.agent-card`, `.team-card`, `[data-modal]` |
| `background` fade on hover | Toggles, modal close buttons, outline items |
| `right` slide-in, `0.3s ease` | Outline panel |
| `opacity` cross-fade, `0.25s ease` + dot `width` | Screenshot carousel — signals that the image changed |

The zoom lightbox declares no transitions: it appears and disappears instantly, so there is nothing
for the reduced-motion query to suppress.
| Reveal `slide` transition, default speed | Slide changes |

Do not add decorative or looping animation.

### Reduced motion

`prefers-reduced-motion: reduce` is honoured on both layers:

- **CSS** — a media query at the end of the `<style>` block zeroes `transition` on every animated
  element and `transform` on the hover lifts. Hover feedback survives as a border colour change on
  `.agent-card`, so the affordance is not lost, only the travel.
- **JS** — `Reveal.initialize()` reads the query once and passes `transition: 'none'`.

Anything new that moves must be added to the media query's selector list. The preference is read at
load time, so a mid-session OS change needs a page reload.

---

## 9. Accessibility Baseline

Requirements for anything newly added:

- **Interactive elements are real buttons.** `.info-link` is a `<button>`; follow that, not a
  clickable `<div>`.
- **Focus is visible.** `.info-link:focus-visible` uses a `2px solid #90caf9` ring with
  `3px` offset. Match it.
- **The ring goes on what the user sees.** Where a button is larger than its visible content —
  a wrapper around a letterboxed image, say — move the ring to the descendant that is actually
  rendered, as `.shot-zoom:focus-visible img` does. A ring tracing an invisible box reads as a
  layout bug.
- **Hit targets are floored in pixels.** Interactive controls need ≥ 24px in both axes. Size them
  with a `min-width` / `min-height` in `px`, not `em` alone — Reveal scales the slide, so an `em`
  box shrinks below the floor at smaller windows. Where the visible marker should stay small, put
  it on a `::before` and let the button carry the target (see `.shot-dot`).
- **Reveal steals keys.** Space advances the slide and Escape opens the overview. Any new key
  handler must call `stopImmediatePropagation()` in the capture phase, as the existing modal
  handlers do.
- **Non-text contrast.** Borders, icons and focus rings need ≥ 3:1 against their backdrop.
  `--glass-border` at `0.08` alpha is decorative only — never rely on it to convey state.
- **Measure contrast against `#162447`.** The canvas is a gradient, so the same text colour yields
  different ratios depending on where a slide sits. `#162447` is the lightest stop and therefore the
  worst case — clearing it clears the whole deck. Body copy targets ≥ 4.5:1 against it.
- **Images carry `alt` text.** Both current images do.
- **Colour is never the only signal.** `.status-*` and before/after states pair colour with a label
  or glyph.
- **Motion is opt-out.** New animated elements join the `prefers-reduced-motion` selector list
  (see §8).

---

## 10. Build Contract

`tools/build.js` — Node.js built-ins only, no dependencies. Run from the presentation root:

```sh
./build.sh            # single build
./build.sh --watch    # rebuild on change
./build.sh --check    # read-only staleness check, exits 1 if dist/ is stale
```

`--check` (alias `--dry-run`) renders the deck in memory and compares it byte-for-byte against the
committed `dist/` output, reporting the first differing line. It never writes. The repository
pre-commit hook runs it as an **advisory warning** whenever a presentation source is staged, in the
same spirit as the existing `.context/` staleness warning — it never blocks a commit.

Steps, in order:

1. Concatenate `slides/{section}/*.html` in `slides.json` order into `<!-- BUILD:SLIDES -->`.
   **Must run first** so placeholders inside fragments are visible to later steps.
2. Inject outline data (`label`, `startIndex`, `count` per section) into `/* BUILD:OUTLINE_DATA */`.
3. Inline every PNG in `IMAGE_MAP` as a base64 data URI. Each image is emitted **once** into
   `/* BUILD:IMAGE_DATA */` and rewritten from `src="img/…"` to `data-img="img/…"`; the init script
   assigns the real `src` at load. Inlining per occurrence would duplicate the entire payload for
   every slide that reuses the same image.
4. Render the recipe Markdown partials to HTML and inject them as JS string literals.
5. Inject the Recipe Curator persona source as a JS template literal.
6. Inject the version and date parsed from the top entry of `changelog.md`.

### Placeholders

| Placeholder | Filled with |
|-------------|-------------|
| `<!-- BUILD:SLIDES -->` | Assembled slide fragments. |
| `/* BUILD:OUTLINE_DATA */` | Outline JSON. |
| `/* BUILD:IMAGE_DATA */` | Filename → data URI map, one entry per `IMAGE_MAP` image. |
| `/* BUILD:RECIPE_VANILLA */`, `/* BUILD:RECIPE_PERSONA */` | Rendered recipe HTML. |
| `/* BUILD:PERSONA_SOURCE */` | Raw persona Markdown. |
| `<!-- BUILD:SLIDE_VERSION -->` | `vX.Y.Z &middot; YYYY-MM-DD` from `changelog.md`. |

### Constraints

- A new image must be registered in `IMAGE_MAP` in `tools/build.js`, or its `src` survives into
  `dist/` as a broken relative path. Reusing an already-registered image across slides is free —
  the payload is emitted once regardless of how many slides reference it.
- The bundled Markdown renderer covers headings, bold, italic, inline code, lists, blockquotes,
  tables and rules. Fenced code blocks are **skipped**, not rendered.
- A fragment referenced in `slides.json` but missing on disk fails the build loudly. This is the
  intended behaviour — keep it.
- `dist/ai-insights-slides.html` is self-contained apart from the Reveal.js and Google Fonts CDN
  requests, which still need network access.

---

## 11. Adding a Slide — Checklist

- [ ] Create `slides/{section}/{name}.html` with a single `<section>`, no `<style>` block — use the subfolder matching the slide's `slides.json` section (e.g. `slides/build-system/`).
- [ ] Include `.section-label`, one `h2`, and — unless it is a part divider — `<aside class="notes">`.
- [ ] Reuse an existing component from §6 before writing new CSS. `.card-stack` covers most bodies.
- [ ] Use `.accent*` and `.muted` utilities in preference to hex literals.
- [ ] Tune stack density with the `--stack-*` knobs, not a re-declared inline layout.
- [ ] Register the slide in `slides.json` under the right section, in the right position, as `{section}/{name}`.
- [ ] Register any new image in `IMAGE_MAP`.
- [ ] Rebuild and step through the neighbouring slides in a browser.
- [ ] **Run the overflow audit** — open the deck with `?audit` (or press `Shift+O`) and confirm the
      console reports no overflow. A slide running past the viewport collides with the nav arrows in
      a corner that is easy to miss by eye; this is the deck's most common defect.
- [ ] Verify the slide appears in the outline panel under the expected section.
- [ ] Check any new interactive element with the keyboard alone.
- [ ] Add any new animated element to the `prefers-reduced-motion` selector list.
- [ ] Add a `changelog.md` entry, then rebuild so `--check` passes.
