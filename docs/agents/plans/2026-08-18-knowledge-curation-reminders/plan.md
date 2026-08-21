# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context

The repository strategy emphasizes low-friction daily use, multi-store correctness, and personas as the primary user-facing contract. Existing repository insights also favor plain-function modules for stateless storage helpers and stable UUID-based identifiers for persistent records. These principles inform the explicit store targeting, per-store lock boundary, and curator-persona integration below.

## Summary

Add a generic, per-store notification system to the GUI, beginning with knowledge curation reminders. Store user-editable cadence settings in `stores.json`, store mutable reminder state with notification records under each store's `.notifications/` directory, reuse the existing GUI periodic timer, and expose an explicit MCP completion tool to the Ledger Knowledge Curator. The plan preserves current timer and route APIs where practical while removing ambiguity around deferral, multi-store targeting, and persona ownership.

## Usage Scenarios

The GUI implementation should use [usage-scenarios.md](usage-scenarios.md) as the user-flow reference. In particular:

- **Scenario 1** covers editing one store's knowledge-curation cadence through the Stores tab without affecting another store.
- **Scenario 2** covers recovering an unwanted deferral through the Stores tab's store/type-keyed reset action while preserving periodicity and other reminder state.

## Architectural Context

The MCP server is multi-store aware. `stores.json` contains compact store configuration entries, while each store path owns its `.knowledge/` data and repository registry. The GUI server is a long-lived Node.js process and currently starts `startAutoArchiveTimer()` from `mcp-server/gui/server.ts`; the timer reads configuration on each tick and runs at a default ten-minute interval.

The GUI does not use Express route registration. `mcp-server/gui/server.ts` defines a declarative `Route` type, domain-specific `build*Routes()` functions, centralized body parsing/error handling, and a load-bearing route ordering rule. New notification handlers must return serializable values to that dispatcher.

The dedicated knowledge-maintenance persona is `personas/ledger-support/src/meta/ledger-knowledge-curator.yaml` with content in `personas/ledger-support/src/content/ledger-knowledge-curator.md`. Ledger Synthesis delegates knowledge maintenance and is not the owner of this completion signal.

## Approach / Architecture

### Static Store Settings

Extend `StoreEntrySchema` with only user-editable knowledge curation settings:

- `notification_settings.knowledge_curation.enabled`, default `true`
- `notification_settings.knowledge_curation.periodicity_days`, integer from 1 through 365, default `30`

Do not place `last_check` or `deferred_until` in `stores.json`. Existing store entries are normalized with defaults during GUI startup, and both GUI store-creation paths initialize the same defaults before calling `saveStoresConfig()`.

These settings must be directly editable from the GUI, per store. The Stores tab edit modal (`mcp-server/gui/public/views/config-stores.js`) gains a knowledge-curation reminders field group — an enabled toggle and a periodicity number input (1 through 365 days) — saved through the existing `API.updateStore()` call alongside the current label field. Reminder cadence is store configuration, not notification state, so it belongs beside the store's other editable metadata rather than in the new notification bell/modal.

### Generic Notification Storage

Add `mcp-server/src/schema/notification.ts` and a new plain-function module at `mcp-server/src/storage/notifications.ts`. The module manages `{storePath}/.notifications/notifications.json` and `{storePath}/.notifications/reminder-state.json` under one `.notifications/` lock domain, using `atomicWriteJson()` for each file write. The lock serializes related read-modify-write transitions, while startup and periodic checks reconcile the two files after any crash between their independent atomic replacements.

The notification record is generic and includes a UUID, `type`, `store_id`, `created_at`, `origin`, `message`, and nullable `dismissed_at`. Reminder state is keyed by reminder type and includes `last_completed_at`, `last_notified_at`, `active_notification_id`, and `remind_at`. For the initial `knowledge_curation` type:

- `last_completed_at: null` means the reminder is due unless an active notification already exists.
- `last_notified_at` prevents a dismissed reminder from being recreated on every timer tick; after dismissal, the next periodic reminder is eligible only after the configured cadence.
- `active_notification_id` prevents duplicate records for the same reminder type and store.
- `remind_at` is the canonical deferral timestamp. It is not copied into `stores.json` or the notification record.
- Dismissal marks the record dismissed and clears the active reminder reference.
- Deferral updates only `remind_at`; the active notification remains the one record shown again when the deferral expires.
- Completion sets `last_completed_at` and `last_notified_at` to the current timestamp, clears `remind_at`, and resolves the active notification.

The storage module should expose generic record operations plus reminder-specific state transitions, keeping all related read-modify-write work inside one lock scope. Reconciliation must clear stale `active_notification_id` values when the referenced record is missing or dismissed, and must not recreate a duplicate while a valid active record exists. It should not introduce a stateful class for stateless filesystem helpers.

### Periodic Checks

Refactor `mcp-server/src/gui/auto-archive.ts` into a unified periodic-check owner. Preserve `startAutoArchiveTimer()` and `stopAutoArchiveTimer()` as compatibility wrappers or aliases, and add the new descriptive `startPeriodicChecksTimer()`/`stopPeriodicChecksTimer()` names if the implementation benefits from them.

Each tick must run auto-archive and knowledge-reminder checks independently. An `auto_archive_days` value of `0` disables only archiving; it must not suppress reminder checks. Each operation has its own error boundary so one failed store or subsystem does not prevent the other from running. The reminder check reads the current stores configuration, initializes missing static defaults, evaluates each store's keyed reminder state, creates at most one active notification per reminder type, and persists state before returning.

### Completion Tool and Target Semantics

Add `ledger_record_knowledge_curation` as a module-level MCP tool registration in `mcp-server/src/tools/knowledge-curation.ts`, following the `register(server)` composition pattern used by `mcp-server/src/tools/knowledge.ts` and `mcp-server/src/index.ts`.

The input accepts:

- `store_id?: string` — the explicit store target
- `repository_name?: string` — convenience resolution for project maintenance
- `notes?: string` — optional acknowledgement text, returned in the result but never attached to an arbitrary first project

Resolution rules are strict: in multi-store mode, global curation requires `store_id`; a repository name may resolve exactly one owning store; supplying both values requires them to resolve to the same store; omitted targeting never means all stores. In legacy single-store mode, omitted `store_id` resolves to the default ledger root. The result includes the targeted store id and reset timestamp. A repository lookup failure returns the established `StoreNotRegisteredError` shape.

### GUI API and Frontend

Add `mcp-server/gui/api-notifications.ts` with pure resource handlers and add `buildNotificationRoutes()` to `mcp-server/gui/server.ts`. Register the builder in `buildRoutes()` in the existing domain order. Routes include:

- `GET /api/notifications` — return `{ notifications, unread_count }` for visible notifications across stores, tagged with store id and label; exclude dismissed records and records whose `remind_at` is in the future, sort newest-first by `created_at` with UUID as the tie-breaker, and define `unread_count` as the count of returned records
- `POST /api/notifications/:id/dismiss` — resolve one notification by UUID and explicit `store_id` in the request body
- `POST /api/notifications/:id/defer` — accept `{ store_id, delay_days }`, where `delay_days` is an integer in the fixed set 1, 7, or 30; the handler updates the canonical reminder state
- `POST /api/notifications/dismiss-all` — resolve notifications across all configured stores
- `POST /api/notifications/reminders/:store_id/:type/reset-defer` — clear `remind_at` on the store's keyed reminder state for the given reminder type, leaving `last_completed_at`, `last_notified_at`, and `active_notification_id` untouched; a no-op when no active reminder exists for that store/type

Place literal routes before parameterized routes where they can overlap; the `reminders/:store_id/:type/reset-defer` path's literal `reminders` segment must be registered ahead of the `:id` catch-alls under `/api/notifications/`. Handlers receive `(body, groups, query)` through the route dispatcher and do not own `req` or `res`. A notification action must reject a missing or mismatched `store_id`; if the same UUID is found in more than one store, the action must fail as ambiguous rather than choosing a store implicitly.

A deferred reminder's notification record is filtered out of `GET /api/notifications` (its `remind_at` is in the future), so the client never has its UUID to call `dismiss`/`defer` again. The reset-defer route is therefore keyed by `store_id`/`type` instead of notification UUID, and clearing `remind_at` is sufficient to make the same active notification reappear in the next list call — no new record is created and periodicity is not touched.

Add the persistent frontend component at `mcp-server/gui/public/views/notifications.js`, use the existing `mcp-server/gui/public/index.html` navigation bar for the notification control before the theme toggle, and add styles to `mcp-server/gui/public/styles.css`. This is intentionally an app-level component rather than a routed view: it exposes one `Notifications` namespace with idempotent `init()`, `refresh()`, `open()`, `close()`, and test-only `dispose()` methods. Load it after all of its dependencies and before `app.js`, then call `Notifications.init()` from the bootstrap sequence.

The notification control owns a separate interval and must not call `Router._setPolling()`, because the router has one shared page-polling slot and registering the notification poll would stop project or orchestrator polling. Its interval is established once, survives route changes, and is cleared only by `dispose()`; navigation closes the modal and removes transient modal listeners without stopping the app-level unread-count poll. Persistent listeners must retain their function references and be removed before re-registration.

Use `openModal()`, `wireModalEvents()`, and `closeModal()` for the modal lifecycle. The control must have an accessible label, `aria-expanded`, and `aria-controls`; the unread count must be exposed to assistive technology without noisy repeated announcements. The modal must use `role="dialog"`, `aria-modal="true"`, a labelled title, initial focus, focus trapping, Escape/backdrop close, focus restoration, and visible keyboard focus states. Escape all dynamic text and attribute values through `escapeHtml()` before HTML rendering.

Knowledge-curation cadence editing is a store-configuration concern, not a notification concern: extend the existing store edit modal in `mcp-server/gui/public/views/config-stores.js` (writing through the existing `PUT /api/stores/:id` handler in `mcp-server/gui/api-stores.ts`) to expose the `enabled` toggle and `periodicity_days` input next to the existing label field, instead of adding settings controls to the transient notification modal.

Because a deferred reminder is invisible in the notification UI until it comes due, the Stores tab is also the recovery surface for an unwanted deferral. The store list/detail handlers in `mcp-server/gui/api-stores.ts` read the store's `.notifications/reminder-state.json` (read-only, no lock) and merge a `reminder_state.knowledge_curation: { remind_at, active }` field into the response alongside `notification_settings`. When `remind_at` is set and in the future, the edit modal shows the snooze date next to the periodicity input with a **Reset to default schedule** button that calls the new `reset-defer` route; a successful call clears the displayed snooze state without changing the periodicity value.

## Rationale

1. Per-store notification files match the established `.knowledge/` layout and keep store moves, exports, and deletion boundaries explicit.
2. Separating static settings from runtime state prevents timer ticks and deferrals from rewriting the shared store registry and eliminates duplicated scheduling fields.
3. A canonical reminder state machine prevents an old periodic timestamp from bypassing a future user deferral and prevents notification storms after repeated timer ticks.
4. The existing GUI timer is the correct lifecycle owner because it already runs persistently, but independent task error handling and the archive-disabled behavior must be corrected during the refactor.
5. Explicit `store_id` semantics avoid silently resetting the wrong store or all stores when a repository is absent or registered in multiple stores.
6. The declarative route table is the server's established API architecture and centralizes parsing, errors, CORS, status codes, and ordering checks.
7. The Ledger Knowledge Curator owns the curation workflow, so its metadata and source content should expose the reset tool; Synthesis should remain unchanged.
8. The notification control is persistent shell UI rather than a hash-routed page, so its lifecycle is owned by `app.js` and route changes close only transient modal state.
9. Notification item actions always carry `store_id`; UUID uniqueness is not treated as a deterministic cross-store targeting guarantee.
10. Reminder cadence is store configuration, not notification state, so it belongs in the Stores tab's existing edit modal and `updateStore()` flow rather than in the transient notification UI.
11. A deferred reminder is filtered out of the visible notification list by design, so recovering from an unwanted deferral needs a store/type-keyed route and a Stores tab affordance rather than a notification-UUID-keyed action the client cannot obtain.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Notification storage | Per-store `.notifications/` files | Global notification file; records in `stores.json` | Per-store storage fits the existing hidden-directory pattern and avoids turning compact configuration into a history database. |
| Runtime state location | Keyed reminder state under `.notifications/` | Runtime timestamps in `stores.json`; deferral duplicated on records and config | The chosen shape separates user settings from mutable state and gives deferral one owner under one lock domain. |
| Storage abstraction | Plain-function module with generic record/state operations | Stateful `NotificationManager` class; ad hoc writes in handlers | The module has no lifecycle or cache state, so plain functions follow the repository's established stateless-storage guidance while retaining a clear domain boundary. |
| Timer lifecycle | Unified periodic-check timer with compatibility wrappers | Separate reminder timer; event-only completion signal | One lifecycle owner avoids duplicate intervals and still recovers reminders after restarts or missed agent calls. |
| Completion target | Explicit `store_id`, with repository-name convenience resolution | Optional repository name with omitted reset; reset every store | Explicit targeting is unambiguous in multi-store mode and supports global maintenance without inventing implicit all-store behavior. |
| GUI API integration | `buildNotificationRoutes()` and return-value handlers | Express-shaped `app.get()`/`app.post()` handlers; folding into general `api.ts` | Domain route builders match the existing dispatcher and keep notification ownership separate. |
| Persona integration | Ledger Knowledge Curator metadata/content | Ledger Synthesis metadata; GUI-only reset | The curator is the agent that actually audits knowledge, so the contract lives beside its workflow. |
| Cadence editing surface | Stores tab edit modal (`config-stores.js`) via existing `updateStore()` | New dedicated notification-settings panel; direct `stores.json` editing only | Reusing the existing store edit modal keeps cadence configuration next to other store metadata and avoids a redundant settings surface. |
| Recovering from an unwanted deferral | Store/type-keyed `reset-defer` route surfaced as a snooze-status control in the Stores tab edit modal | Dedicated "Manage reminders" view listing all reminders regardless of visibility; require the user to wait out the deferral | The Stores tab already reads and writes this store's reminder settings, so showing snooze status and a reset control there avoids a new page while still requiring an explicit `store_id`/`type` target rather than a notification UUID the client cannot obtain. |

## Pattern Alignment

- Zod-first schemas follow `mcp-server/src/schema/store-config.ts` and `mcp-server/src/schema/knowledge.ts`.
- Per-store atomic writes and lock scopes follow `mcp-server/src/storage/knowledge-store.ts` and `mcp-server/src/storage/store-registry.ts`.
- Stateless storage helpers deliberately follow the plain-function pattern documented for `mcp-server/src/storage/repository-registry.ts`; no unnecessary lifecycle class is introduced.
- Timer ownership follows `mcp-server/src/gui/auto-archive.ts`, with the compatibility wrapper preserving existing callers.
- MCP registration follows module-level `register(server)` functions in `mcp-server/src/tools/knowledge.ts` and `mcp-server/src/index.ts`.
- GUI routing follows `buildKnowledgeRoutes()` and `buildRoutes()` in `mcp-server/gui/server.ts`; the plan deliberately departs from the old research brief's Express-shaped handler description.
- Frontend view rendering follows the existing ES5/IIFE and HTML-string conventions, but the persistent notification shell component is an explicit exception to the routed `views/{noun}.js` pattern.
- Page polling follows `mcp-server/gui/public/router.js`; notification polling uses an independent app-level interval so the router's single polling slot remains available to the active view. Notification fields and dynamic attributes must use the existing escaping utility before rendering.
- Modal lifecycle follows `mcp-server/gui/public/modal.js`, including focus trapping and focus restoration.
- New notification colors use CSS custom-property tokens with light and dark theme values; layout must reflow with the existing mobile header rules.

## Detailed Steps

1. **Define static settings and defaults.** Add `NotificationSettingsSchema` and the nested knowledge curation settings to `mcp-server/src/schema/store-config.ts`. Update `mcp-server/gui/api-stores.ts` so both new-store paths apply defaults, and add an idempotent startup normalization path for existing entries missing the settings block. Keep this write under `saveStoresConfig()`'s existing lock/atomic-write behavior. Extend the `PUT /api/stores/:id` handler and its Zod validation to accept partial `notification_settings.knowledge_curation` updates so the Stores tab can persist cadence changes through the existing store-update write path.
2. **Define notification and reminder schemas.** Create `mcp-server/src/schema/notification.ts` with validated UUID/timestamp fields, a generic notification type, the notification collection schema, and keyed reminder-state schemas including `last_notified_at`. Keep schema-level validation context-free; enforce target and state co-constraints in storage/tool layers.
3. **Implement per-store storage.** Create `mcp-server/src/storage/notifications.ts` with path helpers, pure reads, generic add/list/update operations, and locked transitions for dismiss, defer, dismiss-all, reminder creation, curation completion, and `resetReminderDeferral(storePath, type)`. The reset transition clears `remind_at` only, leaves `last_completed_at`/`last_notified_at`/`active_notification_id` untouched, and is a no-op when no active reminder exists for that store/type. Keep notification records and reminder state under one `.notifications` lock, replace each file atomically, and reconcile stale cross-file references on reads/checks. Make operations idempotent when the target record or active reminder is already resolved.
4. **Refactor the timer.** Update `mcp-server/src/gui/auto-archive.ts` with `checkKnowledgeCurationReminders()` and a unified tick. Read current configuration each tick, initialize missing defaults, scan every configured store, and use the state machine from Step 3. Run archive and reminder work independently, including when archiving is disabled. Preserve existing timer exports through wrappers or aliases and update `mcp-server/gui/server.ts` startup initialization.
5. **Add the completion tool.** Create `mcp-server/src/tools/knowledge-curation.ts`, implement the explicit target resolution rules, call the locked completion transition for one store, and return the store id/reset timestamp. Register the module in `mcp-server/src/index.ts`, update the manually maintained startup `Registered tools` inventory there, and add its help entry to `mcp-server/src/tools/help-content.ts`. Add a focused registration/help assertion so the tool cannot be wired into one inventory while missing the other.
6. **Expose the GUI routes.** Create `mcp-server/gui/api-notifications.ts` with serializable resource handlers and add `buildNotificationRoutes()` to `mcp-server/gui/server.ts`. Register literal routes before parameterized routes and preserve centralized body parsing, status handling, error conversion, and CORS behavior. Require `store_id` on dismiss/defer requests, reject ambiguous cross-store UUID matches, and do not update `stores.json` during dismiss/defer operations. Add `POST /api/notifications/reminders/:store_id/:type/reset-defer`, registered ahead of the `:id` catch-alls, calling `resetReminderDeferral()` and never mutating `stores.json`.
7. **Build the notification UI.** Add notification API methods to `mcp-server/gui/public/api-client.js`, create the persistent component at `mcp-server/gui/public/views/notifications.js`, add the control to `mcp-server/gui/public/index.html`, add `Notifications.init()` to `mcp-server/gui/public/app.js`, and add a route-change close hook to `mcp-server/gui/public/router.js`. Add notification/modal styles to `mcp-server/gui/public/styles.css` using theme tokens and responsive rules. Register the versioned `notifications.js` script tag in `index.html` after `modal.js` and before `app.js`, so its dependencies are loaded first. Implement idempotent app-level unread-count polling independent of `Router._setPolling()`, modal open/close, keyboard focus behavior, dismiss, the fixed 1/7/30 day deferral options, dismiss-all, loading/error states, and modal/transient-listener cleanup on navigation. The poller must remain active across navigation without duplicating intervals. Render origin, message, store labels, dates, IDs, and all dynamic attribute values through the existing escaping utility and use the shared `request()` error contract rather than direct fetch calls. Increment cache-busting version parameters (`?v=N`) for all modified static assets: `index.html`, `api-client.js`, `app.js`, `router.js`, `styles.css`, and `notifications.js`.
8. **Add per-store reminder settings to the Stores tab.** Follow [Scenario 1](usage-scenarios.md#scenario-1-set-a-custom-reminder-cadence-for-one-store) for the cadence-editing flow. Extend the store edit modal in `mcp-server/gui/public/views/config-stores.js` with a "Knowledge curation reminders" field group: an enabled checkbox and a periodicity number input (integer, 1 through 365, default 30), pre-populated from the store's `notification_settings.knowledge_curation` values. Validate the periodicity bound client-side before save (mirroring `csValidateLabel()`'s pattern), and extend the existing `API.updateStore()` call so it submits both fields alongside `label`. Follow [Scenario 2](usage-scenarios.md#scenario-2-reset-an-unwanted-deferral-back-to-the-default-schedule) for deferred-reminder recovery: when the store's `reminder_state.knowledge_curation.remind_at` is set and in the future, render the snooze date next to the periodicity input with a **Reset to default schedule** button that calls the new `reset-defer` route and clears the displayed snooze state on success, without altering the periodicity value. Increment the cache-busting version parameter for `config-stores.js` in `index.html`.
9. **Integrate the owning persona.** Add `ledger_record_knowledge_curation` to `personas/ledger-support/src/meta/ledger-knowledge-curator.yaml`, prepend a dated semver entry to that persona's `changelog:` block, and document when/how to call it in `personas/ledger-support/src/content/ledger-knowledge-curator.md`. Update the corresponding summary entry in `personas/changelog.md`. Leave `personas/ledger/src/meta/9-synthesis.yaml` unchanged. Rebuild generated persona outputs through the normal build command, run the freshness check, and never edit generated files directly.
10. **Update project documentation.** Update the MCP manifest and README, then regenerate the overview with `node scripts/generate-agents-overview.js` (or the repository's equivalent CLI command) so `docs/references/agents-overview.md` is current. Regenerate the required `.context/` documents after implementation. Document the canonical deferral owner, explicit multi-store targeting, route-table registration, the curator ownership boundary, and the Stores tab reminder-settings fields.

## Dependencies

- Existing Zod, `crypto.randomUUID()`, `atomicWriteJson()`, `withLock()`, store registry, and store-router utilities.
- Existing GUI route dispatcher and navigation/theme markup.
- Persona build tooling for generated ledger-support outputs.

## Required Components

- New: `mcp-server/src/schema/notification.ts`
- New: `mcp-server/src/storage/notifications.ts`
- New: `mcp-server/src/tools/knowledge-curation.ts`
- New: `mcp-server/gui/api-notifications.ts`
- New: `mcp-server/gui/public/views/notifications.js`
- Modified: `mcp-server/src/schema/store-config.ts`, `mcp-server/gui/api-stores.ts`, `mcp-server/src/gui/auto-archive.ts`, `mcp-server/gui/server.ts`, `mcp-server/src/index.ts`, `mcp-server/src/tools/help-content.ts`, `mcp-server/gui/public/api-client.js`, `mcp-server/gui/public/index.html`, `mcp-server/gui/public/app.js`, `mcp-server/gui/public/router.js`, `mcp-server/gui/public/styles.css`, `mcp-server/gui/public/views/config-stores.js`
- Modified persona source: `personas/ledger-support/src/meta/ledger-knowledge-curator.yaml`, `personas/ledger-support/src/content/ledger-knowledge-curator.md`

## Assumptions

1. The existing store registry functions remain the only writers for `stores.json`.
2. Notification UUIDs are generated as UUIDs, but GUI action targeting is deterministic because every dismiss/defer request includes `store_id`; duplicate UUIDs across stores are treated as ambiguous and never resolved implicitly.
3. A dismissed notification is resolved and will not be recreated until the next periodic cadence or completion reset makes a new reminder due.
4. The GUI can list visible notifications across configured stores without requiring a selected store context.
5. `notes` is acknowledgement data only; project comments require an explicit project target and are outside this store-level completion operation.

## Constraints

- All file writes use `atomicWriteJson()` and the appropriate lock; no direct writes or duplicated deferral fields. The design guarantees lock-serialized transitions and per-file atomic replacement, not a cross-file transaction; reconciliation restores the stated reminder invariants after partial completion.
- Multi-store mode must never infer "all stores" from omitted completion-tool input.
- Archive-disabled configuration must not suppress reminder checks.
- No WebSocket or external notification integrations; frontend updates remain polling-based.
- User-visible notification fields and every dynamic HTML attribute value must be HTML-escaped.
- The notification poller must be independent from `Router._setPolling()`, initialized idempotently by `app.js`, and must not accumulate listeners or intervals across repeated initialization.
- Notification item actions must include `store_id`; omitted, unknown, or conflicting store targets are validation errors, and duplicate UUID matches are rejected as ambiguous.
- Deferral accepts only integer `delay_days` values 1, 7, or 30 at both the API and UI boundaries; no other delay is accepted.
- The notification control and modal must use semantic labels, keyboard-reachable controls, visible focus states, focus restoration, and light/dark theme tokens.
- Generated persona files are build outputs and must not be edited directly.
- Cross-platform path and temporary-file APIs must be used.
- Per-store knowledge curation settings (`enabled`, `periodicity_days`) must be editable through the existing Stores tab edit modal and `updateStore()` flow; do not introduce a separate settings surface or rely on direct `stores.json` editing as the user-facing path.

## Out of Scope

- Push notifications or email/Slack/Discord integrations.
- Notification severity, search, custom filtering, or origin registry.
- Bulk defer or dismiss-by-origin operations beyond the required dismiss-all action.
- Reminder types other than the initial knowledge curation type, although the storage schema and keyed state must support future types.
- Persisting completion notes as comments on an arbitrary project.

## Acceptance Criteria

- AC-01: Each store has configurable knowledge curation `enabled` and `periodicity_days` settings, defaulting to `true` and `30`.
- AC-02: Periodicity validation accepts only integer values from 1 through 365.
- AC-03: Notification records and reminder state persist under the owning store's `.notifications/` directory and survive GUI restart; after a partial write or crash, startup/periodic reconciliation clears stale active references and never creates a duplicate for a valid active record.
- AC-04: At most one active knowledge-curation notification exists per store and reminder type.
- AC-05: Deferral has one canonical state owner, suppresses visibility until `remind_at`, and does not alter configured periodicity.
- AC-06: Individual dismissal and dismiss-all resolve notifications durably and clear active reminder references.
- AC-07: The GUI shows a notification control with unread count, newest-first modal content, origin, local date/time, dismiss, bounded deferral, and dismiss-all actions.
- AC-08: The completion tool targets exactly one store; multi-store global calls require `store_id`, repository-name resolution is unambiguous, and omitted input never resets all stores.
- AC-09: The completion tool succeeds when the curation pass found no changes and returns the targeted store id and reset timestamp.
- AC-10: Completion resets the targeted store's cadence and resolves its active reminder without affecting other stores.
- AC-11: The existing ten-minute GUI timer runs archive and reminder checks independently, and archive disabled mode still permits reminder checks.
- AC-12: New stores and existing stores missing settings receive idempotent static defaults.
- AC-13: Notification API routes use the declarative route-table builder and centralized dispatcher behavior.
- AC-14: The notification storage model supports future reminder types without adding reminder-specific fields to `stores.json`.
- AC-15: The Ledger Knowledge Curator persona exposes and documents the completion tool; Synthesis remains unchanged.
- AC-16: Notification polling is initialized exactly once by `app.js`, uses an interval independent of `Router._setPolling()`, survives route changes, and never displaces or duplicates active page polling.
- AC-17: Navigation closes the notification modal and removes transient modal listeners while preserving the app-level unread-count poll; repeated initialization and test disposal leave no duplicate listeners or intervals.
- AC-18: The notification control and modal are keyboard accessible, expose the required ARIA relationships, trap and restore focus, close on Escape/backdrop interaction, and retain visible focus in both themes.
- AC-19: Dismiss and defer requests include the notification's `store_id`; missing, unknown, mismatched, or ambiguous store targets are rejected without mutating another store.
- AC-20: Deferral accepts the documented `delay_days` contract, with UI options of 1, 7, and 30 days, and never changes configured periodicity.
- AC-21: `GET /api/notifications` returns deterministic visible/unread semantics and newest-first ordering, and the UI renders the returned count consistently with the visible notification set.
- AC-22: Notification styles use CSS custom-property tokens with dark-mode overrides and reflow correctly with the existing responsive header at narrow viewports.
- AC-23: The Stores tab edit modal exposes per-store knowledge-curation `enabled` and `periodicity_days` settings, validates the 1-365 bound client-side, and persists both through the existing store-update flow.
- AC-24: A store whose knowledge-curation reminder is currently deferred shows its `remind_at` date and a "Reset to default schedule" control in the Stores tab edit modal; using it clears the deferral via the store/type-keyed `reset-defer` route, the previously active notification (if not dismissed) becomes visible again on the next `GET /api/notifications` call, and neither periodicity nor `last_completed_at` is altered.

## Testing Strategy

Test the state machine at the storage boundary, then test timer, tool, route, and frontend integration around those stable operations. Use temporary directories for filesystem tests, inject/mock the clock and store configuration where the existing test patterns permit it, and cover multi-store isolation explicitly. Add route-table structural assertions and handler behavior tests. Use the existing jsdom/Vitest GUI harness for API-client and view behavior, supplemented by a manual browser scenario for final interaction and layout verification.

## Test Plan

- `mcp-server/tests/schema/notification.test.ts` — notification and reminder-state parsing, defaults, UUID/timestamp validation — AC-03, AC-14.
- `mcp-server/tests/schema/store-config.test.ts` — static settings defaults, bounds, and backward-compatible entries — AC-01, AC-02, AC-12.
- `mcp-server/tests/storage/notifications.test.ts` — locked add/list/dismiss/defer/dismiss-all/completion transitions, idempotence, canonical deferral, dismissal cadence guard, per-file atomic persistence, and reconciliation of missing/dismissed active records after partial writes — AC-03 through AC-06, AC-14.
- `mcp-server/tests/gui/auto-archive.test.ts` and the existing multi-store timer test — due/not-due behavior, active-notification deduplication, disabled archive isolation, default initialization, and per-store failures — AC-04, AC-10 through AC-12.
- `mcp-server/tests/tools/knowledge-curation.test.ts` — explicit store target, default legacy target, repository-name resolution, conflicting/ambiguous targets, no-change completion, and non-target isolation — AC-08 through AC-10.
- `mcp-server/tests/gui/api-notifications.test.ts` — list/filter, dismiss, defer validation for only 1/7/30 days, dismiss-all, cross-store lookup, ambiguous UUID rejection, error/status conversion, and `reset-defer` clearing `remind_at` without touching periodicity or `last_completed_at` (including its no-op case when no active reminder exists) — AC-06, AC-07, AC-13, AC-19 through AC-21, AC-24.
- `mcp-server/tests/gui/route-table.test.ts` or the existing route-table suite — notification route method/path validity, literal/parameterized ordering, and no duplicate routes — AC-13.
- `mcp-server/tests/gui/api-stores.test.ts` — both store-creation branches persist notification defaults, and `PUT /api/stores/:id` persists partial `notification_settings.knowledge_curation` updates — AC-12, AC-23.
- `mcp-server/tests/gui/config-stores.test.ts` or the existing Stores-tab jsdom suite — [Scenario 1](usage-scenarios.md#scenario-1-set-a-custom-reminder-cadence-for-one-store): edit modal renders and pre-populates `enabled`/`periodicity_days`, validates the 1-365 bound client-side, and calls `API.updateStore()` with both fields alongside `label`; [Scenario 2](usage-scenarios.md#scenario-2-reset-an-unwanted-deferral-back-to-the-default-schedule): renders the snooze date plus "Reset to default schedule" control only when `remind_at` is set and in the future, and calls the `reset-defer` route on click — AC-23, AC-24.
- `mcp-server/tests/gui/api-client.test.ts` — notification list, dismiss, defer, and dismiss-all methods use the shared request wrapper and expose its error behavior — AC-07, AC-13.
- `mcp-server/tests/gui/notifications.test.ts` — jsdom rendering escapes notification fields and attributes, updates the unread count, handles modal actions/loading/errors, verifies ARIA/focus behavior, confirms idempotent init/dispose, proves notification polling does not replace router polling, and verifies navigation closes transient modal state while preserving the app-level poll — AC-07, AC-16 through AC-22.
- `mcp-server/tests/gui/static-shell.test.ts` or the existing shell harness — verify `notifications.js` is registered with a versioned script tag after `modal.js` and before `app.js`, confirm bootstrap and route-hook dependency order, and ensure cache-busting query parameters are present on all modified static assets (`index.html`, `api-client.js`, `app.js`, `router.js`, `styles.css`, `notifications.js`) — AC-07, AC-13, AC-16.
- `mcp-server/tests/startup/tool-log-sync.test.ts` or the focused registration suite — completion tool appears in registration, startup inventory, and help contracts — AC-08, AC-13.
- Persona YAML changelog/version check and persona build freshness check — ledger-support curator output contains the new tool contract, source metadata has the required changelog entry, and no generated file was edited directly — AC-15.
- Manual browser scenario — execute [Scenario 1](usage-scenarios.md#scenario-1-set-a-custom-reminder-cadence-for-one-store) and [Scenario 2](usage-scenarios.md#scenario-2-reset-an-unwanted-deferral-back-to-the-default-schedule), then create two stores, trigger one reminder, defer/dismiss it, verify count/modal behavior, complete curation for one store, and confirm the other store is unchanged; repeat the control and modal checks in both themes and at the existing narrow-header breakpoint — AC-04 through AC-10, AC-18, AC-22, AC-24.

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — add notification schemas/storage functions, route handlers, timer exports, and the completion-tool signature.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add the three new MCP-server source files (`mcp-server/src/schema/notification.ts`, `mcp-server/src/storage/notifications.ts`, `mcp-server/src/tools/knowledge-curation.ts`) and the modified supporting files in the annotated directory listing.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — document per-store reminder evaluation, canonical deferral, completion reset, and GUI route flow.
- `mcp-server/docs/agents/project-manifest/constraints.md` — document per-store isolation, one-owner reminder state, explicit multi-store completion targeting, and route-table ordering.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — add the notification route handlers and their request/response signatures.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — add the new frontend view file (`mcp-server/gui/public/views/notifications.js`) and modified files.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — document the notification polling flow, modal lifecycle, dismiss/defer/dismiss-all actions, and integration with the periodic timer.
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — document the persistent notification control (unread count badge, accessible icon state), modal structure, fixed deferral options, focus behavior, styling integration, and the Stores tab's per-store reminder settings fields (enabled toggle, periodicity input, validation bound, snooze-status display, and "Reset to default schedule" control).
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — document cache-busting version parameter requirements, HTML-escaping rules for notification fields and attributes, the app-level polling owner, persistent-listener lifecycle, explicit store targeting, and the routed-view exception.
- `mcp-server/README.md` — describe the GUI reminder capability and curator completion tool at the user-facing level.
- `personas/ledger-support/src/meta/ledger-knowledge-curator.yaml` — add the tool contract and dated semver changelog entry that drives generated persona version metadata.
- `personas/ledger-support/src/content/ledger-knowledge-curator.md` and generated outputs — document the completion call as the final step of both maintenance modes.
- `personas/changelog.md` — summarize the curator contract change in the module changelog.
- `docs/references/agents-overview.md` and generated `.context/` files — regenerate with the repository generator/check after persona or manifest changes.
- Relevant module changelogs — add release notes when this plan is implemented as part of a versioned release.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Notification and reminder-state files diverge after an I/O failure** | Perform related read-modify-write operations under one `.notifications` lock and replace each file atomically. Do not claim cross-file transactionality; startup and each periodic check reconcile missing or dismissed active ids, preserving the invariant that a valid active notification is unique and stale references are cleared. |
| **A future deferral is bypassed by periodic eligibility** | The timer treats `remind_at` as the canonical gate and never compares periodicity independently while an active reminder is deferred. |
| **A completion call resets the wrong store** | Require explicit `store_id` for multi-store global calls, reject conflicting repository/store targets, and never implement omitted input as an all-store operation. |
| **Archive configuration disables reminders accidentally** | Keep archive and reminder operations as separate functions with separate error handling and tests for `auto_archive_days: 0`. |
| **Route ordering shadows a notification endpoint** | Add route-table tests and place literal paths before parameterized entries. |
| **Notification content introduces XSS** | Escape origin, message, labels, and timestamps before rendering; avoid inserting untrusted strings as raw HTML. |
| **Notification polling stops page polling or accumulates intervals** | Keep it outside `Router._setPolling()`, initialize it once from `app.js`, make `init()` idempotent, and test navigation plus disposal. |
| **A UUID action targets the wrong store** | Include `store_id` in every item action and reject missing, mismatched, or ambiguous cross-store matches. |
| **Modal interaction is inaccessible or loses focus** | Reuse the shared modal lifecycle utility and verify ARIA semantics, keyboard navigation, focus trapping, Escape close, and focus restoration. |
| **Notification styling breaks in dark mode or narrow headers** | Use CSS tokens with dark overrides and verify responsive header reflow at the existing mobile breakpoint. |
| **Curator does not close the reminder** | Put the tool in the dedicated curator source metadata/content, rebuild generated outputs, and test the source-to-output contract. |
| **Stores tab UI accepts an out-of-range periodicity value** | Mirror the 1-365 integer bound client-side in `config-stores.js`; server-side Zod validation in `store-config.ts` remains the source of truth and rejects invalid writes. |
| **A deferred reminder becomes unreachable because the visible-list filter hides it and no UUID is exposed to the client** | Expose reminder-state summary (`remind_at`) on the store read path and provide the store/type-keyed `reset-defer` route plus a Stores tab snooze-status control, so the user never needs the hidden notification's UUID. |

## Recommended Workflow

- **Workflow:** ledger
- **Rationale:** This remains a cross-module feature with storage, timer, MCP, GUI routing, frontend, and persona changes, plus concurrency and multi-store semantics that benefit from formal QA, security, and review stages.