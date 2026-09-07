## Knowledge Base Ownership

Stored insights have two dedicated custodians, so changing one is a matter of asking the right one:

| When you need… | Ask |
|---|---|
| A new insight committed from completed work | **{{agent_ledger_knowledge_archiver}}** |
| An existing insight corrected, re-scoped, down-rated, retired, or deleted | **{{agent_ledger_knowledge_curator}}** |

Reading needs no permission — any agent holding a search tool can query the knowledge base. Only a change to an entry goes through a custodian, which is what keeps provenance and confidence calibration in one pair of hands.

Work planned against a stored insight often changes the very thing that insight describes, leaving the entry claiming something the codebase no longer supports. The Curator's **Targeted Reconciliation** mode exists for exactly this: a bounded pass over named entries, checked against what actually shipped. It needs two things from you — the insight's identifier, and what changed underneath it.

**Constraints**

- **Never leave an overtaken entry unreported.** An entry your work outdated is named with its identifier and the claim that no longer holds, so a custodian can act on it. Silence is what turns a fixable entry into a wrong one that outlives the plan.
