# Usage Scenarios — Knowledge Curation Reminders

> Companion to [plan.md](plan.md). Each scenario walks through the feature from the end user's
> point of view, in plain GUI-interaction terms, to validate that the planned design actually
> delivers what the user needs. Scenarios are added incrementally as the plan evolves.

## Scenario 1: Set a custom reminder cadence for one store

**Context:** The user runs two stores — `company` (company-internal projects) and `personal`
(open source projects). Company knowledge changes often and should be curated monthly (the
default). Personal knowledge changes rarely, so the user wants curation reminders only once
every three months.

**Goal:** Change the `personal` store's knowledge-curation periodicity from the default 30 days
to 90 days, without affecting the `company` store.

**Steps:**

1. Open the GUI and navigate to **Config → Stores**.
2. Find the `personal` store row and click **Edit**.
3. In the edit modal, locate the new **Knowledge curation reminders** field group, below the
   existing Label field:
   - An **Enabled** toggle (on by default).
   - A **Remind every ⟨N⟩ days** number input, pre-filled with the store's current value (`30`
     if never changed).
4. Change the number input from `30` to `90`.
5. Click **Save**.

**Expected outcome:**

- The modal validates the value client-side (integer, 1–365) before submitting; `90` passes
  immediately.
- The save calls the existing store-update flow (`API.updateStore()` → `PUT /api/stores/:id`),
  now also carrying `notification_settings.knowledge_curation.periodicity_days: 90`.
- The modal closes and the Stores tab reflects the saved store with no error state.
- The `company` store's settings are untouched — it keeps its default 30-day cadence.
- The next periodic check (existing ~10-minute GUI timer) evaluates `personal` against the new
  90-day cadence going forward; it does not retroactively change an already-active notification's
  `remind_at`, and it does not affect `company`'s independent reminder state.
- Re-opening the `personal` store's edit modal later shows `90` pre-filled, confirming the
  setting persisted under that store's entry in `stores.json`.

**Out of scope for this scenario:** disabling the reminder entirely (`Enabled` toggle off),
dismissing/deferring an already-fired notification, and the knowledge curator's completion tool —
these are covered by other scenarios in this document as they are added.

## Scenario 2: Reset an unwanted deferral back to the default schedule

**Context:** The user manages store `A`, whose knowledge-curation periodicity is set to 7 days.
A reminder notification fired, and from the notification modal the user picked the "remind me in
a month" deferral option (`delay_days: 30`) instead of the intended one-week snooze. The
notification's `remind_at` is now roughly 30 days out, which also means the notification is no
longer returned by `GET /api/notifications` — it is filtered out because its `remind_at` is in
the future. There is no dismiss/defer control left in the bell UI for it, because the client
never receives its notification UUID again while it stays hidden.

**Goal:** Cancel the 30-day deferral for store `A`'s knowledge-curation reminder so it goes back
to being governed purely by the store's configured 7-day periodicity, without changing that
periodicity and without affecting any other store.

**Steps:**

1. Open the GUI and navigate to **Config → Stores**.
2. Find the `A` store row and click **Edit**.
3. In the edit modal's **Knowledge curation reminders** field group, the user sees the
   periodicity input (`7`) and, below it, a snooze-status line because
   `reminder_state.knowledge_curation.remind_at` is set and in the future:
   *"Snoozed until 2026-09-17 — **Reset to default schedule**"*.
4. Click **Reset to default schedule**.

**Expected outcome:**

- The button calls `POST /api/notifications/reminders/A/knowledge_curation/reset-defer`, a
  store/type-keyed route (not a notification-UUID-keyed one, since the client never had the
  hidden notification's UUID).
- The handler clears only `remind_at` on store `A`'s keyed reminder state; it does not touch
  `last_completed_at`, `last_notified_at`, `active_notification_id`, or the configured
  `periodicity_days` value.
- The snooze-status line disappears from the edit modal immediately after a successful call,
  confirming the deferral was cleared; the periodicity input still reads `7`.
- The next call to `GET /api/notifications` (whether from the modal closing or the next unread
  poll) re-evaluates store `A`'s existing active notification without a future `remind_at`, so it
  becomes visible again immediately — no new/duplicate notification record is created.
- Store `A`'s reminder now behaves exactly as if it had never been deferred: it is subject only to
  its normal periodicity and dismissal/re-notification rules going forward.
- No other store's reminder state, notifications, or settings are affected.

**Out of scope for this scenario:** a dedicated "Manage reminders" view that lists deferred
reminders across all stores regardless of visibility; that alternative was considered and
rejected in favor of surfacing the reset control where cadence is already edited.
