/**
 * GUI API Route Handlers — Setup Notices Domain
 *
 * Reports post-clone/post-pull setup gaps the GUI should surface to the user
 * as a dismissible banner, rather than let them show up as confusing downstream
 * errors (empty persona lists, a GUI server that refuses to start, etc.).
 *
 * Routes provided (managed by buildConfigRoutes() in server.ts):
 *   GET /api/setup-notices — list of active setup notices
 *
 * Today there is exactly one possible notice (`personas-not-built`, raised
 * when `personas/name-mapping.json` is absent — see
 * `src/utils/name-mapping.ts` for why that file is a gitignored build
 * artefact). The response is array-shaped so a second notice can be added
 * later with no client-side contract change.
 *
 * STDIO discipline: this file never writes to process.stdout.
 */

import { isNameMappingPresent } from '../src/utils/name-mapping.js';

/**
 * A single setup gap the GUI should surface to the user.
 *
 * `action` is optional: a notice may be purely informational. When present,
 * `action.kind` identifies which client-side remediation to offer (e.g. a
 * "Build personas" button wired to `POST /api/personas/rebuild`).
 */
export interface SetupNotice {
  /** Stable machine-readable identifier (e.g. "personas-not-built"). */
  id: string;
  /** Short human-readable summary shown in the banner. */
  title: string;
  /** Longer explanation of why the notice is showing and what it means. */
  message: string;
  /** Optional client-side remediation this notice offers. */
  action?: {
    /** Identifies which remediation the client should offer. */
    kind: string;
  };
}

/**
 * Detects every currently-active setup notice.
 *
 * Returns an empty array when nothing is amiss. Each check here is a cheap
 * existence check only — this is not the place for parsing or validating
 * file contents.
 */
export function detectSetupNotices(): SetupNotice[] {
  const notices: SetupNotice[] = [];

  if (!isNameMappingPresent()) {
    notices.push({
      id: 'personas-not-built',
      title: 'Personas have not been built yet',
      message:
        'personas/name-mapping.json is missing. It is a generated build artefact ' +
        '— run a persona build to create it before model assignments and persona ' +
        'listings become available.',
      action: { kind: 'rebuild-personas' },
    });
  }

  return notices;
}

/**
 * Handles `GET /api/setup-notices`.
 */
export async function handleGetSetupNotices(): Promise<{ notices: SetupNotice[] }> {
  return { notices: detectSetupNotices() };
}
