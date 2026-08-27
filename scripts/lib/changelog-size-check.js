/**
 * scripts/lib/changelog-size-check.js
 *
 * Heuristic detector for an oversized `personas/changelog.md` entry. AGENTS.md's
 * Changelog Convention (rule 8) requires personas/changelog.md to stay
 * summary-only — one outcome-oriented bullet per affected persona/theme, with
 * rationale and mechanism detail deferred to each persona's own integrated
 * changelog. Nothing previously enforced that mechanically, which let one
 * entry grow to 323 lines / ~60 bullets before a manual condense pass.
 *
 * This is a lint, not a proof: it flags the newest entry for human review
 * against three mechanical thresholds (line count, bullet count, sentences
 * per bullet). Historical entries are immutable and several already exceed
 * an ideal size for their moment in time, so only the first `## v` heading
 * in the file — the entry about to land — is ever inspected.
 */

/** Above this many lines, the newest entry is flagged for condensing. */
export const MAX_ENTRY_LINES = 60;

/** Above this many top-level bullets, the newest entry is flagged. */
export const MAX_BULLETS = 25;

/** Above this many sentences in one bullet, that bullet is flagged. */
export const MAX_SENTENCES_PER_BULLET = 2;

const HEADING_RE = /^##\s+v(\d+\.\d+\.\d+)/;

/**
 * Split a bullet's folded text into sentences, dropping quoted spans and
 * inline code first. Self-contained copy of the approach in
 * philosophy-tone.js's `sentences()` helper — not imported, so the two lint
 * modules stay independent (Pattern Alignment). Inherits the same known
 * heuristic limitation: abbreviations, decimals, and version numbers (e.g.
 * "v3.2") can be miscounted as sentence boundaries.
 * @param {string} text
 * @returns {string[]}
 */
function sentences(text) {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/["“][^"”]*["”]/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Locate the newest (first `## vX.Y.Z`) changelog entry in a markdown
 * document. Returns its version, 1-based start/end line numbers, and the
 * full entry text as lines (heading through last non-blank content line,
 * trailing blank lines trimmed, stopping before the next version heading
 * or at EOF).
 * @param {string} markdown - full changelog.md text
 * @returns {{ version: string, startLine: number, endLine: number, lines: string[] } | null}
 */
export function extractLatestChangelogEntry(markdown) {
  const allLines = markdown.split(/\r?\n/);

  let startIdx = -1;
  let version = null;
  for (let i = 0; i < allLines.length; i++) {
    const heading = allLines[i].match(HEADING_RE);
    if (heading) {
      startIdx = i;
      version = heading[1];
      break;
    }
  }

  if (startIdx === -1) return null;

  let endIdx = allLines.length - 1;
  for (let i = startIdx + 1; i < allLines.length; i++) {
    if (HEADING_RE.test(allLines[i])) {
      endIdx = i - 1;
      break;
    }
  }

  while (endIdx > startIdx && allLines[endIdx].trim() === '') {
    endIdx--;
  }

  return {
    version,
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    lines: allLines.slice(startIdx, endIdx + 1),
  };
}

/**
 * Walk an entry's body lines (skipping the heading itself) and collect its
 * top-level bullets, folding wrapped continuation lines — non-bullet,
 * non-blank lines that follow a bullet before the next bullet or a blank
 * line — into the parent bullet's text instead of counting them separately.
 * @param {string[]} lines - entry lines, lines[0] is the heading
 * @param {number} startLine - 1-based line number of lines[0]
 * @returns {Array<{ text: string, line: number }>}
 */
function collectBullets(lines, startLine) {
  const bullets = [];
  let current = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^-\s+(.*)$/);

    if (bulletMatch) {
      current = { text: bulletMatch[1], line: startLine + i };
      bullets.push(current);
      continue;
    }

    if (line.trim() === '') {
      current = null; // blank line ends the current bullet's continuation
      continue;
    }

    if (current) {
      current.text += ' ' + line.trim();
    }
    // else: non-bullet, non-blank line outside any bullet (e.g. the summary
    // paragraph above the bullet list) — not part of the bullet count.
  }

  return bullets;
}

/**
 * Check the newest changelog entry against the size/verbosity thresholds.
 * @param {string} markdown - full changelog.md text
 * @param {string} filename - filename for message context
 * @param {{ maxLines?: number, maxBullets?: number, maxSentencesPerBullet?: number }} [options]
 * @returns {string[]} warning strings (empty = no violation detected)
 */
export function checkChangelogEntrySize(markdown, filename, options = {}) {
  const maxLines = options.maxLines ?? MAX_ENTRY_LINES;
  const maxBullets = options.maxBullets ?? MAX_BULLETS;
  const maxSentencesPerBullet = options.maxSentencesPerBullet ?? MAX_SENTENCES_PER_BULLET;

  const entry = extractLatestChangelogEntry(markdown);
  if (!entry) return [];

  const { startLine, lines } = entry;
  const warnings = [];

  if (lines.length > maxLines) {
    warnings.push(
      `${filename}:${startLine}: latest changelog entry is ${lines.length} lines, ` +
      `exceeding the ${maxLines}-line guideline. Condense to an outcome-oriented summary.`,
    );
  }

  const bullets = collectBullets(lines, startLine);

  if (bullets.length > maxBullets) {
    warnings.push(
      `${filename}:${startLine}: latest changelog entry has ${bullets.length} bullets, ` +
      `exceeding the ${maxBullets}-bullet guideline. Group related changes into fewer, ` +
      `broader bullets.`,
    );
  }

  for (const bullet of bullets) {
    const bulletSentences = sentences(bullet.text);
    if (bulletSentences.length > maxSentencesPerBullet) {
      warnings.push(
        `${filename}:${bullet.line}: changelog bullet has ${bulletSentences.length} sentences, ` +
        `exceeding the ${maxSentencesPerBullet}-sentence guideline. Trim rationale/mechanism ` +
        `detail — it belongs in the persona's own integrated changelog.`,
      );
    }
  }

  return warnings;
}
