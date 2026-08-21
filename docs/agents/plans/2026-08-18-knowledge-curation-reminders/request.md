# Project: Knowledge Curation Reminders

## Description

The knowledge database in the ledger requires occasional reviewing. This is someting that has to be done manually be the user, and with the dedicated ledger knowledge curator agent. To help with the maintenance, we will add a reminder in the GUI that is triggered once every month by default.

## Notification System

We will add a notification system in the GUI that collects these messages, accessible via an icon in the meta navigation (before the light/dark theme switcher). This is highlighted when there are messages, with the amount of messages next to it. Clicking the icon opens the notifications modal that displays a list of notifications from most recent to oldest.

Each notification has a date and time when it was triggered, and an origin (who triggered it, e.g. the MCP server, the Knowledge store, etc...). For the knowledge curation reminder, for example, I would expect the notification to look like this:

```
Friendly reminder that the knowledge stored in {STORE_LABEL} is due a curation pass after {PERIODICITY_LABEL} to ensure its accuracy. A manual review is recommended, which the  {KNOWLEDGE_CURATOR_AGENT_NAME} can assist you with.

Date: {DATE_AND_TIME}
Origin: Knowledge store, {STORE_LABEl}
```

A serverside utility/API allows registering notifications, available for all consumers in the project.

Notification data is persisted at the store level (see "Multi-Store Awareness and Storage").

### Dismissing Notifications

Notifications must be dismissable individually as well as through a "Dismiss all" button.

### Deferring Notifications

Instead of dismissing individual notifications, the user can choose to defer them: This effectively dismisses the notification, but schedules it to be shown again after a delay of the user's choosing through a dropdown with a list of typical delays.

Example: "Remind me in: 1 day", "Remind me in: 1 month".

The minimum reminder delay is 1 hour, the maximum delay is 1 month.

> The remind delay the user chooses overrides the configured periodicity of the notification. For example, if the notification is scheduled every week but the user chooses to be reminded in a month, the weekly schedule should be overriden so the notification is shown after a month.

The deferral settings are stored in the according store (see "Multi-Store Awareness and Storage").

### Configuration Settings

Each store gets a new configuration setting to choose the periodicity for which to trigger knowledge curation reminders. Default is 1 month. It must also be possible to turn off the reminder entirely (in this case, the notification is never triggered).

### Multi-Store Awareness and Storage

Since the knowledge is dispersed across multiple stores, each store must track its own reminder scheduling, periodicity, settings and temporary file storage. 

> Stores can have very different maintenance paradigms, as illustrated by my own workspaces: I have two stores, one for the company-internal projects, and one for my open source projects. They have very different requirements, so where I typically run a knowledge curation every month on the company side, I do it every three months on the personal side because the code there changes less often.

### Knowledge Curation Resets the Timer

When the knowledge curator runs, it must reset the curation reminder timer - even if no changes are made to any of the knowledge stores. The knowledge can be entirely accurate, necessitating no changes.

If needed, this can be done through a new MCP tool or an existing knowledge curation tool with empty parameters - whichever works best.

### Initial Setup

The notifications are registered during the initial setup of the project (see the CLI menu), and additionally in an idempotent way on demand if either the notification configuration or the first check are missing.


## Periodically Run Processes

The check whether the knowledge store needs a curation pass needs to be run periodically. For this, the ideal location is the existing periodic timer in the GUI, which is currently used for auto-archiving projects. This can be extended as necessary, and since the GUI is the only persistent process in the architecture, it's the logical place to add it.

## Notification System Scope

The notification system is intended to be universally usable by any future consumers in the project to register their own notifications. It must be generic enough to allow this.
