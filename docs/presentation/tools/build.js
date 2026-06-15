#!/usr/bin/env node

/**
 * Presentation build script.
 *
 * Reads template.html (the lean dev source) and produces dist/ai-insights-slides.html
 * with all heavy resources inlined:
 *
 *   - PNG images  → base64 data URIs
 *   - Recipe Markdown files → HTML (rendered via a lightweight Markdown-to-HTML
 *     converter) injected into JS template literals
 *   - Persona source Markdown → JS template literal for the persona modal
 *
 * Usage (run from the presentation root):
 *   node tools/build.js          → writes dist/ai-insights-slides.html
 *   node tools/build.js --watch  → rebuilds on any source file change
 *
 * No dependencies — uses only Node.js built-ins.
 */

import { readFileSync, writeFileSync, watch as fsWatch, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../template.html');
const DIST = resolve(__dirname, '../dist/ai-insights-slides.html');
const SLIDES_JSON = resolve(__dirname, '../slides.json');
const SLIDES_DIR = resolve(__dirname, '../slides');

// ── Resource manifest ────────────────────────────────────────────────────────
// Each entry maps a src="<filename>" in the HTML to a local PNG file.
const IMAGE_MAP = {
  'img/work-package-stages.png': resolve(__dirname, '../img/work-package-stages.png'),
  'img/ledger-gui.png': resolve(__dirname, '../img/ledger-gui.png'),
};

// Markdown files rendered to HTML and injected as JS string literals.
const RECIPE_FILES = {
  '/* BUILD:RECIPE_VANILLA */': resolve(__dirname, '../partials/recipe-results-vanilla.md'),
  '/* BUILD:RECIPE_PERSONA */': resolve(__dirname, '../partials/recipe-results-persona.md'),
};

// Plain-text persona source injected as a JS template literal.
const PERSONA_SOURCE = resolve(
  __dirname,
  '../../../personas/standalone/src/content/recipe-curator.md'
);

// ── Lightweight Markdown → HTML ──────────────────────────────────────────────
// Covers the subset used in the recipe files: headings, bold, italic, lists,
// blockquotes, tables, horizontal rules, paragraphs. No external deps.

function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;
  let inTable = false;
  let tableHeaderDone = false;

  function closeLists() {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  }
  function closeBlockquote() {
    if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
  }
  function closeTable() {
    if (inTable) { out.push('</tbody></table>'); inTable = false; tableHeaderDone = false; }
  }

  function inline(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/---/g, '&mdash;')
      .replace(/--/g, '&ndash;')
      .replace(/\u2014/g, '&mdash;')
      .replace(/\u2013/g, '&ndash;');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (close open blocks)
    if (trimmed === '') {
      closeLists();
      closeBlockquote();
      closeTable();
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      closeLists(); closeBlockquote(); closeTable();
      out.push('<hr>');
      continue;
    }

    // Table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      closeLists(); closeBlockquote();
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
      // Separator row (| --- | --- |)
      if (cells.every(c => /^-+$/.test(c))) {
        tableHeaderDone = true;
        continue;
      }
      if (!inTable) {
        out.push('<table><thead>');
        const headerCells = cells.map(c => `<th>${inline(c)}</th>`).join('');
        out.push(`<tr>${headerCells}</tr></thead><tbody>`);
        inTable = true;
        continue;
      }
      const tag = tableHeaderDone ? 'td' : 'th';
      const rowCells = cells.map(c => `<${tag}>${inline(c)}</${tag}>`).join('');
      out.push(`<tr>${rowCells}</tr>`);
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeLists(); closeBlockquote(); closeTable();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      closeLists(); closeTable();
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true; }
      out.push(inline(trimmed.replace(/^>\s*/, '')));
      continue;
    }

    // Unordered list
    if (/^\*\s+/.test(trimmed) || /^-\s+/.test(trimmed)) {
      closeBlockquote(); closeTable();
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(trimmed.replace(/^[\*\-]\s+/, ''))}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      closeBlockquote(); closeTable();
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(olMatch[2])}</li>`);
      continue;
    }

    // Code fence (skip — not used in recipe output)
    if (trimmed.startsWith('```')) {
      // Fast-forward past the code block
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) i++;
      continue;
    }

    // Paragraph
    closeLists(); closeBlockquote(); closeTable();
    out.push(`<p>${inline(trimmed)}</p>`);
  }

  closeLists();
  closeBlockquote();
  closeTable();

  return out.join('\n');
}

// ── JS string escaping ──────────────────────────────────────────────────────

function escapeForJsTemplateLiteral(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

function escapeForJsSingleQuote(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

// ── Slide assembly ──────────────────────────────────────────────────────────

/**
 * Reads slides.json and concatenates all slide fragment files into one HTML string.
 * Each entry in slides.json resolves to slides/{name}.html.
 * Throws if a referenced file does not exist.
 */
function assembleSlides() {
  const registry = JSON.parse(readFileSync(SLIDES_JSON, 'utf8'));
  const fragments = [];
  for (const section of registry.sections) {
    for (const name of section.slides) {
      const fragmentPath = resolve(SLIDES_DIR, `${name}.html`);
      let content;
      try {
        content = readFileSync(fragmentPath, 'utf8').trimEnd();
      } catch (err) {
        throw new Error(`Slide fragment not found: slides/${name}.html (referenced in slides.json section "${section.label}")`);
      }
      fragments.push(content);
    }
  }
  return fragments.join('\n\n');
}

/**
 * Computes outline data from slides.json: an array of { label, startIndex, count }
 * where startIndex is the 0-based slide index and count is the number of slides
 * in the section. Injected into the template as JSON for the runtime outline panel.
 */
function buildOutlineData() {
  const registry = JSON.parse(readFileSync(SLIDES_JSON, 'utf8'));
  const result = [];
  let index = 0;
  for (const section of registry.sections) {
    const count = section.slides.length;
    result.push({ label: section.label, startIndex: index, count });
    index += count;
  }
  return result;
}

// ── Build ────────────────────────────────────────────────────────────────────

function build() {
  const start = performance.now();
  let html = readFileSync(SRC, 'utf8');

  // 0. Assemble slide fragments and inject outline data
  //    Must run before all other steps so BUILD:* placeholders inside
  //    slide fragments are processed by the subsequent injection steps.
  const slidesHtml = assembleSlides();
  html = html.replace('<!-- BUILD:SLIDES -->', slidesHtml);

  const outlineData = buildOutlineData();
  html = html.replace('/* BUILD:OUTLINE_DATA */', JSON.stringify(outlineData));

  // 1. Inline PNG images as base64 data URIs
  for (const [filename, filepath] of Object.entries(IMAGE_MAP)) {
    const b64 = readFileSync(filepath).toString('base64');
    const dataUri = `data:image/png;base64,${b64}`;
    // Replace src="filename" with src="data:..."
    html = html.replace(
      new RegExp(`src="${filename.replace('.', '\\.')}"`, 'g'),
      `src="${dataUri}"`
    );
  }

  // 2. Render recipe Markdown files to HTML and inject as JS strings
  for (const [placeholder, filepath] of Object.entries(RECIPE_FILES)) {
    const md = readFileSync(filepath, 'utf8');
    const rendered = mdToHtml(md);
    const escaped = escapeForJsSingleQuote(rendered);
    html = html.replace(placeholder, escaped);
  }

  // 3. Read persona source and inject as JS template literal
  const personaMd = readFileSync(PERSONA_SOURCE, 'utf8');
  const personaEscaped = escapeForJsTemplateLiteral(personaMd);
  html = html.replace(
    "const personaMarkdown = '/* BUILD:PERSONA_SOURCE */';",
    `const personaMarkdown = \`${personaEscaped}\`;`
  );

  // 4. Inject version + date from changelog
  const CHANGELOG = resolve(__dirname, '../changelog.md');
  const changelogText = readFileSync(CHANGELOG, 'utf8');
  const versionMatch = changelogText.match(/^## (v[\d.]+) \(([^)]+)\)/m);
  const slideVersion = versionMatch ? `${versionMatch[1]} &middot; ${versionMatch[2]}` : '';
  html = html.replace('<!-- BUILD:SLIDE_VERSION -->', slideVersion);

  mkdirSync(dirname(DIST), { recursive: true });
  writeFileSync(DIST, html, 'utf8');

  const elapsed = (performance.now() - start).toFixed(0);
  const srcSize = (statSync(SRC).size / 1024).toFixed(1);
  const distSize = (statSync(DIST).size / 1024).toFixed(1);
  console.log(`✓ Built dist/ai-insights-slides.html (${srcSize} KB → ${distSize} KB) in ${elapsed} ms`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--watch') || args.includes('-w')) {
  // Watch mode: rebuild on any source file change
  const watchFiles = [
    SRC,
    SLIDES_JSON,
    PERSONA_SOURCE,
    resolve(__dirname, '../changelog.md'),
    ...Object.values(IMAGE_MAP),
    ...Object.values(RECIPE_FILES),
  ];

  // Watch the slides/ directory so new or renamed fragment files trigger a rebuild
  fsWatch(SLIDES_DIR, { persistent: true }, () => {
    console.log(`\n  Changed: slides/`);
    try { build(); } catch (e) { console.error('  Build error:', e.message); }
  });

  build();
  console.log('Watching for changes…');

  for (const file of watchFiles) {
    fsWatch(file, { persistent: true }, () => {
      console.log(`\n  Changed: ${file}`);
      try { build(); } catch (e) { console.error('  Build error:', e.message); }
    });
  }
} else {
  build();
}
