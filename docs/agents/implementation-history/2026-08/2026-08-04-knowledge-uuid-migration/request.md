# Request

Referring to this synthesis entry in the project `2026-08-04-gui-knowledge-multi-store`:

```
- [low] (debt) `mcp-server/src/storage/multi-store-manager.ts` — The `listKnowledge` and `searchKnowledge` dedup uses `insight.id` (numeric) as the key. Because each store assigns IDs starting from 1 independently, two stores can produce insights with the same numeric `id`. First-store-wins dedup silently drops the second. This is documented as a known assumption in the plan but could surprise users in multi-store deployments with many stores. A composite key (`storeId:id`) would be safer but requires a schema change.
```

I noticed this too. We should find a different way to identify knowledge entries, as the numeric IDs also make it difficult to move/copy knowledge between stores when needed. Any ideas?

Note: All known stores are currently configured in the project, so we can upgrade them all without backwards compatibility considerations. The two external stores are available directly in the workspace (ledger-storage and nexus-ledger-storage).
