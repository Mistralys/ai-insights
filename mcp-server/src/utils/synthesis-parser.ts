/**
 * Extracts the outcome summary from a synthesis Markdown string.
 *
 * First tries to find a `### Outcome Summary` section. If absent or empty,
 * falls back to the first bullet item in `### Implementation Summary`.
 * Returns `null` when neither section is present or yields usable content.
 *
 * This is the fallback path: `ledger_import_standalone` and
 * `ledger_update_synthesis` only call it when the caller supplied no
 * `outcome_summary` argument. A supplied argument is stored verbatim and this
 * function never runs for that call, so the value returned here is not
 * necessarily what ends up in the ledger.
 */
export function parseOutcomeSummary(synthesisContent: string): string | null {
  const outcomeContent = extractSection(synthesisContent, 'Outcome Summary');
  if (outcomeContent !== null && outcomeContent.trim().length > 0) {
    return outcomeContent.trim();
  }

  const implContent = extractSection(synthesisContent, 'Implementation Summary');
  if (implContent !== null) {
    const bullet = extractFirstBullet(implContent);
    if (bullet !== null) {
      return bullet;
    }
  }

  return null;
}

/**
 * Returns the body text of a `##` or `###` `<heading>` section (the content
 * between the heading line and the next `##`/`###` heading anywhere in the
 * document, or EOF). Returns `null` if the section heading is not found.
 *
 * Matching both heading levels on the way in (the heading itself may be
 * written as `##` or `###`) and on the way out (the next section boundary is
 * the next `##` or `###` heading, regardless of which level opened the
 * section) keeps the extraction correct for documents that mix heading
 * levels — e.g. a `### Outcome Summary` section followed later by an
 * unrelated `## Metrics` or `## Rework Log` heading. A deeper `####`
 * sub-heading is intentionally not treated as a boundary, since it is a
 * subsection of the content being extracted, not a sibling section.
 */
function extractSection(content: string, heading: string): string | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^#{2,3}\\s+${escapedHeading}\\s*$`, 'im');
  const match = headingRe.exec(content);
  if (!match) {
    return null;
  }
  const afterHeading = content.slice(match.index + match[0].length);
  const nextHeadingMatch = /^#{2,3}\s/m.exec(afterHeading);
  return nextHeadingMatch
    ? afterHeading.slice(0, nextHeadingMatch.index)
    : afterHeading;
}

/**
 * Returns the text of the first `- …` or `* …` bullet found in a section
 * body. Returns `null` if no bullet is found.
 */
function extractFirstBullet(sectionContent: string): string | null {
  const match = /^[-*]\s+(.+)$/m.exec(sectionContent);
  if (!match) {
    return null;
  }
  // match[1] is always defined — the regex requires at least one character (.+)
  return match[1]!.trim();
}
