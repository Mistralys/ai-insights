/**
 * Extracts the outcome summary from a synthesis Markdown string.
 *
 * First tries to find a `### Outcome Summary` section. If absent or empty,
 * falls back to the first bullet item in `### Implementation Summary`.
 * Returns `null` when neither section is present or yields usable content.
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
 * Returns the body text of a `### <heading>` section (the content between the
 * heading line and the next `###` heading or EOF). Returns `null` if the
 * section heading is not found.
 */
function extractSection(content: string, heading: string): string | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^###\\s+${escapedHeading}\\s*$`, 'im');
  const match = headingRe.exec(content);
  if (!match) {
    return null;
  }
  const afterHeading = content.slice(match.index + match[0].length);
  const nextHeadingMatch = /^###\s/m.exec(afterHeading);
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
