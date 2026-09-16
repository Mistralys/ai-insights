import fs from 'fs';
import path from 'path';

function readExcludeEntries(configText) {
  const lines = configText.split(/\r?\n/);
  const excludeIndex = lines.findIndex(line => line.trim() === 'exclude:');
  if (excludeIndex === -1) return [];

  const entries = [];
  for (let i = excludeIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('  - ')) break;
    entries.push(line.slice(4).trim());
  }
  return entries;
}

describe('docs Pages config', () => {
  it('excludes internal plan and implementation-history docs from Jekyll processing', () => {
    const configPath = path.join(process.cwd(), 'docs', '_config.yml');
    const configText = fs.readFileSync(configPath, 'utf8');
    const excludes = readExcludeEntries(configText);

    expect(excludes).toContain('agents/plans/');
    expect(excludes).toContain('agents/implementation-history/');
  });
});
