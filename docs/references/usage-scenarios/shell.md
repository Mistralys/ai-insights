# Usage Scenarios — Shell & Global Chrome

Part of the [AI Insights Ledger GUI usage scenarios](README.md).

---

## [SC76] Toggle dark and light theme

1. The user clicks the theme toggle button in the header.
2. The dashboard switches between dark and light appearance immediately (no page reload) and the choice persists across reloads and future visits.

- [ ] Spec approved
- [ ] Implementation verified

## [SC77] See a stale-instance banner after a version mismatch

**Preconditions:** The running GUI server's component versions differ from what is currently on disk (e.g. after a rebuild while the server was still running).

1. The user has the dashboard open when the periodic version check (every 30 s) detects a mismatch.
2. A banner is inserted at the top of the page, above the header, stating that a version mismatch was detected and listing the changed components, and instructing the user to relaunch the GUI; the banner persists across SPA route changes and further polling stops once shown.

- [ ] Spec approved
- [ ] Implementation verified

## [SC78] Navigate to a page that does not exist

1. The user manually enters or follows a link to an unrecognized hash route.
2. A "Page not found: {path}" error banner is shown in place of any view content.

- [ ] Spec approved
- [ ] Implementation verified
</content>
