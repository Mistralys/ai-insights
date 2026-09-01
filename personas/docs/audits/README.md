# Persona Audits

Tracking and historical record for persona compliance audits against the
[Persona Design Guide](../persona-design-guide.md).

## Files

| File | Written by | Purpose |
|------|-----------|---------|
| [notes.md](notes.md) | Hand | Audit methodology, findings that generalise beyond one persona, roll-forward reasoning. Cumulative — entries are added, never replaced. |
| [status.md](status.md) | `scripts/generate-persona-audit.js` | Per-persona tracking table. **Fully generated — never hand-edit.** |
| [annotations.json](annotations.json) | Hand | Editorial text for the Notes column of `status.md`, keyed by suite and persona YAML stem. |

## Why three files

The tracking table is derived entirely from persona YAML (`audit_guide_version`,
`audit_date`, changelog) and source composition, so it is regenerated wholesale on every
run. Anything hand-written inside it is lost. Splitting the narrative into `notes.md` and
the per-row commentary into `annotations.json` keeps both durable while leaving the table
free to be overwritten.

Audit state is deliberately **not** stored in persona YAML: `audit_guide_version` and
`audit_date` are facts about the persona, whereas "paired audit with twin" or "tone fix
only" are facts about the audit process. The two have different lifecycles.

## Regenerating

```bash
node scripts/cli.js generate-persona-audit
```

Writes `status.md` in place. Use `--stdout` to preview without writing, or
`-o <file>` to write elsewhere.

## The Tier column

Tier is **computed** from each persona's source, not recorded by hand:

| Tier | Meaning |
|------|---------|
| **A** | No partials, no target conditionals. The rendered output is the source plus frontmatter, so design guide v3.3's rendered-output requirement does not apply — the guide waives it where the persona is already its own rendered output. |
| **B (Np/Mc)** | N partial references, M conditionals. The assembled document must be read end to end to be verified. |

Because it is computed, a persona that gains its first partial flips from A to B on the
next run, which surfaces that its existing audit stamp no longer covers everything the
guide requires. Recording the tier by hand would lose that signal.

## Adding an annotation

Keys are the persona's YAML filename stem, grouped by suite:

```json
{
  "ledger":     { "1-planner": "Paired audit with standalone twin" },
  "standalone": { "persona-curator": "Full self-audit at v3.2" },
  "support":    { "ledger-doctor": "Tone fix only" }
}
```

A missing key renders an empty cell. Do not restate the tier here — it is already its own
column.
