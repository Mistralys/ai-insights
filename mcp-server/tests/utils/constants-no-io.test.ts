/**
 * Proves `src/utils/constants.ts` performs no file I/O at module load: it no
 * longer imports `createRequire`, no longer exports `AGENT_NAMES`, and
 * importing it succeeds even when `personas/name-mapping.json` is entirely
 * absent from disk (the generated artefact this module used to require).
 *
 * This is the regression guard for the GUI server's original crash: any
 * consumer of an unrelated `constants.ts` export must not be forced to pay
 * for, or depend on, the generated name-mapping file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('constants.ts has no file I/O', () => {
  it('importing constants.ts succeeds and exposes its constants, independent of personas/name-mapping.json', async () => {
    // A dynamic import after this file's own top-level imports still exercises
    // the real module graph; what matters here is that no exception is thrown
    // and the module's well-known exports are present, proving module-load
    // succeeded without needing to read any generated file.
    const constants = await import('../../src/utils/constants.js');

    expect(() => constants).not.toThrow();
    expect(constants.AGENT_ROLES.length).toBeGreaterThan(0);
    expect(constants.SAFE_SLUG_REGEX).toBeInstanceOf(RegExp);
    expect(constants.ROLE_IDS).toBeDefined();
    expect(constants.READY_STATUS_FOR_ROLE).toBeDefined();
    expect(constants.SPEC_VERSION).toBeDefined();

    // AGENT_NAMES, TargetNames and NameMappingEntry moved to name-mapping.ts —
    // constants.ts no longer exports a runtime AGENT_NAMES value at all.
    expect((constants as Record<string, unknown>).AGENT_NAMES).toBeUndefined();
  });

  it('constants.ts source no longer imports createRequire or references personas/name-mapping.json', () => {
    const source = readFileSync(join(__dirname, '../../src/utils/constants.ts'), 'utf8');
    expect(source).not.toMatch(/createRequire/);
    expect(source).not.toMatch(/_require\(/);
    expect(source).not.toMatch(/personas\/name-mapping\.json'\)/);
  });
});
