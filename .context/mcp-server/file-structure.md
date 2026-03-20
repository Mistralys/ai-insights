# MCP Server - File Structure
_SOURCE: Directory tree_
# Directory tree
###  
```
└── mcp-server/
    └── AGENTS.md
    └── README.md
    └── changelog.md
    └── dist/
        ├── gui/
        │   ├── auto-archive.d.ts
        │   ├── auto-archive.d.ts.map
        │   ├── auto-archive.js
        │   ├── auto-archive.js.map
        │   ├── config.d.ts
        │   ├── config.d.ts.map
        │   ├── config.js
        │   ├── config.js.map
        ├── index.d.ts
        ├── index.d.ts.map
        ├── index.js
        ├── index.js.map
        ├── schema/
        │   ├── enums.d.ts
        │   ├── enums.d.ts.map
        │   ├── enums.js
        │   ├── enums.js.map
        │   ├── project-meta.d.ts
        │   ├── project-meta.d.ts.map
        │   ├── project-meta.js
        │   ├── project-meta.js.map
        │   ├── root-index.d.ts
        │   ├── root-index.d.ts.map
        │   ├── root-index.js
        │   ├── root-index.js.map
        │   ├── validators.d.ts
        │   ├── validators.d.ts.map
        │   ├── validators.js
        │   ├── validators.js.map
        │   ├── work-package.d.ts
        │   ├── work-package.d.ts.map
        │   ├── work-package.js
        │   ├── work-package.js.map
        │   ├── workflow-manifest-schema.d.ts
        │   ├── workflow-manifest-schema.d.ts.map
        │   ├── workflow-manifest-schema.js
        │   ├── workflow-manifest-schema.js.map
        ├── storage/
        │   ├── atomic-writer.d.ts
        │   ├── atomic-writer.d.ts.map
        │   ├── atomic-writer.js
        │   ├── atomic-writer.js.map
        │   ├── file-lock.d.ts
        │   ├── file-lock.d.ts.map
        │   ├── file-lock.js
        │   ├── file-lock.js.map
        │   ├── ledger-store.d.ts
        │   ├── ledger-store.d.ts.map
        │   ├── ledger-store.js
        │   ├── ledger-store.js.map
        ├── tools/
        │   ├── begin-work.d.ts
        │   ├── begin-work.d.ts.map
        │   ├── begin-work.js
        │   ├── begin-work.js.map
        │   ├── help-content.d.ts
        │   ├── help-content.d.ts.map
        │   ├── help-content.js
        │   ├── help-content.js.map
        │   ├── help.d.ts
        │   ├── help.d.ts.map
        │   ├── help.js
        │   ├── help.js.map
        │   ├── observations.d.ts
        │   ├── observations.d.ts.map
        │   ├── observations.js
        │   ├── observations.js.map
        │   ├── pipeline.d.ts
        │   ├── pipeline.d.ts.map
        │   ├── pipeline.js
        │   ├── pipeline.js.map
        │   ├── project-lifecycle.d.ts
        │   ├── project-lifecycle.d.ts.map
        │   ├── project-lifecycle.js
        │   ├── project-lifecycle.js.map
        │   ├── work-package.d.ts
        │   ├── work-package.d.ts.map
        │   ├── work-package.js
        │   ├── work-package.js.map
        │   ├── workflow-batch-actions.d.ts
        │   ├── workflow-batch-actions.d.ts.map
        │   ├── workflow-batch-actions.js
        │   ├── workflow-batch-actions.js.map
        │   ├── workflow-handoff.d.ts
        │   ├── workflow-handoff.d.ts.map
        │   ├── workflow-handoff.js
        │   ├── workflow-handoff.js.map
        │   ├── workflow-next-action-batch.d.ts
        │   ├── workflow-next-action-batch.d.ts.map
        │   ├── workflow-next-action-batch.js
        │   ├── workflow-next-action-batch.js.map
        │   ├── workflow-next-action.d.ts
        │   ├── workflow-next-action.d.ts.map
        │   ├── workflow-next-action.js
        │   ├── workflow-next-action.js.map
        │   ├── workflow.d.ts
        │   ├── workflow.d.ts.map
        │   ├── workflow.js
        │   ├── workflow.js.map
        ├── utils/
        │   └── agent-registry.d.ts
        │   └── agent-registry.d.ts.map
        │   └── agent-registry.js
        │   └── agent-registry.js.map
        │   └── constants.d.ts
        │   └── constants.d.ts.map
        │   └── constants.js
        │   └── constants.js.map
        │   └── if-defined.d.ts
        │   └── if-defined.d.ts.map
        │   └── if-defined.js
        │   └── if-defined.js.map
        │   └── ledger-root.d.ts
        │   └── ledger-root.d.ts.map
        │   └── ledger-root.js
        │   └── ledger-root.js.map
        │   └── path-validator.d.ts
        │   └── path-validator.d.ts.map
        │   └── path-validator.js
        │   └── path-validator.js.map
        │   └── pipeline-maps.d.ts
        │   └── pipeline-maps.d.ts.map
        │   └── pipeline-maps.js
        │   └── pipeline-maps.js.map
        │   └── project-reset.d.ts
        │   └── project-reset.d.ts.map
        │   └── project-reset.js
        │   └── project-reset.js.map
        │   └── read-project-name.d.ts
        │   └── read-project-name.d.ts.map
        │   └── read-project-name.js
        │   └── read-project-name.js.map
        │   └── timestamp.d.ts
        │   └── timestamp.d.ts.map
        │   └── timestamp.js
        │   └── timestamp.js.map
        │   └── workflow-helpers.d.ts
        │   └── workflow-helpers.d.ts.map
        │   └── workflow-helpers.js
        │   └── workflow-helpers.js.map
        │   └── wp-id.d.ts
        │   └── wp-id.d.ts.map
        │   └── wp-id.js
        │   └── wp-id.js.map
    └── docs/
        ├── agents/
        │   └── project-manifest/
        │       ├── README.md
        │       ├── api-surface.md
        │       ├── constraints.md
        │       ├── data-flows.md
        │       ├── file-tree.md
        │       ├── tech-stack.md
        │   └── workflow-specification/
        │       └── README.md
        │       └── auxiliary-systems.md
        │       └── data-model.md
        │       └── dependencies-and-rework.md
        │       └── edge-cases.md
        │       └── handoff.md
        │       └── operations.md
        │       └── pipeline-routing.md
        │       └── recommendations.md
        │       └── state-machines.md
        │       └── walkthrough.md
    └── gui/
        ├── api.ts
        ├── public/
        │   ├── api-client.js
        │   ├── app.js
        │   ├── index.html
        │   ├── libs/
        │   │   ├── marked.min.js
        │   ├── router.js
        │   ├── styles.css
        │   ├── theme.js
        │   ├── utils.js
        │   ├── views/
        │   │   └── config.js
        │   │   └── insights.js
        │   │   └── project-detail.js
        │   │   └── project-list.js
        │   │   └── work-package.js
        ├── server.ts
    └── module-context.yaml
    └── node_modules/
        ├── @esbuild/
        │   ├── darwin-x64/
        │   │   └── README.md
        │   │   └── bin/
        │   │       ├── esbuild/
        │   │   └── package.json
        ├── @hono/
        │   ├── node-server/
        │   │   └── README.md
        │   │   └── dist/
        │   │       ├── conninfo.d.mts
        │   │       ├── conninfo.d.ts
        │   │       ├── conninfo.js
        │   │       ├── conninfo.mjs
        │   │       ├── globals.d.mts
        │   │       ├── globals.d.ts
        │   │       ├── globals.js
        │   │       ├── globals.mjs
        │   │       ├── index.d.mts
        │   │       ├── index.d.ts
        │   │       ├── index.js
        │   │       ├── index.mjs
        │   │       ├── listener.d.mts
        │   │       ├── listener.d.ts
        │   │       ├── listener.js
        │   │       ├── listener.mjs
        │   │       ├── request.d.mts
        │   │       ├── request.d.ts
        │   │       ├── request.js
        │   │       ├── request.mjs
        │   │       ├── response.d.mts
        │   │       ├── response.d.ts
        │   │       ├── response.js
        │   │       ├── response.mjs
        │   │       ├── serve-static.d.mts
        │   │       ├── serve-static.d.ts
        │   │       ├── serve-static.js
        │   │       ├── serve-static.mjs
        │   │       ├── server.d.mts
        │   │       ├── server.d.ts
        │   │       ├── server.js
        │   │       ├── server.mjs
        │   │       ├── types.d.mts
        │   │       ├── types.d.ts
        │   │       ├── types.js
        │   │       ├── types.mjs
        │   │       ├── utils.d.mts
        │   │       ├── utils.d.ts
        │   │       ├── utils.js
        │   │       ├── utils.mjs
        │   │       ├── utils/
        │   │       │   ├── response.d.mts
        │   │       │   ├── response.d.ts
        │   │       │   ├── response.js
        │   │       │   ├── response.mjs
        │   │       │   ├── response/
        │   │       │   │   └── constants.d.mts
        │   │       │   │   └── constants.d.ts
        │   │       │   │   └── constants.js
        │   │       │   │   └── constants.mjs
        │   │       ├── vercel.d.mts
        │   │       ├── vercel.d.ts
        │   │       ├── vercel.js
        │   │       ├── vercel.mjs
        │   │   └── package.json
        ├── @jridgewell/
        │   ├── sourcemap-codec/
        │   │   └── LICENSE/
        │   │   └── README.md
        │   │   └── dist/
        │   │       ├── sourcemap-codec.mjs
        │   │       ├── sourcemap-codec.mjs.map
        │   │       ├── sourcemap-codec.umd.js
        │   │       ├── sourcemap-codec.umd.js.map
        │   │   └── package.json
        │   │   └── src/
        │   │       ├── scopes.ts
        │   │       ├── sourcemap-codec.ts
        │   │       ├── strings.ts
        │   │       ├── vlq.ts
        │   │   └── types/
        │   │       └── scopes.d.cts
        │   │       └── scopes.d.cts.map
        │   │       └── scopes.d.mts
        │   │       └── scopes.d.mts.map
        │   │       └── sourcemap-codec.d.cts
        │   │       └── sourcemap-codec.d.cts.map
        │   │       └── sourcemap-codec.d.mts
        │   │       └── sourcemap-codec.d.mts.map
        │   │       └── strings.d.cts
        │   │       └── strings.d.cts.map
        │   │       └── strings.d.mts
        │   │       └── strings.d.mts.map
        │   │       └── vlq.d.cts
        │   │       └── vlq.d.cts.map
        │   │       └── vlq.d.mts
        │   │       └── vlq.d.mts.map
        ├── @modelcontextprotocol/
        │   ├── sdk/
        │   │   └── LICENSE/
        │   │   └── README.md
        │   │   └── dist/
        │   │       ├── cjs/
        │   │       │   ├── client/
        │   │       │   │   ├── auth-extensions.d.ts
        │   │       │   │   ├── auth-extensions.d.ts.map
        │   │       │   │   ├── auth-extensions.js
        │   │       │   │   ├── auth-extensions.js.map
        │   │       │   │   ├── auth.d.ts
        │   │       │   │   ├── auth.d.ts.map
        │   │       │   │   ├── auth.js
        │   │       │   │   ├── auth.js.map
        │   │       │   │   ├── index.d.ts
        │   │       │   │   ├── index.d.ts.map
        │   │       │   │   ├── index.js
        │   │       │   │   ├── index.js.map
        │   │       │   │   ├── middleware.d.ts
        │   │       │   │   ├── middleware.d.ts.map
        │   │       │   │   ├── middleware.js
        │   │       │   │   ├── middleware.js.map
        │   │       │   │   ├── sse.d.ts
        │   │       │   │   ├── sse.d.ts.map
        │   │       │   │   ├── sse.js
        │   │       │   │   ├── sse.js.map
        │   │       │   │   ├── stdio.d.ts
        │   │       │   │   ├── stdio.d.ts.map
        │   │       │   │   ├── stdio.js
        │   │       │   │   ├── stdio.js.map
        │   │       │   │   ├── streamableHttp.d.ts
        │   │       │   │   ├── streamableHttp.d.ts.map
        │   │       │   │   ├── streamableHttp.js
        │   │       │   │   ├── streamableHttp.js.map
        │   │       │   │   ├── websocket.d.ts
        │   │       │   │   ├── websocket.d.ts.map
        │   │       │   │   ├── websocket.js
        │   │       │   │   ├── websocket.js.map
        │   │       │   ├── examples/
        │   │       │   │   ├── client/
        │   │       │   │   │   ├── elicitationUrlExample.d.ts
        │   │       │   │   │   ├── elicitationUrlExample.d.ts.map
        │   │       │   │   │   ├── elicitationUrlExample.js
        │   │       │   │   │   ├── elicitationUrlExample.js.map
        │   │       │   │   │   ├── multipleClientsParallel.d.ts
        │   │       │   │   │   ├── multipleClientsParallel.d.ts.map
        │   │       │   │   │   ├── multipleClientsParallel.js
        │   │       │   │   │   ├── multipleClientsParallel.js.map
        │   │       │   │   │   ├── parallelToolCallsClient.d.ts
        │   │       │   │   │   ├── parallelToolCallsClient.d.ts.map
        │   │       │   │   │   ├── parallelToolCallsClient.js
        │   │       │   │   │   ├── parallelToolCallsClient.js.map
        │   │       │   │   │   ├── simpleClientCredentials.d.ts
        │   │       │   │   │   ├── simpleClientCredentials.d.ts.map
        │   │       │   │   │   ├── simpleClientCredentials.js
        │   │       │   │   │   ├── simpleClientCredentials.js.map
        │   │       │   │   │   ├── simpleOAuthClient.d.ts
        │   │       │   │   │   ├── simpleOAuthClient.d.ts.map
        │   │       │   │   │   ├── simpleOAuthClient.js
        │   │       │   │   │   ├── simpleOAuthClient.js.map
        │   │       │   │   │   ├── simpleOAuthClientProvider.d.ts
        │   │       │   │   │   ├── simpleOAuthClientProvider.d.ts.map
        │   │       │   │   │   ├── simpleOAuthClientProvider.js
        │   │       │   │   │   ├── simpleOAuthClientProvider.js.map
        │   │       │   │   │   ├── simpleStreamableHttp.d.ts
        │   │       │   │   │   ├── simpleStreamableHttp.d.ts.map
        │   │       │   │   │   ├── simpleStreamableHttp.js
        │   │       │   │   │   ├── simpleStreamableHttp.js.map
        │   │       │   │   │   ├── simpleTaskInteractiveClient.d.ts
        │   │       │   │   │   ├── simpleTaskInteractiveClient.d.ts.map
        │   │       │   │   │   ├── simpleTaskInteractiveClient.js
        │   │       │   │   │   ├── simpleTaskInteractiveClient.js.map
        │   │       │   │   │   ├── ssePollingClient.d.ts
        │   │       │   │   │   ├── ssePollingClient.d.ts.map
        │   │       │   │   │   ├── ssePollingClient.js
        │   │       │   │   │   ├── ssePollingClient.js.map
        │   │       │   │   │   ├── streamableHttpWithSseFallbackClient.d.ts
        │   │       │   │   │   ├── streamableHttpWithSseFallbackClient.d.ts.map
        │   │       │   │   │   ├── streamableHttpWithSseFallbackClient.js
        │   │       │   │   │   ├── streamableHttpWithSseFallbackClient.js.map
        │   │       │   │   ├── server/
        │   │       │   │   │   ├── demoInMemoryOAuthProvider.d.ts
        │   │       │   │   │   ├── demoInMemoryOAuthProvider.d.ts.map
        │   │       │   │   │   ├── demoInMemoryOAuthProvider.js
        │   │       │   │   │   ├── demoInMemoryOAuthProvider.js.map
        │   │       │   │   │   ├── elicitationFormExample.d.ts
        │   │       │   │   │   ├── elicitationFormExample.d.ts.map
        │   │       │   │   │   ├── elicitationFormExample.js
        │   │       │   │   │   ├── elicitationFormExample.js.map
        │   │       │   │   │   ├── elicitationUrlExample.d.ts
        │   │       │   │   │   ├── elicitationUrlExample.d.ts.map
        │   │       │   │   │   ├── elicitationUrlExample.js
        │   │       │   │   │   ├── elicitationUrlExample.js.map
        │   │       │   │   │   ├── honoWebStandardStreamableHttp.d.ts
        │   │       │   │   │   ├── honoWebStandardStreamableHttp.d.ts.map
        │   │       │   │   │   ├── honoWebStandardStreamableHttp.js
        │   │       │   │   │   ├── honoWebStandardStreamableHttp.js.map
        │   │       │   │   │   ├── jsonResponseStreamableHttp.d.ts
        │   │       │   │   │   ├── jsonResponseStreamableHttp.d.ts.map
        │   │       │   │   │   ├── jsonResponseStreamableHttp.js
        │   │       │   │   │   ├── jsonResponseStreamableHttp.js.map
        │   │       │   │   │   ├── mcpServerOutputSchema.d.ts
        │   │       │   │   │   ├── mcpServerOutputSchema.d.ts.map
        │   │       │   │   │   ├── mcpServerOutputSchema.js
        │   │       │   │   │   ├── mcpServerOutputSchema.js.map
        │   │       │   │   │   ├── simpleSseServer.d.ts
        │   │       │   │   │   ├── simpleSseServer.d.ts.map
        │   │       │   │   │   ├── simpleSseServer.js
        │   │       │   │   │   ├── simpleSseServer.js.map
        │   │       │   │   │   ├── simpleStatelessStreamableHttp.d.ts
        │   │       │   │   │   ├── simpleStatelessStreamableHttp.d.ts.map
        │   │       │   │   │   ├── simpleStatelessStreamableHttp.js
        │   │       │   │   │   ├── simpleStatelessStreamableHttp.js.map
        │   │       │   │   │   ├── simpleStreamableHttp.d.ts
        │   │       │   │   │   ├── simpleStreamableHttp.d.ts.map
        │   │       │   │   │   ├── simpleStreamableHttp.js
        │   │       │   │   │   ├── simpleStreamableHttp.js.map
        │   │       │   │   │   ├── simpleTaskInteractive.d.ts
        │   │       │   │   │   ├── simpleTaskInteractive.d.ts.map
        │   │       │   │   │   ├── simpleTaskInteractive.js
        │   │       │   │   │   ├── simpleTaskInteractive.js.map
        │   │       │   │   │   ├── sseAndStreamableHttpCompatibleServer.d.ts
        │   │       │   │   │   ├── sseAndStreamableHttpCompatibleServer.d.ts.map
        │   │       │   │   │   ├── sseAndStreamableHttpCompatibleServer.js
        │   │       │   │   │   ├── sseAndStreamableHttpCompatibleServer.js.map
        │   │       │   │   │   ├── ssePollingExample.d.ts
        │   │       │   │   │   ├── ssePollingExample.d.ts.map
        │   │       │   │   │   ├── ssePollingExample.js
        │   │       │   │   │   ├── ssePollingExample.js.map
        │   │       │   │   │   ├── standaloneSseWithGetStreamableHttp.d.ts
        │   │       │   │   │   ├── standaloneSseWithGetStreamableHttp.d.ts.map
        │   │       │   │   │   ├── standaloneSseWithGetStreamableHttp.js
        │   │       │   │   │   ├── standaloneSseWithGetStreamableHttp.js.map
        │   │       │   │   │   ├── toolWithSampleServer.d.ts
        │   │       │   │   │   ├── toolWithSampleServer.d.ts.map
        │   │       │   │   │   ├── toolWithSampleServer.js
        │   │       │   │   │   ├── toolWithSampleServer.js.map
        │   │       │   │   ├── shared/
        │   │       │   │   │   └── inMemoryEventStore.d.ts
        │   │       │   │   │   └── inMemoryEventStore.d.ts.map
        │   │       │   │   │   └── inMemoryEventStore.js
        │   │       │   │   │   └── inMemoryEventStore.js.map
        │   │       │   ├── experimental/
        │   │       │   │   ├── index.d.ts
        │   │       │   │   ├── index.d.ts.map
        │   │       │   │   ├── index.js
        │   │       │   │   ├── index.js.map
        │   │       │   │   ├── tasks/
        │   │       │   │   │   └── client.d.ts
        │   │       │   │   │   └── client.d.ts.map
        │   │       │   │   │   └── client.js
        │   │       │   │   │   └── client.js.map
        │   │       │   │   │   └── helpers.d.ts
        │   │       │   │   │   └── helpers.d.ts.map
        │   │       │   │   │   └── helpers.js
        │   │       │   │   │   └── helpers.js.map
        │   │       │   │   │   └── index.d.ts
        │   │       │   │   │   └── index.d.ts.map
        │   │       │   │   │   └── index.js
        │   │       │   │   │   └── index.js.map
        │   │       │   │   │   └── interfaces.d.ts
        │   │       │   │   │   └── interfaces.d.ts.map
        │   │       │   │   │   └── interfaces.js
        │   │       │   │   │   └── interfaces.js.map
        │   │       │   │   │   └── mcp-server.d.ts
        │   │       │   │   │   └── mcp-server.d.ts.map
        │   │       │   │   │   └── mcp-server.js
        │   │       │   │   │   └── mcp-server.js.map
        │   │       │   │   │   └── server.d.ts
        │   │       │   │   │   └── server.d.ts.map
        │   │       │   │   │   └── server.js
        │   │       │   │   │   └── server.js.map
        │   │       │   │   │   └── stores/
        │   │       │   │   │       ├── in-memory.d.ts
        │   │       │   │   │       ├── in-memory.d.ts.map
        │   │       │   │   │       ├── in-memory.js
        │   │       │   │   │       ├── in-memory.js.map
        │   │       │   │   │   └── types.d.ts
        │   │       │   │   │   └── types.d.ts.map
        │   │       │   │   │   └── types.js
        │   │       │   │   │   └── types.js.map
        │   │       │   ├── inMemory.d.ts
        │   │       │   ├── inMemory.d.ts.map
        │   │       │   ├── inMemory.js
        │   │       │   ├── inMemory.js.map
        │   │       │   ├── package.json
        │   │       │   ├── server/
        │   │       │   │   ├── auth/
        │   │       │   │   │   ├── clients.d.ts
        │   │       │   │   │   ├── clients.d.ts.map
        │   │       │   │   │   ├── clients.js
        │   │       │   │   │   ├── clients.js.map
        │   │       │   │   │   ├── errors.d.ts
        │   │       │   │   │   ├── errors.d.ts.map
        │   │       │   │   │   ├── errors.js
        │   │       │   │   │   ├── errors.js.map
        │   │       │   │   │   ├── handlers/
        │   │       │   │   │   │   ├── authorize.d.ts
        │   │       │   │   │   │   ├── authorize.d.ts.map
        │   │       │   │   │   │   ├── authorize.js
        │   │       │   │   │   │   ├── authorize.js.map
        │   │       │   │   │   │   ├── metadata.d.ts
        │   │       │   │   │   │   ├── metadata.d.ts.map
        │   │       │   │   │   │   ├── metadata.js
        │   │       │   │   │   │   ├── metadata.js.map
        │   │       │   │   │   │   ├── register.d.ts
        │   │       │   │   │   │   ├── register.d.ts.map
        │   │       │   │   │   │   ├── register.js
        │   │       │   │   │   │   ├── register.js.map
        │   │       │   │   │   │   ├── revoke.d.ts
        │   │       │   │   │   │   ├── revoke.d.ts.map
        │   │       │   │   │   │   ├── revoke.js
        │   │       │   │   │   │   ├── revoke.js.map
        │   │       │   │   │   │   ├── token.d.ts
        │   │       │   │   │   │   ├── token.d.ts.map
        │   │       │   │   │   │   ├── token.js
        │   │       │   │   │   │   ├── token.js.map
        │   │       │   │   │   ├── middleware/
        │   │       │   │   │   │   ├── allowedMethods.d.ts
        │   │       │   │   │   │   ├── allowedMethods.d.ts.map
        │   │       │   │   │   │   ├── allowedMethods.js
        │   │       │   │   │   │   ├── allowedMethods.js.map
        │   │       │   │   │   │   ├── bearerAuth.d.ts
        │   │       │   │   │   │   ├── bearerAuth.d.ts.map
        │   │       │   │   │   │   ├── bearerAuth.js
        │   │       │   │   │   │   ├── bearerAuth.js.map
        │   │       │   │   │   │   ├── clientAuth.d.ts
        │   │       │   │   │   │   ├── clientAuth.d.ts.map
        │   │       │   │   │   │   ├── clientAuth.js
        │   │       │   │   │   │   ├── clientAuth.js.map
        │   │       │   │   │   ├── provider.d.ts
        │   │       │   │   │   ├── provider.d.ts.map
        │   │       │   │   │   ├── provider.js
        │   │       │   │   │   ├── provider.js.map
        │   │       │   │   │   ├── providers/
        │   │       │   │   │   │   ├── proxyProvider.d.ts
        │   │       │   │   │   │   ├── proxyProvider.d.ts.map
        │   │       │   │   │   │   ├── proxyProvider.js
        │   │       │   │   │   │   ├── proxyProvider.js.map
        │   │       │   │   │   ├── router.d.ts
        │   │       │   │   │   ├── router.d.ts.map
        │   │       │   │   │   ├── router.js
        │   │       │   │   │   ├── router.js.map
        │   │       │   │   │   ├── types.d.ts
        │   │       │   │   │   ├── types.d.ts.map
        │   │       │   │   │   ├── types.js
        │   │       │   │   │   ├── types.js.map
        │   │       │   │   ├── completable.d.ts
        │   │       │   │   ├── completable.d.ts.map
        │   │       │   │   ├── completable.js
        │   │       │   │   ├── completable.js.map
        │   │       │   │   ├── express.d.ts
        │   │       │   │   ├── express.d.ts.map
        │   │       │   │   ├── express.js
        │   │       │   │   ├── express.js.map
        │   │       │   │   ├── index.d.ts
        │   │       │   │   ├── index.d.ts.map
        │   │       │   │   ├── index.js
        │   │       │   │   ├── index.js.map
        │   │       │   │   ├── mcp.d.ts
        │   │       │   │   ├── mcp.d.ts.map
        │   │       │   │   ├── mcp.js
        │   │       │   │   ├── mcp.js.map
        │   │       │   │   ├── middleware/
        │   │       │   │   │   ├── hostHeaderValidation.d.ts
        │   │       │   │   │   ├── hostHeaderValidation.d.ts.map
        │   │       │   │   │   ├── hostHeaderValidation.js
        │   │       │   │   │   ├── hostHeaderValidation.js.map
        │   │       │   │   ├── sse.d.ts
        │   │       │   │   ├── sse.d.ts.map
        │   │       │   │   ├── sse.js
        │   │       │   │   ├── sse.js.map
        │   │       │   │   ├── stdio.d.ts
        │   │       │   │   ├── stdio.d.ts.map
        │   │       │   │   ├── stdio.js
        │   │       │   │   ├── stdio.js.map
        │   │       │   │   ├── streamableHttp.d.ts
        │   │       │   │   ├── streamableHttp.d.ts.map
        │   │       │   │   ├── streamableHttp.js
        │   │       │   │   ├── streamableHttp.js.map
        │   │       │   │   ├── webStandardStreamableHttp.d.ts
        │   │       │   │   ├── webStandardStreamableHttp.d.ts.map
        │   │       │   │   ├── webStandardStreamableHttp.js
        │   │       │   │   ├── webStandardStreamableHttp.js.map
        │   │       │   │   ├── zod-compat.d.ts
        │   │       │   │   ├── zod-compat.d.ts.map
        │   │       │   │   ├── zod-compat.js
        │   │       │   │   ├── zod-compat.js.map
        │   │       │   │   ├── zod-json-schema-compat.d.ts
        │   │       │   │   ├── zod-json-schema-compat.d.ts.map
        │   │       │   │   ├── zod-json-schema-compat.js
        │   │       │   │   ├── zod-json-schema-compat.js.map
        │   │       │   ├── shared/
        │   │       │   │   ├── auth-utils.d.ts
        │   │       │   │   ├── auth-utils.d.ts.map
        │   │       │   │   ├── auth-utils.js
        │   │       │   │   ├── auth-utils.js.map
        │   │       │   │   ├── auth.d.ts
        │   │       │   │   ├── auth.d.ts.map
        │   │       │   │   ├── auth.js
        │   │       │   │   ├── auth.js.map
        │   │       │   │   ├── metadataUtils.d.ts
        │   │       │   │   ├── metadataUtils.d.ts.map
        │   │       │   │   ├── metadataUtils.js
        │   │       │   │   ├── metadataUtils.js.map
        │   │       │   │   ├── protocol.d.ts
        │   │       │   │   ├── protocol.d.ts.map
        │   │       │   │   ├── protocol.js
        │   │       │   │   ├── protocol.js.map
        │   │       │   │   ├── responseMessage.d.ts
        │   │       │   │   ├── responseMessage.d.ts.map
        │   │       │   │   ├── responseMessage.js
        │   │       │   │   ├── responseMessage.js.map
        │   │       │   │   ├── stdio.d.ts
        │   │       │   │   ├── stdio.d.ts.map
        │   │       │   │   ├── stdio.js
        │   │       │   │   ├── stdio.js.map
        │   │       │   │   ├── toolNameValidation.d.ts
        │   │       │   │   ├── toolNameValidation.d.ts.map
        │   │       │   │   ├── toolNameValidation.js
        │   │       │   │   ├── toolNameValidation.js.map
        │   │       │   │   ├── transport.d.ts
        │   │       │   │   ├── transport.d.ts.map
        │   │       │   │   ├── transport.js
        │   │       │   │   ├── transport.js.map
        │   │       │   │   ├── uriTemplate.d.ts
        │   │       │   │   ├── uriTemplate.d.ts.map
        │   │       │   │   ├── uriTemplate.js
        │   │       │   │   ├── uriTemplate.js.map
        │   │       │   ├── spec.types.d.ts
        │   │       │   ├── spec.types.d.ts.map
        │   │       │   ├── spec.types.js
        │   │       │   ├── spec.types.js.map
        │   │       │   ├── types.d.ts
        │   │       │   ├── types.d.ts.map
        │   │       │   ├── types.js
        │   │       │   ├── types.js.map
        │   │       │   ├── validation/
        │   │       │   │   └── ajv-provider.d.ts
        │   │       │   │   └── ajv-provider.d.ts.map
        │   │       │   │   └── ajv-provider.js
        │   │       │   │   └── ajv-provider.js.map
        │   │       │   │   └── cfworker-provider.d.ts
        │   │       │   │   └── cfworker-provider.d.ts.map
        │   │       │   │   └── cfworker-provider.js
        │   │       │   │   └── cfworker-provider.js.map
        │   │       │   │   └── index.d.ts
        │   │       │   │   └── index.d.ts.map
        │   │       │   │   └── index.js
        │   │       │   │   └── index.js.map
        │   │       │   │   └── types.d.ts
        │   │       │   │   └── types.d.ts.map
        │   │       │   │   └── types.js
        │   │       │   │   └── types.js.map
        │   │       ├── esm/
        │   │       │   └── client/
        │   │       │       ├── auth-extensions.d.ts
        │   │       │       ├── auth-extensions.d.ts.map
        │   │       │       ├── auth-extensions.js
        │   │       │       ├── auth-extensions.js.map
        │   │       │       ├── auth.d.ts
        │   │       │       ├── auth.d.ts.map
        │   │       │       ├── auth.js
        │   │       │       ├── auth.js.map
        │   │       │       ├── index.d.ts
        │   │       │       ├── index.d.ts.map
        │   │       │       ├── index.js
        │   │       │       ├── index.js.map
        │   │       │       ├── middleware.d.ts
        │   │       │       ├── middleware.d.ts.map
        │   │       │       ├── middleware.js
        │   │       │       ├── middleware.js.map
        │   │       │       ├── sse.d.ts
        │   │       │       ├── sse.d.ts.map
        │   │       │       ├── sse.js
        │   │       │       ├── sse.js.map
        │   │       │       ├── stdio.d.ts
        │   │       │       ├── stdio.d.ts.map
        │   │       │       ├── stdio.js
        │   │       │       ├── stdio.js.map
        │   │       │       ├── streamableHttp.d.ts
        │   │       │       ├── streamableHttp.d.ts.map
        │   │       │       ├── streamableHttp.js
        │   │       │       ├── streamableHttp.js.map
        │   │       │       ├── websocket.d.ts
        │   │       │       ├── websocket.d.ts.map
        │   │       │       ├── websocket.js
        │   │       │       ├── websocket.js.map
        │   │       │   └── examples/
        │   │       │       ├── client/
        │   │       │       │   ├── elicitationUrlExample.d.ts
        │   │       │       │   ├── elicitationUrlExample.d.ts.map
        │   │       │       │   ├── elicitationUrlExample.js
        │   │       │       │   ├── elicitationUrlExample.js.map
        │   │       │       │   ├── multipleClientsParallel.d.ts
        │   │       │       │   ├── multipleClientsParallel.d.ts.map
        │   │       │       │   ├── multipleClientsParallel.js
        │   │       │       │   ├── multipleClientsParallel.js.map
        │   │       │       │   ├── parallelToolCallsClient.d.ts
        │   │       │       │   ├── parallelToolCallsClient.d.ts.map
        │   │       │       │   ├── parallelToolCallsClient.js
        │   │       │       │   ├── parallelToolCallsClient.js.map
        │   │       │       │   ├── simpleClientCredentials.d.ts
        │   │       │       │   ├── simpleClientCredentials.d.ts.map
        │   │       │       │   ├── simpleClientCredentials.js
        │   │       │       │   ├── simpleClientCredentials.js.map
        │   │       │       │   ├── simpleOAuthClient.d.ts
        │   │       │       │   ├── simpleOAuthClient.d.ts.map
        │   │       │       │   ├── simpleOAuthClient.js
        │   │       │       │   ├── simpleOAuthClient.js.map
        │   │       │       │   ├── simpleOAuthClientProvider.d.ts
        │   │       │       │   ├── simpleOAuthClientProvider.d.ts.map
        │   │       │       │   ├── simpleOAuthClientProvider.js
        │   │       │       │   ├── simpleOAuthClientProvider.js.map
        │   │       │       │   ├── simpleStreamableHttp.d.ts
        │   │       │       │   ├── simpleStreamableHttp.d.ts.map
        │   │       │       │   ├── simpleStreamableHttp.js
        │   │       │       │   ├── simpleStreamableHttp.js.map
        │   │       │       │   ├── simpleTaskInteractiveClient.d.ts
        │   │       │       │   ├── simpleTaskInteractiveClient.d.ts.map
        │   │       │       │   ├── simpleTaskInteractiveClient.js
        │   │       │       │   ├── simpleTaskInteractiveClient.js.map
        │   │       │       │   ├── ssePollingClient.d.ts
        │   │       │       │   ├── ssePollingClient.d.ts.map
        │   │       │       │   ├── ssePollingClient.js
        │   │       │       │   ├── ssePollingClient.js.map
        │   │       │       │   ├── streamableHttpWithSseFallbackClient.d.ts
        │   │       │       │   ├── streamableHttpWithSseFallbackClient.d.ts.map
        │   │       │       │   ├── streamableHttpWithSseFallbackClient.js
        │   │       │       │   ├── streamableHttpWithSseFallbackClient.js.map
        │   │       │       ├── server/
        │   │       │       │   ├── demoInMemoryOAuthProvider.d.ts
        │   │       │       │   ├── demoInMemoryOAuthProvider.d.ts.map
        │   │       │       │   ├── demoInMemoryOAuthProvider.js
        │   │       │       │   ├── demoInMemoryOAuthProvider.js.map
        │   │       │       │   ├── elicitationFormExample.d.ts
        │   │       │       │   ├── elicitationFormExample.d.ts.map
        │   │       │       │   ├── elicitationFormExample.js
        │   │       │       │   ├── elicitationFormExample.js.map
        │   │       │       │   ├── elicitationUrlExample.d.ts
        │   │       │       │   ├── elicitationUrlExample.d.ts.map
        │   │       │       │   ├── elicitationUrlExample.js
        │   │       │       │   ├── elicitationUrlExample.js.map
        │   │       │       │   ├── honoWebStandardStreamableHttp.d.ts
        │   │       │       │   ├── honoWebStandardStreamableHttp.d.ts.map
        │   │       │       │   ├── honoWebStandardStreamableHttp.js
        │   │       │       │   ├── honoWebStandardStreamableHttp.js.map
        │   │       │       │   ├── jsonResponseStreamableHttp.d.ts
        │   │       │       │   ├── jsonResponseStreamableHttp.d.ts.map
        │   │       │       │   ├── jsonResponseStreamableHttp.js
        │   │       │       │   ├── jsonResponseStreamableHttp.js.map
        │   │       │       │   ├── mcpServerOutputSchema.d.ts
        │   │       │       │   ├── mcpServerOutputSchema.d.ts.map
        │   │       │       │   ├── mcpServerOutputSchema.js
        │   │       │       │   ├── mcpServerOutputSchema.js.map
        │   │       │       │   ├── simpleSseServer.d.ts
        │   │       │       │   ├── simpleSseServer.d.ts.map
        │   │       │       │   ├── simpleSseServer.js
        │   │       │       │   ├── simpleSseServer.js.map
        │   │       │       │   ├── simpleStatelessStreamableHttp.d.ts
        │   │       │       │   ├── simpleStatelessStreamableHttp.d.ts.map
        │   │       │       │   ├── simpleStatelessStreamableHttp.js
        │   │       │       │   ├── simpleStatelessStreamableHttp.js.map
        │   │       │       │   ├── simpleStreamableHttp.d.ts
        │   │       │       │   ├── simpleStreamableHttp.d.ts.map
        │   │       │       │   ├── simpleStreamableHttp.js
        │   │       │       │   ├── simpleStreamableHttp.js.map
        │   │       │       │   ├── simpleTaskInteractive.d.ts
        │   │       │       │   ├── simpleTaskInteractive.d.ts.map
        │   │       │       │   ├── simpleTaskInteractive.js
        │   │       │       │   ├── simpleTaskInteractive.js.map
        │   │       │       │   ├── sseAndStreamableHttpCompatibleServer.d.ts
        │   │       │       │   ├── sseAndStreamableHttpCompatibleServer.d.ts.map
        │   │       │       │   ├── sseAndStreamableHttpCompatibleServer.js
        │   │       │       │   ├── sseAndStreamableHttpCompatibleServer.js.map
        │   │       │       │   ├── ssePollingExample.d.ts
        │   │       │       │   ├── ssePollingExample.d.ts.map
        │   │       │       │   ├── ssePollingExample.js
        │   │       │       │   ├── ssePollingExample.js.map
        │   │       │       │   ├── standaloneSseWithGetStreamableHttp.d.ts
        │   │       │       │   ├── standaloneSseWithGetStreamableHttp.d.ts.map
        │   │       │       │   ├── standaloneSseWithGetStreamableHttp.js
        │   │       │       │   ├── standaloneSseWithGetStreamableHttp.js.map
        │   │       │       │   ├── toolWithSampleServer.d.ts
        │   │       │       │   ├── toolWithSampleServer.d.ts.map
        │   │       │       │   ├── toolWithSampleServer.js
        │   │       │       │   ├── toolWithSampleServer.js.map
        │   │       │       ├── shared/
        │   │       │       │   └── inMemoryEventStore.d.ts
        │   │       │       │   └── inMemoryEventStore.d.ts.map
        │   │       │       │   └── inMemoryEventStore.js
        │   │       │       │   └── inMemoryEventStore.js.map
        │   │       │   └── experimental/
        │   │       │       ├── index.d.ts
        │   │       │       ├── index.d.ts.map
        │   │       │       ├── index.js
        │   │       │       ├── index.js.map
        │   │       │       ├── tasks/
        │   │       │       │   └── client.d.ts
        │   │       │       │   └── client.d.ts.map
        │   │       │       │   └── client.js
        │   │       │       │   └── client.js.map
        │   │       │       │   └── helpers.d.ts
        │   │       │       │   └── helpers.d.ts.map
        │   │       │       │   └── helpers.js
        │   │       │       │   └── helpers.js.map
        │   │       │       │   └── index.d.ts
        │   │       │       │   └── index.d.ts.map
        │   │       │       │   └── index.js
        │   │       │       │   └── index.js.map
        │   │       │       │   └── interfaces.d.ts
        │   │       │       │   └── interfaces.d.ts.map
        │   │       │       │   └── interfaces.js
        │   │       │       │   └── interfaces.js.map
        │   │       │       │   └── mcp-server.d.ts
        │   │       │       │   └── mcp-server.d.ts.map
        │   │       │       │   └── mcp-server.js
        │   │       │       │   └── mcp-server.js.map
        │   │       │       │   └── server.d.ts
        │   │       │       │   └── server.d.ts.map
        │   │       │       │   └── server.js
        │   │       │       │   └── server.js.map
        │   │       │       │   └── stores/
        │   │       │       │       ├── in-memory.d.ts
        │   │       │       │       ├── in-memory.d.ts.map
        │   │       │       │       ├── in-memory.js
        │   │       │       │       ├── in-memory.js.map
        │   │       │       │   └── types.d.ts
        │   │       │       │   └── types.d.ts.map
        │   │       │       │   └── types.js
        │   │       │       │   └── types.js.map
        │   │       │   └── inMemory.d.ts
        │   │       │   └── inMemory.d.ts.map
        │   │       │   └── inMemory.js
        │   │       │   └── inMemory.js.map
        │   │       │   └── package.json
        │   │       │   └── server/
        │   │       │       ├── auth/
        │   │       │       │   ├── clients.d.ts
        │   │       │       │   ├── clients.d.ts.map
        │   │       │       │   ├── clients.js
        │   │       │       │   ├── clients.js.map
        │   │       │       │   ├── errors.d.ts
        │   │       │       │   ├── errors.d.ts.map
        │   │       │       │   ├── errors.js
        │   │       │       │   ├── errors.js.map
        │   │       │       │   ├── handlers/
        │   │       │       │   │   ├── authorize.d.ts
        │   │       │       │   │   ├── authorize.d.ts.map
        │   │       │       │   │   ├── authorize.js
        │   │       │       │   │   ├── authorize.js.map
        │   │       │       │   │   ├── metadata.d.ts
        │   │       │       │   │   ├── metadata.d.ts.map
        │   │       │       │   │   ├── metadata.js
        │   │       │       │   │   ├── metadata.js.map
        │   │       │       │   │   ├── register.d.ts
        │   │       │       │   │   ├── register.d.ts.map
        │   │       │       │   │   ├── register.js
        │   │       │       │   │   ├── register.js.map
        │   │       │       │   │   ├── revoke.d.ts
        │   │       │       │   │   ├── revoke.d.ts.map
        │   │       │       │   │   ├── revoke.js
        │   │       │       │   │   ├── revoke.js.map
        │   │       │       │   │   ├── token.d.ts
        │   │       │       │   │   ├── token.d.ts.map
        │   │       │       │   │   ├── token.js
        │   │       │       │   │   ├── token.js.map
        │   │       │       │   ├── middleware/
        │   │       │       │   │   ├── allowedMethods.d.ts
        │   │       │       │   │   ├── allowedMethods.d.ts.map
        │   │       │       │   │   ├── allowedMethods.js
        │   │       │       │   │   ├── allowedMethods.js.map
        │   │       │       │   │   ├── bearerAuth.d.ts
        │   │       │       │   │   ├── bearerAuth.d.ts.map
        │   │       │       │   │   ├── bearerAuth.js
        │   │       │       │   │   ├── bearerAuth.js.map
        │   │       │       │   │   ├── clientAuth.d.ts
        │   │       │       │   │   ├── clientAuth.d.ts.map
        │   │       │       │   │   ├── clientAuth.js
        │   │       │       │   │   ├── clientAuth.js.map
        │   │       │       │   ├── provider.d.ts
        │   │       │       │   ├── provider.d.ts.map
        │   │       │       │   ├── provider.js
        │   │       │       │   ├── provider.js.map
        │   │       │       │   ├── providers/
        │   │       │       │   │   ├── proxyProvider.d.ts
        │   │       │       │   │   ├── proxyProvider.d.ts.map
        │   │       │       │   │   ├── proxyProvider.js
        │   │       │       │   │   ├── proxyProvider.js.map
        │   │       │       │   ├── router.d.ts
        │   │       │       │   ├── router.d.ts.map
        │   │       │       │   ├── router.js
        │   │       │       │   ├── router.js.map
        │   │       │       │   ├── types.d.ts
        │   │       │       │   ├── types.d.ts.map
        │   │       │       │   ├── types.js
        │   │       │       │   ├── types.js.map
        │   │       │       ├── completable.d.ts
        │   │       │       ├── completable.d.ts.map
        │   │       │       ├── completable.js
        │   │       │       ├── completable.js.map
        │   │       │       ├── express.d.ts
        │   │       │       ├── express.d.ts.map
        │   │       │       ├── express.js
        │   │       │       ├── express.js.map
        │   │       │       ├── index.d.ts
        │   │       │       ├── index.d.ts.map
        │   │       │       ├── index.js
        │   │       │       ├── index.js.map
        │   │       │       ├── mcp.d.ts
        │   │       │       ├── mcp.d.ts.map
        │   │       │       ├── mcp.js
        │   │       │       ├── mcp.js.map
        │   │       │       ├── middleware/
        │   │       │       │   ├── hostHeaderValidation.d.ts
        │   │       │       │   ├── hostHeaderValidation.d.ts.map
        │   │       │       │   ├── hostHeaderValidation.js
        │   │       │       │   ├── hostHeaderValidation.js.map
        │   │       │       ├── sse.d.ts
        │   │       │       ├── sse.d.ts.map
        │   │       │       ├── sse.js
        │   │       │       ├── sse.js.map
        │   │       │       ├── stdio.d.ts
        │   │       │       ├── stdio.d.ts.map
        │   │       │       ├── stdio.js
        │   │       │       ├── stdio.js.map
        │   │       │       ├── streamableHttp.d.ts
        │   │       │       ├── streamableHttp.d.ts.map
        │   │       │       ├── streamableHttp.js
        │   │       │       ├── streamableHttp.js.map
        │   │       │       ├── webStandardStreamableHttp.d.ts
        │   │       │       ├── webStandardStreamableHttp.d.ts.map
        │   │       │       ├── webStandardStreamableHttp.js
        │   │       │       ├── webStandardStreamableHttp.js.map
        │   │       │       ├── zod-compat.d.ts
        │   │       │       ├── zod-compat.d.ts.map
        │   │       │       ├── zod-compat.js
        │   │       │       ├── zod-compat.js.map
        │   │       │       ├── zod-json-schema-compat.d.ts
        │   │       │       ├── zod-json-schema-compat.d.ts.map
        │   │       │       ├── zod-json-schema-compat.js
        │   │       │       ├── zod-json-schema-compat.js.map
        │   │       │   └── shared/
        │   │       │       ├── auth-utils.d.ts
        │   │       │       ├── auth-utils.d.ts.map
        │   │       │       ├── auth-utils.js
        │   │       │       ├── auth-utils.js.map
        │   │       │       ├── auth.d.ts
        │   │       │       ├── auth.d.ts.map
        │   │       │       ├── auth.js
        │   │       │       ├── auth.js.map
        │   │       │       ├── metadataUtils.d.ts
        │   │       │       ├── metadataUtils.d.ts.map
        │   │       │       ├── metadataUtils.js
        │   │       │       ├── metadataUtils.js.map
        │   │       │       ├── protocol.d.ts
        │   │       │       ├── protocol.d.ts.map
        │   │       │       ├── protocol.js
        │   │       │       ├── protocol.js.map
        │   │       │       ├── responseMessage.d.ts
        │   │       │       ├── responseMessage.d.ts.map
        │   │       │       ├── responseMessage.js
        │   │       │       ├── responseMessage.js.map
        │   │       │       ├── stdio.d.ts
        │   │       │       ├── stdio.d.ts.map
        │   │       │       ├── stdio.js
        │   │       │       ├── stdio.js.map
        │   │       │       ├── toolNameValidation.d.ts
        │   │       │       ├── toolNameValidation.d.ts.map
        │   │       │       ├── toolNameValidation.js
        │   │       │       ├── toolNameValidation.js.map
        │   │       │       ├── transport.d.ts
        │   │       │       ├── transport.d.ts.map
        │   │       │       ├── transport.js
        │   │       │       ├── transport.js.map
        │   │       │       ├── uriTemplate.d.ts
        │   │       │       ├── uriTemplate.d.ts.map
        │   │       │       ├── uriTemplate.js
        │   │       │       ├── uriTemplate.js.map
        │   │       │   └── spec.types.d.ts
        │   │       │   └── spec.types.d.ts.map
        │   │       │   └── spec.types.js
        │   │       │   └── spec.types.js.map
        │   │       │   └── types.d.ts
        │   │       │   └── types.d.ts.map
        │   │       │   └── types.js
        │   │       │   └── types.js.map
        │   │       │   └── validation/
        │   │       │       └── ajv-provider.d.ts
        │   │       │       └── ajv-provider.d.ts.map
        │   │       │       └── ajv-provider.js
        │   │       │       └── ajv-provider.js.map
        │   │       │       └── cfworker-provider.d.ts
        │   │       │       └── cfworker-provider.d.ts.map
        │   │       │       └── cfworker-provider.js
        │   │       │       └── cfworker-provider.js.map
        │   │       │       └── index.d.ts
        │   │       │       └── index.d.ts.map
        │   │       │       └── index.js
        │   │       │       └── index.js.map
        │   │       │       └── types.d.ts
        │   │       │       └── types.d.ts.map
        │   │       │       └── types.js
        │   │       │       └── types.js.map
        │   │   └── package.json
        ├── @rollup/
        │   ├── rollup-darwin-x64/
        │   │   └── README.md
        │   │   └── package.json
        │   │   └── rollup.darwin-x64.node
        ├── @standard-schema/
        │   ├── spec/
        │   │   └── LICENSE/
        │   │   └── README.md
        │   │   └── dist/
        │   │       ├── index.cjs
        │   │       ├── index.d.cts
        │   │       ├── index.d.ts
        │   │       ├── index.js
        │   │   └── package.json
        ├── @types/
        │   ├── chai/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── index.d.ts
        │   │   ├── package.json
        │   │   ├── register-should.d.ts
        │   ├── deep-eql/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── index.d.ts
        │   │   ├── package.json
        │   ├── estree/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── flow.d.ts
        │   │   ├── index.d.ts
        │   │   ├── package.json
        │   ├── node/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── assert.d.ts
        │   │   ├── assert/
        │   │   │   ├── strict.d.ts
        │   │   ├── async_hooks.d.ts
        │   │   ├── buffer.buffer.d.ts
        │   │   ├── buffer.d.ts
        │   │   ├── child_process.d.ts
        │   │   ├── cluster.d.ts
        │   │   ├── compatibility/
        │   │   │   ├── disposable.d.ts
        │   │   │   ├── index.d.ts
        │   │   │   ├── indexable.d.ts
        │   │   │   ├── iterators.d.ts
        │   │   ├── console.d.ts
        │   │   ├── constants.d.ts
        │   │   ├── crypto.d.ts
        │   │   ├── dgram.d.ts
        │   │   ├── diagnostics_channel.d.ts
        │   │   ├── dns.d.ts
        │   │   ├── dns/
        │   │   │   ├── promises.d.ts
        │   │   ├── domain.d.ts
        │   │   ├── events.d.ts
        │   │   ├── fs.d.ts
        │   │   ├── fs/
        │   │   │   ├── promises.d.ts
        │   │   ├── globals.d.ts
        │   │   ├── globals.typedarray.d.ts
        │   │   ├── http.d.ts
        │   │   ├── http2.d.ts
        │   │   ├── https.d.ts
        │   │   ├── index.d.ts
        │   │   ├── inspector.d.ts
        │   │   ├── inspector.generated.d.ts
        │   │   ├── module.d.ts
        │   │   ├── net.d.ts
        │   │   ├── os.d.ts
        │   │   ├── package.json
        │   │   ├── path.d.ts
        │   │   ├── perf_hooks.d.ts
        │   │   ├── process.d.ts
        │   │   ├── punycode.d.ts
        │   │   ├── querystring.d.ts
        │   │   ├── readline.d.ts
        │   │   ├── readline/
        │   │   │   ├── promises.d.ts
        │   │   ├── repl.d.ts
        │   │   ├── sea.d.ts
        │   │   ├── sqlite.d.ts
        │   │   ├── stream.d.ts
        │   │   ├── stream/
        │   │   │   ├── consumers.d.ts
        │   │   │   ├── promises.d.ts
        │   │   │   ├── web.d.ts
        │   │   ├── string_decoder.d.ts
        │   │   ├── test.d.ts
        │   │   ├── timers.d.ts
        │   │   ├── timers/
        │   │   │   ├── promises.d.ts
        │   │   ├── tls.d.ts
        │   │   ├── trace_events.d.ts
        │   │   ├── ts5.6/
        │   │   │   ├── buffer.buffer.d.ts
        │   │   │   ├── globals.typedarray.d.ts
        │   │   │   ├── index.d.ts
        │   │   ├── tty.d.ts
        │   │   ├── url.d.ts
        │   │   ├── util.d.ts
        │   │   ├── v8.d.ts
        │   │   ├── vm.d.ts
        │   │   ├── wasi.d.ts
        │   │   ├── web-globals/
        │   │   │   ├── abortcontroller.d.ts
        │   │   │   ├── domexception.d.ts
        │   │   │   ├── events.d.ts
        │   │   │   ├── fetch.d.ts
        │   │   │   ├── navigator.d.ts
        │   │   │   ├── storage.d.ts
        │   │   ├── worker_threads.d.ts
        │   │   ├── zlib.d.ts
        │   ├── proper-lockfile/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── index.d.ts
        │   │   ├── package.json
        │   ├── retry/
        │   │   └── LICENSE/
        │   │   └── README.md
        │   │   └── index.d.ts
        │   │   └── package.json
        ├── @vitest/
        │   ├── expect/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── dist/
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   ├── package.json
        │   ├── mocker/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── dist/
        │   │   │   ├── auto-register.d.ts
        │   │   │   ├── auto-register.js
        │   │   │   ├── automock.d.ts
        │   │   │   ├── automock.js
        │   │   │   ├── browser.d.ts
        │   │   │   ├── browser.js
        │   │   │   ├── chunk-automock.js
        │   │   │   ├── chunk-interceptor-native.js
        │   │   │   ├── chunk-mocker.js
        │   │   │   ├── chunk-pathe.M-eThtNZ.js
        │   │   │   ├── chunk-registry.js
        │   │   │   ├── chunk-utils.js
        │   │   │   ├── index.d-C-sLYZi-.d.ts
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   │   ├── mocker.d-TnKRhz7N.d.ts
        │   │   │   ├── node.d.ts
        │   │   │   ├── node.js
        │   │   │   ├── redirect.d.ts
        │   │   │   ├── redirect.js
        │   │   │   ├── register.d.ts
        │   │   │   ├── register.js
        │   │   │   ├── types.d-B8CCKmHt.d.ts
        │   │   ├── package.json
        │   ├── pretty-format/
        │   │   ├── LICENSE/
        │   │   ├── dist/
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   ├── package.json
        │   ├── runner/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── dist/
        │   │   │   ├── chunk-tasks.js
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   │   ├── tasks.d-C7UxawJ9.d.ts
        │   │   │   ├── types.d.ts
        │   │   │   ├── types.js
        │   │   │   ├── utils.d.ts
        │   │   │   ├── utils.js
        │   │   ├── package.json
        │   │   ├── types.d.ts
        │   │   ├── utils.d.ts
        │   ├── snapshot/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── dist/
        │   │   │   ├── environment.d-DHdQ1Csl.d.ts
        │   │   │   ├── environment.d.ts
        │   │   │   ├── environment.js
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   │   ├── manager.d.ts
        │   │   │   ├── manager.js
        │   │   │   ├── rawSnapshot.d-lFsMJFUd.d.ts
        │   │   ├── environment.d.ts
        │   │   ├── manager.d.ts
        │   │   ├── package.json
        │   ├── spy/
        │   │   ├── LICENSE/
        │   │   ├── README.md
        │   │   ├── dist/
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   ├── package.json
        │   ├── utils/
        │   │   └── LICENSE/
        │   │   └── diff.d.ts
        │   │   └── dist/
        │   │       ├── chunk-_commonjsHelpers.js
        │   │       ├── chunk-pathe.M-eThtNZ.js
        │   │       ├── constants.d.ts
        │   │       ├── constants.js
        │   │       ├── diff.d.ts
        │   │       ├── diff.js
        │   │       ├── display.d.ts
        │   │       ├── display.js
        │   │       ├── error.d.ts
        │   │       ├── error.js
        │   │       ├── helpers.d.ts
        │   │       ├── helpers.js
        │   │       ├── highlight.d.ts
        │   │       ├── highlight.js
        │   │       ├── index.d.ts
        │   │       ├── index.js
        │   │       ├── offset.d.ts
        │   │       ├── offset.js
        │   │       ├── resolver.d.ts
        │   │       ├── resolver.js
        │   │       ├── serialize.d.ts
        │   │       ├── serialize.js
        │   │       ├── source-map.d.ts
        │   │       ├── source-map.js
        │   │       ├── timers.d.ts
        │   │       ├── timers.js
        │   │       ├── types.d-BCElaP-c.d.ts
        │   │       ├── types.d.ts
        │   │       ├── types.js
        │   │   └── error.d.ts
        │   │   └── helpers.d.ts
        │   │   └── package.json
        ├── accepts/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── ajv-formats/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── formats.d.ts
        │   │   ├── formats.js
        │   │   ├── formats.js.map
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── index.js.map
        │   │   ├── limit.d.ts
        │   │   ├── limit.js
        │   │   ├── limit.js.map
        │   ├── package.json
        │   ├── src/
        │   │   └── formats.ts
        │   │   └── index.ts
        │   │   └── limit.ts
        ├── ajv/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── 2019.d.ts
        │   │   ├── 2019.js
        │   │   ├── 2019.js.map
        │   │   ├── 2020.d.ts
        │   │   ├── 2020.js
        │   │   ├── 2020.js.map
        │   │   ├── ajv.d.ts
        │   │   ├── ajv.js
        │   │   ├── ajv.js.map
        │   │   ├── compile/
        │   │   │   ├── codegen/
        │   │   │   │   ├── code.d.ts
        │   │   │   │   ├── code.js
        │   │   │   │   ├── code.js.map
        │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── index.js
        │   │   │   │   ├── index.js.map
        │   │   │   │   ├── scope.d.ts
        │   │   │   │   ├── scope.js
        │   │   │   │   ├── scope.js.map
        │   │   │   ├── errors.d.ts
        │   │   │   ├── errors.js
        │   │   │   ├── errors.js.map
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   │   ├── index.js.map
        │   │   │   ├── jtd/
        │   │   │   │   ├── parse.d.ts
        │   │   │   │   ├── parse.js
        │   │   │   │   ├── parse.js.map
        │   │   │   │   ├── serialize.d.ts
        │   │   │   │   ├── serialize.js
        │   │   │   │   ├── serialize.js.map
        │   │   │   │   ├── types.d.ts
        │   │   │   │   ├── types.js
        │   │   │   │   ├── types.js.map
        │   │   │   ├── names.d.ts
        │   │   │   ├── names.js
        │   │   │   ├── names.js.map
        │   │   │   ├── ref_error.d.ts
        │   │   │   ├── ref_error.js
        │   │   │   ├── ref_error.js.map
        │   │   │   ├── resolve.d.ts
        │   │   │   ├── resolve.js
        │   │   │   ├── resolve.js.map
        │   │   │   ├── rules.d.ts
        │   │   │   ├── rules.js
        │   │   │   ├── rules.js.map
        │   │   │   ├── util.d.ts
        │   │   │   ├── util.js
        │   │   │   ├── util.js.map
        │   │   │   ├── validate/
        │   │   │   │   └── applicability.d.ts
        │   │   │   │   └── applicability.js
        │   │   │   │   └── applicability.js.map
        │   │   │   │   └── boolSchema.d.ts
        │   │   │   │   └── boolSchema.js
        │   │   │   │   └── boolSchema.js.map
        │   │   │   │   └── dataType.d.ts
        │   │   │   │   └── dataType.js
        │   │   │   │   └── dataType.js.map
        │   │   │   │   └── defaults.d.ts
        │   │   │   │   └── defaults.js
        │   │   │   │   └── defaults.js.map
        │   │   │   │   └── index.d.ts
        │   │   │   │   └── index.js
        │   │   │   │   └── index.js.map
        │   │   │   │   └── keyword.d.ts
        │   │   │   │   └── keyword.js
        │   │   │   │   └── keyword.js.map
        │   │   │   │   └── subschema.d.ts
        │   │   │   │   └── subschema.js
        │   │   │   │   └── subschema.js.map
        │   │   ├── core.d.ts
        │   │   ├── core.js
        │   │   ├── core.js.map
        │   │   ├── jtd.d.ts
        │   │   ├── jtd.js
        │   │   ├── jtd.js.map
        │   │   ├── refs/
        │   │   │   ├── data.json
        │   │   │   ├── json-schema-2019-09/
        │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── index.js
        │   │   │   │   ├── index.js.map
        │   │   │   │   ├── meta/
        │   │   │   │   │   ├── applicator.json
        │   │   │   │   │   ├── content.json
        │   │   │   │   │   ├── core.json
        │   │   │   │   │   ├── format.json
        │   │   │   │   │   ├── meta-data.json
        │   │   │   │   │   ├── validation.json
        │   │   │   │   ├── schema.json
        │   │   │   ├── json-schema-2020-12/
        │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── index.js
        │   │   │   │   ├── index.js.map
        │   │   │   │   ├── meta/
        │   │   │   │   │   ├── applicator.json
        │   │   │   │   │   ├── content.json
        │   │   │   │   │   ├── core.json
        │   │   │   │   │   ├── format-annotation.json
        │   │   │   │   │   ├── meta-data.json
        │   │   │   │   │   ├── unevaluated.json
        │   │   │   │   │   ├── validation.json
        │   │   │   │   ├── schema.json
        │   │   │   ├── json-schema-draft-06.json
        │   │   │   ├── json-schema-draft-07.json
        │   │   │   ├── json-schema-secure.json
        │   │   │   ├── jtd-schema.d.ts
        │   │   │   ├── jtd-schema.js
        │   │   │   ├── jtd-schema.js.map
        │   │   ├── runtime/
        │   │   │   ├── equal.d.ts
        │   │   │   ├── equal.js
        │   │   │   ├── equal.js.map
        │   │   │   ├── parseJson.d.ts
        │   │   │   ├── parseJson.js
        │   │   │   ├── parseJson.js.map
        │   │   │   ├── quote.d.ts
        │   │   │   ├── quote.js
        │   │   │   ├── quote.js.map
        │   │   │   ├── re2.d.ts
        │   │   │   ├── re2.js
        │   │   │   ├── re2.js.map
        │   │   │   ├── timestamp.d.ts
        │   │   │   ├── timestamp.js
        │   │   │   ├── timestamp.js.map
        │   │   │   ├── ucs2length.d.ts
        │   │   │   ├── ucs2length.js
        │   │   │   ├── ucs2length.js.map
        │   │   │   ├── uri.d.ts
        │   │   │   ├── uri.js
        │   │   │   ├── uri.js.map
        │   │   │   ├── validation_error.d.ts
        │   │   │   ├── validation_error.js
        │   │   │   ├── validation_error.js.map
        │   │   ├── standalone/
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   │   ├── index.js.map
        │   │   │   ├── instance.d.ts
        │   │   │   ├── instance.js
        │   │   │   ├── instance.js.map
        │   │   ├── types/
        │   │   │   ├── index.d.ts
        │   │   │   ├── index.js
        │   │   │   ├── index.js.map
        │   │   │   ├── json-schema.d.ts
        │   │   │   ├── json-schema.js
        │   │   │   ├── json-schema.js.map
        │   │   │   ├── jtd-schema.d.ts
        │   │   │   ├── jtd-schema.js
        │   │   │   ├── jtd-schema.js.map
        │   │   ├── vocabularies/
        │   │   │   └── applicator/
        │   │   │       ├── additionalItems.d.ts
        │   │   │       ├── additionalItems.js
        │   │   │       ├── additionalItems.js.map
        │   │   │       ├── additionalProperties.d.ts
        │   │   │       ├── additionalProperties.js
        │   │   │       ├── additionalProperties.js.map
        │   │   │       ├── allOf.d.ts
        │   │   │       ├── allOf.js
        │   │   │       ├── allOf.js.map
        │   │   │       ├── anyOf.d.ts
        │   │   │       ├── anyOf.js
        │   │   │       ├── anyOf.js.map
        │   │   │       ├── contains.d.ts
        │   │   │       ├── contains.js
        │   │   │       ├── contains.js.map
        │   │   │       ├── dependencies.d.ts
        │   │   │       ├── dependencies.js
        │   │   │       ├── dependencies.js.map
        │   │   │       ├── dependentSchemas.d.ts
        │   │   │       ├── dependentSchemas.js
        │   │   │       ├── dependentSchemas.js.map
        │   │   │       ├── if.d.ts
        │   │   │       ├── if.js
        │   │   │       ├── if.js.map
        │   │   │       ├── index.d.ts
        │   │   │       ├── index.js
        │   │   │       ├── index.js.map
        │   │   │       ├── items.d.ts
        │   │   │       ├── items.js
        │   │   │       ├── items.js.map
        │   │   │       ├── items2020.d.ts
        │   │   │       ├── items2020.js
        │   │   │       ├── items2020.js.map
        │   │   │       ├── not.d.ts
        │   │   │       ├── not.js
        │   │   │       ├── not.js.map
        │   │   │       ├── oneOf.d.ts
        │   │   │       ├── oneOf.js
        │   │   │       ├── oneOf.js.map
        │   │   │       ├── patternProperties.d.ts
        │   │   │       ├── patternProperties.js
        │   │   │       ├── patternProperties.js.map
        │   │   │       ├── prefixItems.d.ts
        │   │   │       ├── prefixItems.js
        │   │   │       ├── prefixItems.js.map
        │   │   │       ├── properties.d.ts
        │   │   │       ├── properties.js
        │   │   │       ├── properties.js.map
        │   │   │       ├── propertyNames.d.ts
        │   │   │       ├── propertyNames.js
        │   │   │       ├── propertyNames.js.map
        │   │   │       ├── thenElse.d.ts
        │   │   │       ├── thenElse.js
        │   │   │       ├── thenElse.js.map
        │   │   │   └── code.d.ts
        │   │   │   └── code.js
        │   │   │   └── code.js.map
        │   │   │   └── core/
        │   │   │       ├── id.d.ts
        │   │   │       ├── id.js
        │   │   │       ├── id.js.map
        │   │   │       ├── index.d.ts
        │   │   │       ├── index.js
        │   │   │       ├── index.js.map
        │   │   │       ├── ref.d.ts
        │   │   │       ├── ref.js
        │   │   │       ├── ref.js.map
        │   │   │   └── discriminator/
        │   │   │       ├── index.d.ts
        │   │   │       ├── index.js
        │   │   │       ├── index.js.map
        │   │   │       ├── types.d.ts
        │   │   │       ├── types.js
        │   │   │       ├── types.js.map
        │   │   │   └── draft2020.d.ts
        │   │   │   └── draft2020.js
        │   │   │   └── draft2020.js.map
        │   │   │   └── draft7.d.ts
        │   │   │   └── draft7.js
        │   │   │   └── draft7.js.map
        │   │   │   └── dynamic/
        │   │   │       ├── dynamicAnchor.d.ts
        │   │   │       ├── dynamicAnchor.js
        │   │   │       ├── dynamicAnchor.js.map
        │   │   │       ├── dynamicRef.d.ts
        │   │   │       ├── dynamicRef.js
        │   │   │       ├── dynamicRef.js.map
        │   │   │       ├── index.d.ts
        │   │   │       ├── index.js
        │   │   │       ├── index.js.map
        │   │   │       ├── recursiveAnchor.d.ts
        │   │   │       ├── recursiveAnchor.js
        │   │   │       ├── recursiveAnchor.js.map
        │   │   │       ├── recursiveRef.d.ts
        │   │   │       ├── recursiveRef.js
        │   │   │       ├── recursiveRef.js.map
        │   │   │   └── errors.d.ts
        │   │   │   └── errors.js
        │   │   │   └── errors.js.map
        │   │   │   └── format/
        │   │   │       ├── format.d.ts
        │   │   │       ├── format.js
        │   │   │       ├── format.js.map
        │   │   │       ├── index.d.ts
        │   │   │       ├── index.js
        │   │   │       ├── index.js.map
        │   │   │   └── jtd/
        │   │   │       ├── discriminator.d.ts
        │   │   │       ├── discriminator.js
        │   │   │       ├── discriminator.js.map
        │   │   │       ├── elements.d.ts
        │   │   │       ├── elements.js
        │   │   │       ├── elements.js.map
        │   │   │       ├── enum.d.ts
        │   │   │       ├── enum.js
        │   │   │       ├── enum.js.map
        │   │   │       ├── error.d.ts
        │   │   │       ├── error.js
        │   │   │       ├── error.js.map
        │   │   │       ├── index.d.ts
        │   │   │       ├── index.js
        │   │   │       ├── index.js.map
        │   │   │       ├── metadata.d.ts
        │   │   │       ├── metadata.js
        │   │   │       ├── metadata.js.map
        │   │   │       ├── nullable.d.ts
        │   │   │       ├── nullable.js
        │   │   │       ├── nullable.js.map
        │   │   │       ├── optionalProperties.d.ts
        │   │   │       ├── optionalProperties.js
        │   │   │       ├── optionalProperties.js.map
        │   │   │       ├── properties.d.ts
        │   │   │       ├── properties.js
        │   │   │       ├── properties.js.map
        │   │   │       ├── ref.d.ts
        │   │   │       ├── ref.js
        │   │   │       ├── ref.js.map
        │   │   │       ├── type.d.ts
        │   │   │       ├── type.js
        │   │   │       ├── type.js.map
        │   │   │       ├── union.d.ts
        │   │   │       ├── union.js
        │   │   │       ├── union.js.map
        │   │   │       ├── values.d.ts
        │   │   │       ├── values.js
        │   │   │       ├── values.js.map
        │   │   │   └── metadata.d.ts
        │   │   │   └── metadata.js
        │   │   │   └── metadata.js.map
        │   │   │   └── next.d.ts
        │   │   │   └── next.js
        │   │   │   └── next.js.map
        │   │   │   └── unevaluated/
        │   │   │       ├── index.d.ts
        │   │   │       ├── index.js
        │   │   │       ├── index.js.map
        │   │   │       ├── unevaluatedItems.d.ts
        │   │   │       ├── unevaluatedItems.js
        │   │   │       ├── unevaluatedItems.js.map
        │   │   │       ├── unevaluatedProperties.d.ts
        │   │   │       ├── unevaluatedProperties.js
        │   │   │       ├── unevaluatedProperties.js.map
        │   │   │   └── validation/
        │   │   │       └── const.d.ts
        │   │   │       └── const.js
        │   │   │       └── const.js.map
        │   │   │       └── dependentRequired.d.ts
        │   │   │       └── dependentRequired.js
        │   │   │       └── dependentRequired.js.map
        │   │   │       └── enum.d.ts
        │   │   │       └── enum.js
        │   │   │       └── enum.js.map
        │   │   │       └── index.d.ts
        │   │   │       └── index.js
        │   │   │       └── index.js.map
        │   │   │       └── limitContains.d.ts
        │   │   │       └── limitContains.js
        │   │   │       └── limitContains.js.map
        │   │   │       └── limitItems.d.ts
        │   │   │       └── limitItems.js
        │   │   │       └── limitItems.js.map
        │   │   │       └── limitLength.d.ts
        │   │   │       └── limitLength.js
        │   │   │       └── limitLength.js.map
        │   │   │       └── limitNumber.d.ts
        │   │   │       └── limitNumber.js
        │   │   │       └── limitNumber.js.map
        │   │   │       └── limitProperties.d.ts
        │   │   │       └── limitProperties.js
        │   │   │       └── limitProperties.js.map
        │   │   │       └── multipleOf.d.ts
        │   │   │       └── multipleOf.js
        │   │   │       └── multipleOf.js.map
        │   │   │       └── pattern.d.ts
        │   │   │       └── pattern.js
        │   │   │       └── pattern.js.map
        │   │   │       └── required.d.ts
        │   │   │       └── required.js
        │   │   │       └── required.js.map
        │   │   │       └── uniqueItems.d.ts
        │   │   │       └── uniqueItems.js
        │   │   │       └── uniqueItems.js.map
        │   ├── lib/
        │   │   ├── 2019.ts
        │   │   ├── 2020.ts
        │   │   ├── ajv.ts
        │   │   ├── compile/
        │   │   │   ├── codegen/
        │   │   │   │   ├── code.ts
        │   │   │   │   ├── index.ts
        │   │   │   │   ├── scope.ts
        │   │   │   ├── errors.ts
        │   │   │   ├── index.ts
        │   │   │   ├── jtd/
        │   │   │   │   ├── parse.ts
        │   │   │   │   ├── serialize.ts
        │   │   │   │   ├── types.ts
        │   │   │   ├── names.ts
        │   │   │   ├── ref_error.ts
        │   │   │   ├── resolve.ts
        │   │   │   ├── rules.ts
        │   │   │   ├── util.ts
        │   │   │   ├── validate/
        │   │   │   │   └── applicability.ts
        │   │   │   │   └── boolSchema.ts
        │   │   │   │   └── dataType.ts
        │   │   │   │   └── defaults.ts
        │   │   │   │   └── index.ts
        │   │   │   │   └── keyword.ts
        │   │   │   │   └── subschema.ts
        │   │   ├── core.ts
        │   │   ├── jtd.ts
        │   │   ├── refs/
        │   │   │   ├── data.json
        │   │   │   ├── json-schema-2019-09/
        │   │   │   │   ├── index.ts
        │   │   │   │   ├── meta/
        │   │   │   │   │   ├── applicator.json
        │   │   │   │   │   ├── content.json
        │   │   │   │   │   ├── core.json
        │   │   │   │   │   ├── format.json
        │   │   │   │   │   ├── meta-data.json
        │   │   │   │   │   ├── validation.json
        │   │   │   │   ├── schema.json
        │   │   │   ├── json-schema-2020-12/
        │   │   │   │   ├── index.ts
        │   │   │   │   ├── meta/
        │   │   │   │   │   ├── applicator.json
        │   │   │   │   │   ├── content.json
        │   │   │   │   │   ├── core.json
        │   │   │   │   │   ├── format-annotation.json
        │   │   │   │   │   ├── meta-data.json
        │   │   │   │   │   ├── unevaluated.json
        │   │   │   │   │   ├── validation.json
        │   │   │   │   ├── schema.json
        │   │   │   ├── json-schema-draft-06.json
        │   │   │   ├── json-schema-draft-07.json
        │   │   │   ├── json-schema-secure.json
        │   │   │   ├── jtd-schema.ts
        │   │   ├── runtime/
        │   │   │   ├── equal.ts
        │   │   │   ├── parseJson.ts
        │   │   │   ├── quote.ts
        │   │   │   ├── re2.ts
        │   │   │   ├── timestamp.ts
        │   │   │   ├── ucs2length.ts
        │   │   │   ├── uri.ts
        │   │   │   ├── validation_error.ts
        │   │   ├── standalone/
        │   │   │   ├── index.ts
        │   │   │   ├── instance.ts
        │   │   ├── types/
        │   │   │   ├── index.ts
        │   │   │   ├── json-schema.ts
        │   │   │   ├── jtd-schema.ts
        │   │   ├── vocabularies/
        │   │   │   └── applicator/
        │   │   │       ├── additionalItems.ts
        │   │   │       ├── additionalProperties.ts
        │   │   │       ├── allOf.ts
        │   │   │       ├── anyOf.ts
        │   │   │       ├── contains.ts
        │   │   │       ├── dependencies.ts
        │   │   │       ├── dependentSchemas.ts
        │   │   │       ├── if.ts
        │   │   │       ├── index.ts
        │   │   │       ├── items.ts
        │   │   │       ├── items2020.ts
        │   │   │       ├── not.ts
        │   │   │       ├── oneOf.ts
        │   │   │       ├── patternProperties.ts
        │   │   │       ├── prefixItems.ts
        │   │   │       ├── properties.ts
        │   │   │       ├── propertyNames.ts
        │   │   │       ├── thenElse.ts
        │   │   │   └── code.ts
        │   │   │   └── core/
        │   │   │       ├── id.ts
        │   │   │       ├── index.ts
        │   │   │       ├── ref.ts
        │   │   │   └── discriminator/
        │   │   │       ├── index.ts
        │   │   │       ├── types.ts
        │   │   │   └── draft2020.ts
        │   │   │   └── draft7.ts
        │   │   │   └── dynamic/
        │   │   │       ├── dynamicAnchor.ts
        │   │   │       ├── dynamicRef.ts
        │   │   │       ├── index.ts
        │   │   │       ├── recursiveAnchor.ts
        │   │   │       ├── recursiveRef.ts
        │   │   │   └── errors.ts
        │   │   │   └── format/
        │   │   │       ├── format.ts
        │   │   │       ├── index.ts
        │   │   │   └── jtd/
        │   │   │       ├── discriminator.ts
        │   │   │       ├── elements.ts
        │   │   │       ├── enum.ts
        │   │   │       ├── error.ts
        │   │   │       ├── index.ts
        │   │   │       ├── metadata.ts
        │   │   │       ├── nullable.ts
        │   │   │       ├── optionalProperties.ts
        │   │   │       ├── properties.ts
        │   │   │       ├── ref.ts
        │   │   │       ├── type.ts
        │   │   │       ├── union.ts
        │   │   │       ├── values.ts
        │   │   │   └── metadata.ts
        │   │   │   └── next.ts
        │   │   │   └── unevaluated/
        │   │   │       ├── index.ts
        │   │   │       ├── unevaluatedItems.ts
        │   │   │       ├── unevaluatedProperties.ts
        │   │   │   └── validation/
        │   │   │       └── const.ts
        │   │   │       └── dependentRequired.ts
        │   │   │       └── enum.ts
        │   │   │       └── index.ts
        │   │   │       └── limitContains.ts
        │   │   │       └── limitItems.ts
        │   │   │       └── limitLength.ts
        │   │   │       └── limitNumber.ts
        │   │   │       └── limitProperties.ts
        │   │   │       └── multipleOf.ts
        │   │   │       └── pattern.ts
        │   │   │       └── required.ts
        │   │   │       └── uniqueItems.ts
        │   ├── package.json
        ├── assertion-error/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        ├── body-parser/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── lib/
        │   │   ├── read.js
        │   │   ├── types/
        │   │   │   ├── json.js
        │   │   │   ├── raw.js
        │   │   │   ├── text.js
        │   │   │   ├── urlencoded.js
        │   │   ├── utils.js
        │   ├── package.json
        ├── bytes/
        │   ├── History.md
        │   ├── LICENSE/
        │   ├── Readme.md
        │   ├── index.js
        │   ├── package.json
        ├── call-bind-apply-helpers/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── actualApply.d.ts
        │   ├── actualApply.js
        │   ├── applyBind.d.ts
        │   ├── applyBind.js
        │   ├── functionApply.d.ts
        │   ├── functionApply.js
        │   ├── functionCall.d.ts
        │   ├── functionCall.js
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── reflectApply.d.ts
        │   ├── reflectApply.js
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── call-bound/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── chai/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        │   ├── register-assert.js
        │   ├── register-expect.js
        │   ├── register-should.js
        ├── content-disposition/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── content-type/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── cookie-signature/
        │   ├── History.md
        │   ├── LICENSE/
        │   ├── Readme.md
        │   ├── index.js
        │   ├── package.json
        ├── cookie/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── SECURITY.md
        │   ├── index.js
        │   ├── package.json
        ├── cors/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── lib/
        │   │   ├── index.js
        │   ├── package.json
        ├── cross-spawn/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── lib/
        │   │   ├── enoent.js
        │   │   ├── parse.js
        │   │   ├── util/
        │   │   │   └── escape.js
        │   │   │   └── readShebang.js
        │   │   │   └── resolveCommand.js
        │   ├── package.json
        ├── debug/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── package.json
        │   ├── src/
        │   │   └── browser.js
        │   │   └── common.js
        │   │   └── index.js
        │   │   └── node.js
        ├── depd/
        │   ├── History.md
        │   ├── LICENSE/
        │   ├── Readme.md
        │   ├── index.js
        │   ├── lib/
        │   │   ├── browser/
        │   │   │   └── index.js
        │   ├── package.json
        ├── dunder-proto/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── get.d.ts
        │   ├── get.js
        │   ├── package.json
        │   ├── set.d.ts
        │   ├── set.js
        │   ├── test/
        │   │   ├── get.js
        │   │   ├── index.js
        │   │   ├── set.js
        │   ├── tsconfig.json
        ├── ee-first/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── encodeurl/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── es-define-property/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── es-errors/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── eval.d.ts
        │   ├── eval.js
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── range.d.ts
        │   ├── range.js
        │   ├── ref.d.ts
        │   ├── ref.js
        │   ├── syntax.d.ts
        │   ├── syntax.js
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        │   ├── type.d.ts
        │   ├── type.js
        │   ├── uri.d.ts
        │   ├── uri.js
        ├── es-module-lexer/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── lexer.asm.js
        │   │   ├── lexer.cjs
        │   │   ├── lexer.js
        │   ├── lexer.js
        │   ├── package.json
        │   ├── types/
        │   │   └── lexer.d.ts
        ├── es-object-atoms/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── RequireObjectCoercible.d.ts
        │   ├── RequireObjectCoercible.js
        │   ├── ToObject.d.ts
        │   ├── ToObject.js
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── isObject.d.ts
        │   ├── isObject.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── esbuild/
        │   ├── LICENSE.md
        │   ├── README.md
        │   ├── bin/
        │   │   ├── esbuild/
        │   ├── install.js
        │   ├── lib/
        │   │   ├── main.d.ts
        │   │   ├── main.js
        │   ├── package.json
        ├── escape-html/
        │   ├── LICENSE/
        │   ├── Readme.md
        │   ├── index.js
        │   ├── package.json
        ├── estree-walker/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── package.json
        │   ├── src/
        │   │   ├── async.js
        │   │   ├── index.js
        │   │   ├── sync.js
        │   │   ├── walker.js
        │   ├── types/
        │   │   └── async.d.ts
        │   │   └── index.d.ts
        │   │   └── sync.d.ts
        │   │   └── walker.d.ts
        ├── etag/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── eventsource-parser/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.cjs.map
        │   │   ├── index.d.cts
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── index.js.map
        │   │   ├── stream.cjs
        │   │   ├── stream.cjs.map
        │   │   ├── stream.d.cts
        │   │   ├── stream.d.ts
        │   │   ├── stream.js
        │   │   ├── stream.js.map
        │   ├── package.json
        │   ├── src/
        │   │   ├── errors.ts
        │   │   ├── index.ts
        │   │   ├── parse.ts
        │   │   ├── stream.ts
        │   │   ├── types.ts
        │   ├── stream.js
        ├── eventsource/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.cjs.map
        │   │   ├── index.d.cts
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── index.js.map
        │   ├── package.json
        │   ├── src/
        │   │   └── EventSource.ts
        │   │   └── errors.ts
        │   │   └── index.ts
        │   │   └── types.ts
        ├── expect-type/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── SECURITY.md
        │   ├── dist/
        │   │   ├── branding.d.ts
        │   │   ├── branding.js
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── messages.d.ts
        │   │   ├── messages.js
        │   │   ├── overloads.d.ts
        │   │   ├── overloads.js
        │   │   ├── utils.d.ts
        │   │   ├── utils.js
        │   ├── package.json
        ├── express-rate-limit/
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.d.cts
        │   │   ├── index.d.mts
        │   │   ├── index.d.ts
        │   │   ├── index.mjs
        │   ├── license.md
        │   ├── package.json
        │   ├── readme.md
        │   ├── tsconfig.json
        ├── express/
        │   ├── LICENSE/
        │   ├── Readme.md
        │   ├── index.js
        │   ├── lib/
        │   │   ├── application.js
        │   │   ├── express.js
        │   │   ├── request.js
        │   │   ├── response.js
        │   │   ├── utils.js
        │   │   ├── view.js
        │   ├── package.json
        ├── fast-deep-equal/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── es6/
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── react.d.ts
        │   │   ├── react.js
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── react.d.ts
        │   ├── react.js
        ├── fast-uri/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── benchmark/
        │   │   ├── benchmark.mjs
        │   │   ├── equal.mjs
        │   │   ├── non-simple-domain.mjs
        │   │   ├── package.json
        │   │   ├── string-array-to-hex-stripped.mjs
        │   │   ├── ws-is-secure.mjs
        │   ├── eslint.config.js
        │   ├── index.js
        │   ├── lib/
        │   │   ├── schemes.js
        │   │   ├── utils.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── ajv.test.js
        │   │   ├── equal.test.js
        │   │   ├── fixtures/
        │   │   │   ├── uri-js-parse.json
        │   │   │   ├── uri-js-serialize.json
        │   │   ├── parse.test.js
        │   │   ├── resolve.test.js
        │   │   ├── rfc-3986.test.js
        │   │   ├── serialize.test.js
        │   │   ├── uri-js-compatibility.test.js
        │   │   ├── uri-js.test.js
        │   │   ├── util.test.js
        │   ├── tsconfig.json
        │   ├── types/
        │   │   └── index.d.ts
        │   │   └── index.test-d.ts
        ├── fdir/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.d.cts
        │   │   ├── index.d.mts
        │   │   ├── index.mjs
        │   ├── package.json
        ├── finalhandler/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── forwarded/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── fresh/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── fsevents/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── fsevents.d.ts
        │   ├── fsevents.js
        │   ├── fsevents.node
        │   ├── package.json
        ├── function-bind/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── implementation.js
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   └── index.js
        ├── get-intrinsic/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   └── GetIntrinsic.js
        ├── get-proto/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── Object.getPrototypeOf.d.ts
        │   ├── Object.getPrototypeOf.js
        │   ├── README.md
        │   ├── Reflect.getPrototypeOf.d.ts
        │   ├── Reflect.getPrototypeOf.js
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── get-tsconfig/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.d.cts
        │   │   ├── index.d.mts
        │   │   ├── index.mjs
        │   ├── package.json
        ├── gopd/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── gOPD.d.ts
        │   ├── gOPD.js
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── graceful-fs/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── clone.js
        │   ├── graceful-fs.js
        │   ├── legacy-streams.js
        │   ├── package.json
        │   ├── polyfills.js
        ├── has-symbols/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── shams.d.ts
        │   ├── shams.js
        │   ├── test/
        │   │   ├── index.js
        │   │   ├── shams/
        │   │   │   ├── core-js.js
        │   │   │   ├── get-own-property-symbols.js
        │   │   ├── tests.js
        │   ├── tsconfig.json
        ├── hasown/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── tsconfig.json
        ├── hono/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── adapter/
        │   │   │   ├── aws-lambda/
        │   │   │   │   ├── conninfo.js
        │   │   │   │   ├── handler.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── types.js
        │   │   │   ├── bun/
        │   │   │   │   ├── conninfo.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── serve-static.js
        │   │   │   │   ├── server.js
        │   │   │   │   ├── ssg.js
        │   │   │   │   ├── websocket.js
        │   │   │   ├── cloudflare-pages/
        │   │   │   │   ├── conninfo.js
        │   │   │   │   ├── handler.js
        │   │   │   │   ├── index.js
        │   │   │   ├── cloudflare-workers/
        │   │   │   │   ├── conninfo.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── serve-static-module.js
        │   │   │   │   ├── serve-static.js
        │   │   │   │   ├── utils.js
        │   │   │   │   ├── websocket.js
        │   │   │   ├── deno/
        │   │   │   │   ├── conninfo.js
        │   │   │   │   ├── deno.d.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── serve-static.js
        │   │   │   │   ├── ssg.js
        │   │   │   │   ├── websocket.js
        │   │   │   ├── lambda-edge/
        │   │   │   │   ├── conninfo.js
        │   │   │   │   ├── handler.js
        │   │   │   │   ├── index.js
        │   │   │   ├── netlify/
        │   │   │   │   ├── conninfo.js
        │   │   │   │   ├── handler.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── mod.js
        │   │   │   ├── service-worker/
        │   │   │   │   ├── handler.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── types.js
        │   │   │   ├── vercel/
        │   │   │   │   └── conninfo.js
        │   │   │   │   └── handler.js
        │   │   │   │   └── index.js
        │   │   ├── cjs/
        │   │   │   ├── adapter/
        │   │   │   │   ├── aws-lambda/
        │   │   │   │   │   ├── conninfo.js
        │   │   │   │   │   ├── handler.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── types.js
        │   │   │   │   ├── bun/
        │   │   │   │   │   ├── conninfo.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── serve-static.js
        │   │   │   │   │   ├── server.js
        │   │   │   │   │   ├── ssg.js
        │   │   │   │   │   ├── websocket.js
        │   │   │   │   ├── cloudflare-pages/
        │   │   │   │   │   ├── conninfo.js
        │   │   │   │   │   ├── handler.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── cloudflare-workers/
        │   │   │   │   │   ├── conninfo.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── serve-static-module.js
        │   │   │   │   │   ├── serve-static.js
        │   │   │   │   │   ├── utils.js
        │   │   │   │   │   ├── websocket.js
        │   │   │   │   ├── deno/
        │   │   │   │   │   ├── conninfo.js
        │   │   │   │   │   ├── deno.d.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── serve-static.js
        │   │   │   │   │   ├── ssg.js
        │   │   │   │   │   ├── websocket.js
        │   │   │   │   ├── lambda-edge/
        │   │   │   │   │   ├── conninfo.js
        │   │   │   │   │   ├── handler.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── netlify/
        │   │   │   │   │   ├── conninfo.js
        │   │   │   │   │   ├── handler.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── mod.js
        │   │   │   │   ├── service-worker/
        │   │   │   │   │   ├── handler.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── types.js
        │   │   │   │   ├── vercel/
        │   │   │   │   │   └── conninfo.js
        │   │   │   │   │   └── handler.js
        │   │   │   │   │   └── index.js
        │   │   │   ├── client/
        │   │   │   │   ├── client.js
        │   │   │   │   ├── fetch-result-please.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── types.js
        │   │   │   │   ├── utils.js
        │   │   │   ├── compose.js
        │   │   │   ├── context.js
        │   │   │   ├── helper/
        │   │   │   │   ├── accepts/
        │   │   │   │   │   ├── accepts.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── adapter/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── conninfo/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── types.js
        │   │   │   │   ├── cookie/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── css/
        │   │   │   │   │   ├── common.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── dev/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── factory/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── html/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── proxy/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── route/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── ssg/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── middleware.js
        │   │   │   │   │   ├── plugins.js
        │   │   │   │   │   ├── ssg.js
        │   │   │   │   │   ├── utils.js
        │   │   │   │   ├── streaming/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── sse.js
        │   │   │   │   │   ├── stream.js
        │   │   │   │   │   ├── text.js
        │   │   │   │   │   ├── utils.js
        │   │   │   │   ├── testing/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── websocket/
        │   │   │   │   │   └── index.js
        │   │   │   ├── hono-base.js
        │   │   │   ├── hono.js
        │   │   │   ├── http-exception.js
        │   │   │   ├── index.js
        │   │   │   ├── jsx/
        │   │   │   │   ├── base.js
        │   │   │   │   ├── children.js
        │   │   │   │   ├── components.js
        │   │   │   │   ├── constants.js
        │   │   │   │   ├── context.js
        │   │   │   │   ├── dom/
        │   │   │   │   │   ├── client.js
        │   │   │   │   │   ├── components.js
        │   │   │   │   │   ├── context.js
        │   │   │   │   │   ├── css.js
        │   │   │   │   │   ├── hooks/
        │   │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── intrinsic-element/
        │   │   │   │   │   │   ├── components.js
        │   │   │   │   │   ├── jsx-dev-runtime.js
        │   │   │   │   │   ├── jsx-runtime.js
        │   │   │   │   │   ├── render.js
        │   │   │   │   │   ├── server.js
        │   │   │   │   │   ├── utils.js
        │   │   │   │   ├── hooks/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── intrinsic-element/
        │   │   │   │   │   ├── common.js
        │   │   │   │   │   ├── components.js
        │   │   │   │   ├── intrinsic-elements.js
        │   │   │   │   ├── jsx-dev-runtime.js
        │   │   │   │   ├── jsx-runtime.js
        │   │   │   │   ├── streaming.js
        │   │   │   │   ├── types.js
        │   │   │   │   ├── utils.js
        │   │   │   ├── middleware/
        │   │   │   │   ├── basic-auth/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── bearer-auth/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── body-limit/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── cache/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── combine/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── compress/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── context-storage/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── cors/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── csrf/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── etag/
        │   │   │   │   │   ├── digest.js
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── ip-restriction/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── jsx-renderer/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── jwk/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── jwk.js
        │   │   │   │   ├── jwt/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── jwt.js
        │   │   │   │   ├── language/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── language.js
        │   │   │   │   ├── logger/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── method-override/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── powered-by/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── pretty-json/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── request-id/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── request-id.js
        │   │   │   │   ├── secure-headers/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── permissions-policy.js
        │   │   │   │   │   ├── secure-headers.js
        │   │   │   │   ├── serve-static/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── path.js
        │   │   │   │   ├── timeout/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── timing/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── timing.js
        │   │   │   │   ├── trailing-slash/
        │   │   │   │   │   └── index.js
        │   │   │   ├── package.json
        │   │   │   ├── preset/
        │   │   │   │   ├── quick.js
        │   │   │   │   ├── tiny.js
        │   │   │   ├── request.js
        │   │   │   ├── request/
        │   │   │   │   ├── constants.js
        │   │   │   ├── router.js
        │   │   │   ├── router/
        │   │   │   │   ├── linear-router/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── router.js
        │   │   │   │   ├── pattern-router/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── router.js
        │   │   │   │   ├── reg-exp-router/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── matcher.js
        │   │   │   │   │   ├── node.js
        │   │   │   │   │   ├── prepared-router.js
        │   │   │   │   │   ├── router.js
        │   │   │   │   │   ├── trie.js
        │   │   │   │   ├── smart-router/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── router.js
        │   │   │   │   ├── trie-router/
        │   │   │   │   │   └── index.js
        │   │   │   │   │   └── node.js
        │   │   │   │   │   └── router.js
        │   │   │   ├── types.js
        │   │   │   ├── utils/
        │   │   │   │   ├── accept.js
        │   │   │   │   ├── basic-auth.js
        │   │   │   │   ├── body.js
        │   │   │   │   ├── buffer.js
        │   │   │   │   ├── color.js
        │   │   │   │   ├── compress.js
        │   │   │   │   ├── concurrent.js
        │   │   │   │   ├── constants.js
        │   │   │   │   ├── cookie.js
        │   │   │   │   ├── crypto.js
        │   │   │   │   ├── encode.js
        │   │   │   │   ├── filepath.js
        │   │   │   │   ├── handler.js
        │   │   │   │   ├── headers.js
        │   │   │   │   ├── html.js
        │   │   │   │   ├── http-status.js
        │   │   │   │   ├── ipaddr.js
        │   │   │   │   ├── jwt/
        │   │   │   │   │   ├── index.js
        │   │   │   │   │   ├── jwa.js
        │   │   │   │   │   ├── jws.js
        │   │   │   │   │   ├── jwt.js
        │   │   │   │   │   ├── types.js
        │   │   │   │   │   ├── utf8.js
        │   │   │   │   ├── mime.js
        │   │   │   │   ├── stream.js
        │   │   │   │   ├── types.js
        │   │   │   │   ├── url.js
        │   │   │   ├── validator/
        │   │   │   │   └── index.js
        │   │   │   │   └── utils.js
        │   │   │   │   └── validator.js
        │   │   ├── client/
        │   │   │   ├── client.js
        │   │   │   ├── fetch-result-please.js
        │   │   │   ├── index.js
        │   │   │   ├── types.js
        │   │   │   ├── utils.js
        │   │   ├── compose.js
        │   │   ├── context.js
        │   │   ├── helper/
        │   │   │   ├── accepts/
        │   │   │   │   ├── accepts.js
        │   │   │   │   ├── index.js
        │   │   │   ├── adapter/
        │   │   │   │   ├── index.js
        │   │   │   ├── conninfo/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── types.js
        │   │   │   ├── cookie/
        │   │   │   │   ├── index.js
        │   │   │   ├── css/
        │   │   │   │   ├── common.js
        │   │   │   │   ├── index.js
        │   │   │   ├── dev/
        │   │   │   │   ├── index.js
        │   │   │   ├── factory/
        │   │   │   │   ├── index.js
        │   │   │   ├── html/
        │   │   │   │   ├── index.js
        │   │   │   ├── proxy/
        │   │   │   │   ├── index.js
        │   │   │   ├── route/
        │   │   │   │   ├── index.js
        │   │   │   ├── ssg/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── middleware.js
        │   │   │   │   ├── plugins.js
        │   │   │   │   ├── ssg.js
        │   │   │   │   ├── utils.js
        │   │   │   ├── streaming/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── sse.js
        │   │   │   │   ├── stream.js
        │   │   │   │   ├── text.js
        │   │   │   │   ├── utils.js
        │   │   │   ├── testing/
        │   │   │   │   ├── index.js
        │   │   │   ├── websocket/
        │   │   │   │   └── index.js
        │   │   ├── hono-base.js
        │   │   ├── hono.js
        │   │   ├── http-exception.js
        │   │   ├── index.js
        │   │   ├── jsx/
        │   │   │   ├── base.js
        │   │   │   ├── children.js
        │   │   │   ├── components.js
        │   │   │   ├── constants.js
        │   │   │   ├── context.js
        │   │   │   ├── dom/
        │   │   │   │   ├── client.js
        │   │   │   │   ├── components.js
        │   │   │   │   ├── context.js
        │   │   │   │   ├── css.js
        │   │   │   │   ├── hooks/
        │   │   │   │   │   ├── index.js
        │   │   │   │   ├── index.js
        │   │   │   │   ├── intrinsic-element/
        │   │   │   │   │   ├── components.js
        │   │   │   │   ├── jsx-dev-runtime.js
        │   │   │   │   ├── jsx-runtime.js
        │   │   │   │   ├── render.js
        │   │   │   │   ├── server.js
        │   │   │   │   ├── utils.js
        │   │   │   ├── hooks/
        │   │   │   │   ├── index.js
        │   │   │   ├── index.js
        │   │   │   ├── intrinsic-element/
        │   │   │   │   ├── common.js
        │   │   │   │   ├── components.js
        │   │   │   ├── intrinsic-elements.js
        │   │   │   ├── jsx-dev-runtime.js
        │   │   │   ├── jsx-runtime.js
        │   │   │   ├── streaming.js
        │   │   │   ├── types.js
        │   │   │   ├── utils.js
        │   │   ├── middleware/
        │   │   │   ├── basic-auth/
        │   │   │   │   ├── index.js
        │   │   │   ├── bearer-auth/
        │   │   │   │   ├── index.js
        │   │   │   ├── body-limit/
        │   │   │   │   ├── index.js
        │   │   │   ├── cache/
        │   │   │   │   ├── index.js
        │   │   │   ├── combine/
        │   │   │   │   ├── index.js
        │   │   │   ├── compress/
        │   │   │   │   ├── index.js
        │   │   │   ├── context-storage/
        │   │   │   │   ├── index.js
        │   │   │   ├── cors/
        │   │   │   │   ├── index.js
        │   │   │   ├── csrf/
        │   │   │   │   ├── index.js
        │   │   │   ├── etag/
        │   │   │   │   ├── digest.js
        │   │   │   │   ├── index.js
        │   │   │   ├── ip-restriction/
        │   │   │   │   ├── index.js
        │   │   │   ├── jsx-renderer/
        │   │   │   │   ├── index.js
        │   │   │   ├── jwk/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── jwk.js
        │   │   │   ├── jwt/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── jwt.js
        │   │   │   ├── language/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── language.js
        │   │   │   ├── logger/
        │   │   │   │   ├── index.js
        │   │   │   ├── method-override/
        │   │   │   │   ├── index.js
        │   │   │   ├── powered-by/
        │   │   │   │   ├── index.js
        │   │   │   ├── pretty-json/
        │   │   │   │   ├── index.js
        │   │   │   ├── request-id/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── request-id.js
        │   │   │   ├── secure-headers/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── permissions-policy.js
        │   │   │   │   ├── secure-headers.js
        │   │   │   ├── serve-static/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── path.js
        │   │   │   ├── timeout/
        │   │   │   │   ├── index.js
        │   │   │   ├── timing/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── timing.js
        │   │   │   ├── trailing-slash/
        │   │   │   │   └── index.js
        │   │   ├── preset/
        │   │   │   ├── quick.js
        │   │   │   ├── tiny.js
        │   │   ├── request.js
        │   │   ├── request/
        │   │   │   ├── constants.js
        │   │   ├── router.js
        │   │   ├── router/
        │   │   │   ├── linear-router/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── router.js
        │   │   │   ├── pattern-router/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── router.js
        │   │   │   ├── reg-exp-router/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── matcher.js
        │   │   │   │   ├── node.js
        │   │   │   │   ├── prepared-router.js
        │   │   │   │   ├── router.js
        │   │   │   │   ├── trie.js
        │   │   │   ├── smart-router/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── router.js
        │   │   │   ├── trie-router/
        │   │   │   │   └── index.js
        │   │   │   │   └── node.js
        │   │   │   │   └── router.js
        │   │   ├── types.js
        │   │   ├── types/
        │   │   │   ├── adapter/
        │   │   │   │   ├── aws-lambda/
        │   │   │   │   │   ├── conninfo.d.ts
        │   │   │   │   │   ├── handler.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── types.d.ts
        │   │   │   │   ├── bun/
        │   │   │   │   │   ├── conninfo.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── serve-static.d.ts
        │   │   │   │   │   ├── server.d.ts
        │   │   │   │   │   ├── ssg.d.ts
        │   │   │   │   │   ├── websocket.d.ts
        │   │   │   │   ├── cloudflare-pages/
        │   │   │   │   │   ├── conninfo.d.ts
        │   │   │   │   │   ├── handler.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── cloudflare-workers/
        │   │   │   │   │   ├── conninfo.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── serve-static-module.d.ts
        │   │   │   │   │   ├── serve-static.d.ts
        │   │   │   │   │   ├── utils.d.ts
        │   │   │   │   │   ├── websocket.d.ts
        │   │   │   │   ├── deno/
        │   │   │   │   │   ├── conninfo.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── serve-static.d.ts
        │   │   │   │   │   ├── ssg.d.ts
        │   │   │   │   │   ├── websocket.d.ts
        │   │   │   │   ├── lambda-edge/
        │   │   │   │   │   ├── conninfo.d.ts
        │   │   │   │   │   ├── handler.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── netlify/
        │   │   │   │   │   ├── conninfo.d.ts
        │   │   │   │   │   ├── handler.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── mod.d.ts
        │   │   │   │   ├── service-worker/
        │   │   │   │   │   ├── handler.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── types.d.ts
        │   │   │   │   ├── vercel/
        │   │   │   │   │   └── conninfo.d.ts
        │   │   │   │   │   └── handler.d.ts
        │   │   │   │   │   └── index.d.ts
        │   │   │   ├── client/
        │   │   │   │   ├── client.d.ts
        │   │   │   │   ├── fetch-result-please.d.ts
        │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── types.d.ts
        │   │   │   │   ├── utils.d.ts
        │   │   │   ├── compose.d.ts
        │   │   │   ├── context.d.ts
        │   │   │   ├── helper/
        │   │   │   │   ├── accepts/
        │   │   │   │   │   ├── accepts.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── adapter/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── conninfo/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── types.d.ts
        │   │   │   │   ├── cookie/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── css/
        │   │   │   │   │   ├── common.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── dev/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── factory/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── html/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── proxy/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── route/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── ssg/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── middleware.d.ts
        │   │   │   │   │   ├── plugins.d.ts
        │   │   │   │   │   ├── ssg.d.ts
        │   │   │   │   │   ├── utils.d.ts
        │   │   │   │   ├── streaming/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── sse.d.ts
        │   │   │   │   │   ├── stream.d.ts
        │   │   │   │   │   ├── text.d.ts
        │   │   │   │   │   ├── utils.d.ts
        │   │   │   │   ├── testing/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── websocket/
        │   │   │   │   │   └── index.d.ts
        │   │   │   ├── hono-base.d.ts
        │   │   │   ├── hono.d.ts
        │   │   │   ├── http-exception.d.ts
        │   │   │   ├── index.d.ts
        │   │   │   ├── jsx/
        │   │   │   │   ├── base.d.ts
        │   │   │   │   ├── children.d.ts
        │   │   │   │   ├── components.d.ts
        │   │   │   │   ├── constants.d.ts
        │   │   │   │   ├── context.d.ts
        │   │   │   │   ├── dom/
        │   │   │   │   │   ├── client.d.ts
        │   │   │   │   │   ├── components.d.ts
        │   │   │   │   │   ├── context.d.ts
        │   │   │   │   │   ├── css.d.ts
        │   │   │   │   │   ├── hooks/
        │   │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── intrinsic-element/
        │   │   │   │   │   │   ├── components.d.ts
        │   │   │   │   │   ├── jsx-dev-runtime.d.ts
        │   │   │   │   │   ├── jsx-runtime.d.ts
        │   │   │   │   │   ├── render.d.ts
        │   │   │   │   │   ├── server.d.ts
        │   │   │   │   │   ├── utils.d.ts
        │   │   │   │   ├── hooks/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── intrinsic-element/
        │   │   │   │   │   ├── common.d.ts
        │   │   │   │   │   ├── components.d.ts
        │   │   │   │   ├── intrinsic-elements.d.ts
        │   │   │   │   ├── jsx-dev-runtime.d.ts
        │   │   │   │   ├── jsx-runtime.d.ts
        │   │   │   │   ├── streaming.d.ts
        │   │   │   │   ├── types.d.ts
        │   │   │   │   ├── utils.d.ts
        │   │   │   ├── middleware/
        │   │   │   │   ├── basic-auth/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── bearer-auth/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── body-limit/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── cache/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── combine/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── compress/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── context-storage/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── cors/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── csrf/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── etag/
        │   │   │   │   │   ├── digest.d.ts
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── ip-restriction/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── jsx-renderer/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── jwk/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── jwk.d.ts
        │   │   │   │   ├── jwt/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── jwt.d.ts
        │   │   │   │   ├── language/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── language.d.ts
        │   │   │   │   ├── logger/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── method-override/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── powered-by/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── pretty-json/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── request-id/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── request-id.d.ts
        │   │   │   │   ├── secure-headers/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── permissions-policy.d.ts
        │   │   │   │   │   ├── secure-headers.d.ts
        │   │   │   │   ├── serve-static/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── path.d.ts
        │   │   │   │   ├── timeout/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   ├── timing/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── timing.d.ts
        │   │   │   │   ├── trailing-slash/
        │   │   │   │   │   └── index.d.ts
        │   │   │   ├── package.json
        │   │   │   ├── preset/
        │   │   │   │   ├── quick.d.ts
        │   │   │   │   ├── tiny.d.ts
        │   │   │   ├── request.d.ts
        │   │   │   ├── request/
        │   │   │   │   ├── constants.d.ts
        │   │   │   ├── router.d.ts
        │   │   │   ├── router/
        │   │   │   │   ├── linear-router/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── router.d.ts
        │   │   │   │   ├── pattern-router/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── router.d.ts
        │   │   │   │   ├── reg-exp-router/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── matcher.d.ts
        │   │   │   │   │   ├── node.d.ts
        │   │   │   │   │   ├── prepared-router.d.ts
        │   │   │   │   │   ├── router.d.ts
        │   │   │   │   │   ├── trie.d.ts
        │   │   │   │   ├── smart-router/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── router.d.ts
        │   │   │   │   ├── trie-router/
        │   │   │   │   │   └── index.d.ts
        │   │   │   │   │   └── node.d.ts
        │   │   │   │   │   └── router.d.ts
        │   │   │   ├── types.d.ts
        │   │   │   ├── utils/
        │   │   │   │   ├── accept.d.ts
        │   │   │   │   ├── basic-auth.d.ts
        │   │   │   │   ├── body.d.ts
        │   │   │   │   ├── buffer.d.ts
        │   │   │   │   ├── color.d.ts
        │   │   │   │   ├── compress.d.ts
        │   │   │   │   ├── concurrent.d.ts
        │   │   │   │   ├── constants.d.ts
        │   │   │   │   ├── cookie.d.ts
        │   │   │   │   ├── crypto.d.ts
        │   │   │   │   ├── encode.d.ts
        │   │   │   │   ├── filepath.d.ts
        │   │   │   │   ├── handler.d.ts
        │   │   │   │   ├── headers.d.ts
        │   │   │   │   ├── html.d.ts
        │   │   │   │   ├── http-status.d.ts
        │   │   │   │   ├── ipaddr.d.ts
        │   │   │   │   ├── jwt/
        │   │   │   │   │   ├── index.d.ts
        │   │   │   │   │   ├── jwa.d.ts
        │   │   │   │   │   ├── jws.d.ts
        │   │   │   │   │   ├── jwt.d.ts
        │   │   │   │   │   ├── types.d.ts
        │   │   │   │   │   ├── utf8.d.ts
        │   │   │   │   ├── mime.d.ts
        │   │   │   │   ├── stream.d.ts
        │   │   │   │   ├── types.d.ts
        │   │   │   │   ├── url.d.ts
        │   │   │   ├── validator/
        │   │   │   │   └── index.d.ts
        │   │   │   │   └── utils.d.ts
        │   │   │   │   └── validator.d.ts
        │   │   ├── utils/
        │   │   │   ├── accept.js
        │   │   │   ├── basic-auth.js
        │   │   │   ├── body.js
        │   │   │   ├── buffer.js
        │   │   │   ├── color.js
        │   │   │   ├── compress.js
        │   │   │   ├── concurrent.js
        │   │   │   ├── constants.js
        │   │   │   ├── cookie.js
        │   │   │   ├── crypto.js
        │   │   │   ├── encode.js
        │   │   │   ├── filepath.js
        │   │   │   ├── handler.js
        │   │   │   ├── headers.js
        │   │   │   ├── html.js
        │   │   │   ├── http-status.js
        │   │   │   ├── ipaddr.js
        │   │   │   ├── jwt/
        │   │   │   │   ├── index.js
        │   │   │   │   ├── jwa.js
        │   │   │   │   ├── jws.js
        │   │   │   │   ├── jwt.js
        │   │   │   │   ├── types.js
        │   │   │   │   ├── utf8.js
        │   │   │   ├── mime.js
        │   │   │   ├── stream.js
        │   │   │   ├── types.js
        │   │   │   ├── url.js
        │   │   ├── validator/
        │   │   │   └── index.js
        │   │   │   └── utils.js
        │   │   │   └── validator.js
        │   ├── package.json
        ├── http-errors/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── iconv-lite/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── encodings/
        │   │   ├── dbcs-codec.js
        │   │   ├── dbcs-data.js
        │   │   ├── index.js
        │   │   ├── internal.js
        │   │   ├── sbcs-codec.js
        │   │   ├── sbcs-data-generated.js
        │   │   ├── sbcs-data.js
        │   │   ├── tables/
        │   │   │   ├── big5-added.json
        │   │   │   ├── cp936.json
        │   │   │   ├── cp949.json
        │   │   │   ├── cp950.json
        │   │   │   ├── eucjp.json
        │   │   │   ├── gb18030-ranges.json
        │   │   │   ├── gbk-added.json
        │   │   │   ├── shiftjis.json
        │   │   ├── utf16.js
        │   │   ├── utf32.js
        │   │   ├── utf7.js
        │   ├── lib/
        │   │   ├── bom-handling.js
        │   │   ├── helpers/
        │   │   │   ├── merge-exports.js
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── streams.js
        │   ├── package.json
        │   ├── types/
        │   │   └── encodings.d.ts
        ├── inherits/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── inherits.js
        │   ├── inherits_browser.js
        │   ├── package.json
        ├── ip-address/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── address-error.d.ts
        │   │   ├── address-error.d.ts.map
        │   │   ├── address-error.js
        │   │   ├── address-error.js.map
        │   │   ├── common.d.ts
        │   │   ├── common.d.ts.map
        │   │   ├── common.js
        │   │   ├── common.js.map
        │   │   ├── ip-address.d.ts
        │   │   ├── ip-address.d.ts.map
        │   │   ├── ip-address.js
        │   │   ├── ip-address.js.map
        │   │   ├── ipv4.d.ts
        │   │   ├── ipv4.d.ts.map
        │   │   ├── ipv4.js
        │   │   ├── ipv4.js.map
        │   │   ├── ipv6.d.ts
        │   │   ├── ipv6.d.ts.map
        │   │   ├── ipv6.js
        │   │   ├── ipv6.js.map
        │   │   ├── v4/
        │   │   │   ├── constants.d.ts
        │   │   │   ├── constants.d.ts.map
        │   │   │   ├── constants.js
        │   │   │   ├── constants.js.map
        │   │   ├── v6/
        │   │   │   └── constants.d.ts
        │   │   │   └── constants.d.ts.map
        │   │   │   └── constants.js
        │   │   │   └── constants.js.map
        │   │   │   └── helpers.d.ts
        │   │   │   └── helpers.d.ts.map
        │   │   │   └── helpers.js
        │   │   │   └── helpers.js.map
        │   │   │   └── regular-expressions.d.ts
        │   │   │   └── regular-expressions.d.ts.map
        │   │   │   └── regular-expressions.js
        │   │   │   └── regular-expressions.js.map
        │   ├── package.json
        │   ├── src/
        │   │   └── address-error.ts
        │   │   └── common.ts
        │   │   └── ip-address.ts
        │   │   └── ipv4.ts
        │   │   └── ipv6.ts
        │   │   └── v4/
        │   │       ├── constants.ts
        │   │   └── v6/
        │   │       └── constants.ts
        │   │       └── helpers.ts
        │   │       └── regular-expressions.ts
        ├── ipaddr.js/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── ipaddr.min.js
        │   ├── lib/
        │   │   ├── ipaddr.js
        │   │   ├── ipaddr.js.d.ts
        │   ├── package.json
        ├── is-promise/
        │   ├── LICENSE/
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── index.mjs
        │   ├── package.json
        │   ├── readme.md
        ├── isexe/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── mode.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── basic.js
        │   ├── windows.js
        ├── jose/
        │   ├── LICENSE.md
        │   ├── README.md
        │   ├── dist/
        │   │   ├── types/
        │   │   │   ├── index.d.ts
        │   │   │   ├── jwe/
        │   │   │   │   ├── compact/
        │   │   │   │   │   ├── decrypt.d.ts
        │   │   │   │   │   ├── encrypt.d.ts
        │   │   │   │   ├── flattened/
        │   │   │   │   │   ├── decrypt.d.ts
        │   │   │   │   │   ├── encrypt.d.ts
        │   │   │   │   ├── general/
        │   │   │   │   │   └── decrypt.d.ts
        │   │   │   │   │   └── encrypt.d.ts
        │   │   │   ├── jwk/
        │   │   │   │   ├── embedded.d.ts
        │   │   │   │   ├── thumbprint.d.ts
        │   │   │   ├── jwks/
        │   │   │   │   ├── local.d.ts
        │   │   │   │   ├── remote.d.ts
        │   │   │   ├── jws/
        │   │   │   │   ├── compact/
        │   │   │   │   │   ├── sign.d.ts
        │   │   │   │   │   ├── verify.d.ts
        │   │   │   │   ├── flattened/
        │   │   │   │   │   ├── sign.d.ts
        │   │   │   │   │   ├── verify.d.ts
        │   │   │   │   ├── general/
        │   │   │   │   │   └── sign.d.ts
        │   │   │   │   │   └── verify.d.ts
        │   │   │   ├── jwt/
        │   │   │   │   ├── decrypt.d.ts
        │   │   │   │   ├── encrypt.d.ts
        │   │   │   │   ├── sign.d.ts
        │   │   │   │   ├── unsecured.d.ts
        │   │   │   │   ├── verify.d.ts
        │   │   │   ├── key/
        │   │   │   │   ├── export.d.ts
        │   │   │   │   ├── generate_key_pair.d.ts
        │   │   │   │   ├── generate_secret.d.ts
        │   │   │   │   ├── import.d.ts
        │   │   │   ├── types.d.ts
        │   │   │   ├── util/
        │   │   │   │   └── base64url.d.ts
        │   │   │   │   └── decode_jwt.d.ts
        │   │   │   │   └── decode_protected_header.d.ts
        │   │   │   │   └── errors.d.ts
        │   │   ├── webapi/
        │   │   │   └── index.js
        │   │   │   └── jwe/
        │   │   │       ├── compact/
        │   │   │       │   ├── decrypt.js
        │   │   │       │   ├── encrypt.js
        │   │   │       ├── flattened/
        │   │   │       │   ├── decrypt.js
        │   │   │       │   ├── encrypt.js
        │   │   │       ├── general/
        │   │   │       │   └── decrypt.js
        │   │   │       │   └── encrypt.js
        │   │   │   └── jwk/
        │   │   │       ├── embedded.js
        │   │   │       ├── thumbprint.js
        │   │   │   └── jwks/
        │   │   │       ├── local.js
        │   │   │       ├── remote.js
        │   │   │   └── jws/
        │   │   │       ├── compact/
        │   │   │       │   ├── sign.js
        │   │   │       │   ├── verify.js
        │   │   │       ├── flattened/
        │   │   │       │   ├── sign.js
        │   │   │       │   ├── verify.js
        │   │   │       ├── general/
        │   │   │       │   └── sign.js
        │   │   │       │   └── verify.js
        │   │   │   └── jwt/
        │   │   │       ├── decrypt.js
        │   │   │       ├── encrypt.js
        │   │   │       ├── sign.js
        │   │   │       ├── unsecured.js
        │   │   │       ├── verify.js
        │   │   │   └── key/
        │   │   │       ├── export.js
        │   │   │       ├── generate_key_pair.js
        │   │   │       ├── generate_secret.js
        │   │   │       ├── import.js
        │   │   │   └── lib/
        │   │   │       ├── aesgcmkw.js
        │   │   │       ├── aeskw.js
        │   │   │       ├── asn1.js
        │   │   │       ├── base64.js
        │   │   │       ├── buffer_utils.js
        │   │   │       ├── cek.js
        │   │   │       ├── check_cek_length.js
        │   │   │       ├── check_iv_length.js
        │   │   │       ├── check_key_length.js
        │   │   │       ├── check_key_type.js
        │   │   │       ├── crypto_key.js
        │   │   │       ├── decrypt.js
        │   │   │       ├── decrypt_key_management.js
        │   │   │       ├── digest.js
        │   │   │       ├── ecdhes.js
        │   │   │       ├── encrypt.js
        │   │   │       ├── encrypt_key_management.js
        │   │   │       ├── get_sign_verify_key.js
        │   │   │       ├── invalid_key_input.js
        │   │   │       ├── is_disjoint.js
        │   │   │       ├── is_jwk.js
        │   │   │       ├── is_key_like.js
        │   │   │       ├── is_object.js
        │   │   │       ├── iv.js
        │   │   │       ├── jwk_to_key.js
        │   │   │       ├── jwt_claims_set.js
        │   │   │       ├── key_to_jwk.js
        │   │   │       ├── normalize_key.js
        │   │   │       ├── pbes2kw.js
        │   │   │       ├── private_symbols.js
        │   │   │       ├── rsaes.js
        │   │   │       ├── sign.js
        │   │   │       ├── subtle_dsa.js
        │   │   │       ├── validate_algorithms.js
        │   │   │       ├── validate_crit.js
        │   │   │       ├── verify.js
        │   │   │   └── util/
        │   │   │       └── base64url.js
        │   │   │       └── decode_jwt.js
        │   │   │       └── decode_protected_header.js
        │   │   │       └── errors.js
        │   ├── package.json
        ├── json-schema-traverse/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── spec/
        │   │   └── fixtures/
        │   │       ├── schema.js
        │   │   └── index.spec.js
        ├── json-schema-typed/
        │   ├── LICENSE.md
        │   ├── README.md
        │   ├── draft_07.d.ts
        │   ├── draft_07.js
        │   ├── draft_2019_09.d.ts
        │   ├── draft_2019_09.js
        │   ├── draft_2020_12.d.ts
        │   ├── draft_2020_12.js
        │   ├── package.json
        ├── magic-string/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── magic-string.cjs.d.ts
        │   │   ├── magic-string.cjs.js
        │   │   ├── magic-string.cjs.js.map
        │   │   ├── magic-string.es.d.mts
        │   │   ├── magic-string.es.mjs
        │   │   ├── magic-string.es.mjs.map
        │   │   ├── magic-string.umd.js
        │   │   ├── magic-string.umd.js.map
        │   ├── package.json
        ├── math-intrinsics/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── abs.d.ts
        │   ├── abs.js
        │   ├── constants/
        │   │   ├── maxArrayLength.d.ts
        │   │   ├── maxArrayLength.js
        │   │   ├── maxSafeInteger.d.ts
        │   │   ├── maxSafeInteger.js
        │   │   ├── maxValue.d.ts
        │   │   ├── maxValue.js
        │   ├── floor.d.ts
        │   ├── floor.js
        │   ├── isFinite.d.ts
        │   ├── isFinite.js
        │   ├── isInteger.d.ts
        │   ├── isInteger.js
        │   ├── isNaN.d.ts
        │   ├── isNaN.js
        │   ├── isNegativeZero.d.ts
        │   ├── isNegativeZero.js
        │   ├── max.d.ts
        │   ├── max.js
        │   ├── min.d.ts
        │   ├── min.js
        │   ├── mod.d.ts
        │   ├── mod.js
        │   ├── package.json
        │   ├── pow.d.ts
        │   ├── pow.js
        │   ├── round.d.ts
        │   ├── round.js
        │   ├── sign.d.ts
        │   ├── sign.js
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── media-typer/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── merge-descriptors/
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── license/
        │   ├── package.json
        │   ├── readme.md
        ├── mime-db/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── db.json
        │   ├── index.js
        │   ├── package.json
        ├── mime-types/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── mimeScore.js
        │   ├── package.json
        ├── ms/
        │   ├── index.js
        │   ├── license.md
        │   ├── package.json
        │   ├── readme.md
        ├── nanoid/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── async/
        │   │   ├── index.browser.cjs
        │   │   ├── index.browser.js
        │   │   ├── index.cjs
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── index.native.js
        │   │   ├── package.json
        │   ├── bin/
        │   │   ├── nanoid.cjs
        │   ├── index.browser.cjs
        │   ├── index.browser.js
        │   ├── index.cjs
        │   ├── index.d.cts
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── nanoid.js
        │   ├── non-secure/
        │   │   ├── index.cjs
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── package.json
        │   ├── package.json
        │   ├── url-alphabet/
        │   │   └── index.cjs
        │   │   └── index.js
        │   │   └── package.json
        ├── negotiator/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── lib/
        │   │   ├── charset.js
        │   │   ├── encoding.js
        │   │   ├── language.js
        │   │   ├── mediaType.js
        │   ├── package.json
        ├── object-assign/
        │   ├── index.js
        │   ├── license/
        │   ├── package.json
        │   ├── readme.md
        ├── object-inspect/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── example/
        │   │   ├── all.js
        │   │   ├── circular.js
        │   │   ├── fn.js
        │   │   ├── inspect.js
        │   ├── index.js
        │   ├── package-support.json
        │   ├── package.json
        │   ├── readme.markdown
        │   ├── test-core-js.js
        │   ├── test/
        │   │   ├── bigint.js
        │   │   ├── browser/
        │   │   │   ├── dom.js
        │   │   ├── circular.js
        │   │   ├── deep.js
        │   │   ├── element.js
        │   │   ├── err.js
        │   │   ├── fakes.js
        │   │   ├── fn.js
        │   │   ├── global.js
        │   │   ├── has.js
        │   │   ├── holes.js
        │   │   ├── indent-option.js
        │   │   ├── inspect.js
        │   │   ├── lowbyte.js
        │   │   ├── number.js
        │   │   ├── quoteStyle.js
        │   │   ├── toStringTag.js
        │   │   ├── undef.js
        │   │   ├── values.js
        │   ├── util.inspect.js
        ├── obug/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── browser.d.ts
        │   │   ├── browser.js
        │   │   ├── browser.min.js
        │   │   ├── core.d.ts
        │   │   ├── core.js
        │   │   ├── node.d.ts
        │   │   ├── node.js
        │   ├── package.json
        ├── on-finished/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── once/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── once.js
        │   ├── package.json
        ├── parseurl/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── path-key/
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── license/
        │   ├── package.json
        │   ├── readme.md
        ├── path-to-regexp/
        │   ├── LICENSE/
        │   ├── Readme.md
        │   ├── dist/
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── index.js.map
        │   ├── package.json
        ├── pathe/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.d.cts
        │   │   ├── index.d.mts
        │   │   ├── index.d.ts
        │   │   ├── index.mjs
        │   │   ├── shared/
        │   │   │   ├── pathe.BSlhyZSM.cjs
        │   │   │   ├── pathe.M-eThtNZ.mjs
        │   │   ├── utils.cjs
        │   │   ├── utils.d.cts
        │   │   ├── utils.d.mts
        │   │   ├── utils.d.ts
        │   │   ├── utils.mjs
        │   ├── package.json
        │   ├── utils.d.ts
        ├── picocolors/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── package.json
        │   ├── picocolors.browser.js
        │   ├── picocolors.d.ts
        │   ├── picocolors.js
        │   ├── types.d.ts
        ├── picomatch/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── lib/
        │   │   ├── constants.js
        │   │   ├── parse.js
        │   │   ├── picomatch.js
        │   │   ├── scan.js
        │   │   ├── utils.js
        │   ├── package.json
        │   ├── posix.js
        ├── pkce-challenge/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.browser.d.ts
        │   │   ├── index.browser.js
        │   │   ├── index.node.cjs
        │   │   ├── index.node.d.cts
        │   │   ├── index.node.d.ts
        │   │   ├── index.node.js
        │   ├── package.json
        ├── postcss/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── lib/
        │   │   ├── at-rule.d.ts
        │   │   ├── at-rule.js
        │   │   ├── comment.d.ts
        │   │   ├── comment.js
        │   │   ├── container.d.ts
        │   │   ├── container.js
        │   │   ├── css-syntax-error.d.ts
        │   │   ├── css-syntax-error.js
        │   │   ├── declaration.d.ts
        │   │   ├── declaration.js
        │   │   ├── document.d.ts
        │   │   ├── document.js
        │   │   ├── fromJSON.d.ts
        │   │   ├── fromJSON.js
        │   │   ├── input.d.ts
        │   │   ├── input.js
        │   │   ├── lazy-result.d.ts
        │   │   ├── lazy-result.js
        │   │   ├── list.d.ts
        │   │   ├── list.js
        │   │   ├── map-generator.js
        │   │   ├── no-work-result.d.ts
        │   │   ├── no-work-result.js
        │   │   ├── node.d.ts
        │   │   ├── node.js
        │   │   ├── parse.d.ts
        │   │   ├── parse.js
        │   │   ├── parser.js
        │   │   ├── postcss.d.mts
        │   │   ├── postcss.d.ts
        │   │   ├── postcss.js
        │   │   ├── postcss.mjs
        │   │   ├── previous-map.d.ts
        │   │   ├── previous-map.js
        │   │   ├── processor.d.ts
        │   │   ├── processor.js
        │   │   ├── result.d.ts
        │   │   ├── result.js
        │   │   ├── root.d.ts
        │   │   ├── root.js
        │   │   ├── rule.d.ts
        │   │   ├── rule.js
        │   │   ├── stringifier.d.ts
        │   │   ├── stringifier.js
        │   │   ├── stringify.d.ts
        │   │   ├── stringify.js
        │   │   ├── symbols.js
        │   │   ├── terminal-highlight.js
        │   │   ├── tokenize.js
        │   │   ├── warn-once.js
        │   │   ├── warning.d.ts
        │   │   ├── warning.js
        │   ├── package.json
        ├── proper-lockfile/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── lib/
        │   │   ├── adapter.js
        │   │   ├── lockfile.js
        │   │   ├── mtime-precision.js
        │   ├── package.json
        ├── proxy-addr/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── qs/
        │   ├── CHANGELOG.md
        │   ├── LICENSE.md
        │   ├── README.md
        │   ├── dist/
        │   │   ├── qs.js
        │   ├── eslint.config.mjs
        │   ├── lib/
        │   │   ├── formats.js
        │   │   ├── index.js
        │   │   ├── parse.js
        │   │   ├── stringify.js
        │   │   ├── utils.js
        │   ├── package.json
        │   ├── test/
        │   │   └── empty-keys-cases.js
        │   │   └── parse.js
        │   │   └── stringify.js
        │   │   └── utils.js
        ├── range-parser/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── raw-body/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        ├── require-from-string/
        │   ├── index.js
        │   ├── license/
        │   ├── package.json
        │   ├── readme.md
        ├── resolve-pkg-maps/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.d.cts
        │   │   ├── index.d.mts
        │   │   ├── index.mjs
        │   ├── package.json
        ├── retry/
        │   ├── License/
        │   ├── Makefile/
        │   ├── README.md
        │   ├── equation.gif
        │   ├── example/
        │   │   ├── dns.js
        │   │   ├── stop.js
        │   ├── index.js
        │   ├── lib/
        │   │   ├── retry.js
        │   │   ├── retry_operation.js
        │   ├── package.json
        │   ├── test/
        │   │   └── common.js
        │   │   └── integration/
        │   │       └── test-forever.js
        │   │       └── test-retry-operation.js
        │   │       └── test-retry-wrap.js
        │   │       └── test-timeouts.js
        ├── rollup/
        │   ├── LICENSE.md
        │   ├── README.md
        │   ├── dist/
        │   │   ├── bin/
        │   │   │   ├── rollup/
        │   │   ├── es/
        │   │   │   ├── getLogFilter.js
        │   │   │   ├── package.json
        │   │   │   ├── parseAst.js
        │   │   │   ├── rollup.js
        │   │   │   ├── shared/
        │   │   │   │   └── node-entry.js
        │   │   │   │   └── parseAst.js
        │   │   │   │   └── watch.js
        │   │   ├── getLogFilter.d.ts
        │   │   ├── getLogFilter.js
        │   │   ├── loadConfigFile.d.ts
        │   │   ├── loadConfigFile.js
        │   │   ├── native.js
        │   │   ├── parseAst.d.ts
        │   │   ├── parseAst.js
        │   │   ├── rollup.d.ts
        │   │   ├── rollup.js
        │   │   ├── shared/
        │   │   │   └── fsevents-importer.js
        │   │   │   └── index.js
        │   │   │   └── loadConfigFile.js
        │   │   │   └── parseAst.js
        │   │   │   └── rollup.js
        │   │   │   └── watch-cli.js
        │   │   │   └── watch.js
        │   ├── package.json
        ├── router/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── lib/
        │   │   ├── layer.js
        │   │   ├── route.js
        │   ├── package.json
        ├── safer-buffer/
        │   ├── LICENSE/
        │   ├── Porting-Buffer.md
        │   ├── Readme.md
        │   ├── dangerous.js
        │   ├── package.json
        │   ├── safer.js
        │   ├── tests.js
        ├── send/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── serve-static/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── setprototypeof/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   └── index.js
        ├── shebang-command/
        │   ├── index.js
        │   ├── license/
        │   ├── package.json
        │   ├── readme.md
        ├── shebang-regex/
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── license/
        │   ├── package.json
        │   ├── readme.md
        ├── side-channel-list/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── list.d.ts
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── side-channel-map/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── side-channel-weakmap/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── side-channel/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.d.ts
        │   ├── index.js
        │   ├── package.json
        │   ├── test/
        │   │   ├── index.js
        │   ├── tsconfig.json
        ├── siginfo/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        │   ├── test.js
        ├── signal-exit/
        │   ├── LICENSE.txt
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        │   ├── signals.js
        ├── source-map-js/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── lib/
        │   │   ├── array-set.js
        │   │   ├── base64-vlq.js
        │   │   ├── base64.js
        │   │   ├── binary-search.js
        │   │   ├── mapping-list.js
        │   │   ├── quick-sort.js
        │   │   ├── source-map-consumer.d.ts
        │   │   ├── source-map-consumer.js
        │   │   ├── source-map-generator.d.ts
        │   │   ├── source-map-generator.js
        │   │   ├── source-node.d.ts
        │   │   ├── source-node.js
        │   │   ├── util.js
        │   ├── package.json
        │   ├── source-map.d.ts
        │   ├── source-map.js
        ├── stackback/
        │   ├── README.md
        │   ├── formatstack.js
        │   ├── index.js
        │   ├── package.json
        │   ├── test.js
        ├── statuses/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── codes.json
        │   ├── index.js
        │   ├── package.json
        ├── std-env/
        │   ├── LICENCE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.d.cts
        │   │   ├── index.d.mts
        │   │   ├── index.d.ts
        │   │   ├── index.mjs
        │   ├── package.json
        ├── tinybench/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.d.cts
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   ├── package.json
        ├── tinyexec/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── main.d.ts
        │   │   ├── main.js
        │   ├── package.json
        ├── tinyglobby/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.cjs
        │   │   ├── index.d.cts
        │   │   ├── index.d.mts
        │   │   ├── index.mjs
        │   ├── package.json
        ├── tinyrainbow/
        │   ├── LICENCE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   ├── package.json
        ├── toidentifier/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── tsx/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── dist/
        │   │   ├── cjs/
        │   │   │   ├── api/
        │   │   │   │   ├── index.cjs
        │   │   │   │   ├── index.d.cts
        │   │   │   │   ├── index.d.mts
        │   │   │   │   ├── index.mjs
        │   │   │   ├── index.cjs
        │   │   │   ├── index.mjs
        │   │   ├── cli.cjs
        │   │   ├── cli.mjs
        │   │   ├── client-BQVF1NaW.mjs
        │   │   ├── client-D6NvIMSC.cjs
        │   │   ├── esm/
        │   │   │   ├── api/
        │   │   │   │   ├── index.cjs
        │   │   │   │   ├── index.d.cts
        │   │   │   │   ├── index.d.mts
        │   │   │   │   ├── index.mjs
        │   │   │   ├── index.cjs
        │   │   │   ├── index.mjs
        │   │   ├── get-pipe-path-BHW2eJdv.mjs
        │   │   ├── get-pipe-path-BoR10qr8.cjs
        │   │   ├── index-7AaEi15b.mjs
        │   │   ├── index-BWFBUo6r.cjs
        │   │   ├── index-gbaejti9.mjs
        │   │   ├── index-gckBtVBf.cjs
        │   │   ├── lexer-DQCqS3nf.mjs
        │   │   ├── lexer-DgIbo0BU.cjs
        │   │   ├── loader.cjs
        │   │   ├── loader.mjs
        │   │   ├── node-features-_8ZFwP_x.mjs
        │   │   ├── node-features-roYmp9jK.cjs
        │   │   ├── package-CeBgXWuR.mjs
        │   │   ├── package-Dxt5kIHw.cjs
        │   │   ├── patch-repl.cjs
        │   │   ├── patch-repl.mjs
        │   │   ├── preflight.cjs
        │   │   ├── preflight.mjs
        │   │   ├── register-2sWVXuRQ.cjs
        │   │   ├── register-B7jrtLTO.mjs
        │   │   ├── register-CFH5oNdT.mjs
        │   │   ├── register-D46fvsV_.cjs
        │   │   ├── repl.cjs
        │   │   ├── repl.mjs
        │   │   ├── require-D4F1Lv60.cjs
        │   │   ├── require-DQxpCAr4.mjs
        │   │   ├── suppress-warnings.cjs
        │   │   ├── suppress-warnings.mjs
        │   │   ├── temporary-directory-B83uKxJF.cjs
        │   │   ├── temporary-directory-CwHp0_NW.mjs
        │   │   ├── types-Cxp8y2TL.d.ts
        │   ├── package.json
        ├── type-is/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── typescript/
        │   ├── LICENSE.txt
        │   ├── README.md
        │   ├── SECURITY.md
        │   ├── ThirdPartyNoticeText.txt
        │   ├── bin/
        │   │   ├── tsc/
        │   │   ├── tsserver/
        │   ├── lib/
        │   │   ├── _tsc.js
        │   │   ├── _tsserver.js
        │   │   ├── _typingsInstaller.js
        │   │   ├── cs/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── de/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── es/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── fr/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── it/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── ja/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── ko/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── lib.d.ts
        │   │   ├── lib.decorators.d.ts
        │   │   ├── lib.decorators.legacy.d.ts
        │   │   ├── lib.dom.asynciterable.d.ts
        │   │   ├── lib.dom.d.ts
        │   │   ├── lib.dom.iterable.d.ts
        │   │   ├── lib.es2015.collection.d.ts
        │   │   ├── lib.es2015.core.d.ts
        │   │   ├── lib.es2015.d.ts
        │   │   ├── lib.es2015.generator.d.ts
        │   │   ├── lib.es2015.iterable.d.ts
        │   │   ├── lib.es2015.promise.d.ts
        │   │   ├── lib.es2015.proxy.d.ts
        │   │   ├── lib.es2015.reflect.d.ts
        │   │   ├── lib.es2015.symbol.d.ts
        │   │   ├── lib.es2015.symbol.wellknown.d.ts
        │   │   ├── lib.es2016.array.include.d.ts
        │   │   ├── lib.es2016.d.ts
        │   │   ├── lib.es2016.full.d.ts
        │   │   ├── lib.es2016.intl.d.ts
        │   │   ├── lib.es2017.arraybuffer.d.ts
        │   │   ├── lib.es2017.d.ts
        │   │   ├── lib.es2017.date.d.ts
        │   │   ├── lib.es2017.full.d.ts
        │   │   ├── lib.es2017.intl.d.ts
        │   │   ├── lib.es2017.object.d.ts
        │   │   ├── lib.es2017.sharedmemory.d.ts
        │   │   ├── lib.es2017.string.d.ts
        │   │   ├── lib.es2017.typedarrays.d.ts
        │   │   ├── lib.es2018.asyncgenerator.d.ts
        │   │   ├── lib.es2018.asynciterable.d.ts
        │   │   ├── lib.es2018.d.ts
        │   │   ├── lib.es2018.full.d.ts
        │   │   ├── lib.es2018.intl.d.ts
        │   │   ├── lib.es2018.promise.d.ts
        │   │   ├── lib.es2018.regexp.d.ts
        │   │   ├── lib.es2019.array.d.ts
        │   │   ├── lib.es2019.d.ts
        │   │   ├── lib.es2019.full.d.ts
        │   │   ├── lib.es2019.intl.d.ts
        │   │   ├── lib.es2019.object.d.ts
        │   │   ├── lib.es2019.string.d.ts
        │   │   ├── lib.es2019.symbol.d.ts
        │   │   ├── lib.es2020.bigint.d.ts
        │   │   ├── lib.es2020.d.ts
        │   │   ├── lib.es2020.date.d.ts
        │   │   ├── lib.es2020.full.d.ts
        │   │   ├── lib.es2020.intl.d.ts
        │   │   ├── lib.es2020.number.d.ts
        │   │   ├── lib.es2020.promise.d.ts
        │   │   ├── lib.es2020.sharedmemory.d.ts
        │   │   ├── lib.es2020.string.d.ts
        │   │   ├── lib.es2020.symbol.wellknown.d.ts
        │   │   ├── lib.es2021.d.ts
        │   │   ├── lib.es2021.full.d.ts
        │   │   ├── lib.es2021.intl.d.ts
        │   │   ├── lib.es2021.promise.d.ts
        │   │   ├── lib.es2021.string.d.ts
        │   │   ├── lib.es2021.weakref.d.ts
        │   │   ├── lib.es2022.array.d.ts
        │   │   ├── lib.es2022.d.ts
        │   │   ├── lib.es2022.error.d.ts
        │   │   ├── lib.es2022.full.d.ts
        │   │   ├── lib.es2022.intl.d.ts
        │   │   ├── lib.es2022.object.d.ts
        │   │   ├── lib.es2022.regexp.d.ts
        │   │   ├── lib.es2022.string.d.ts
        │   │   ├── lib.es2023.array.d.ts
        │   │   ├── lib.es2023.collection.d.ts
        │   │   ├── lib.es2023.d.ts
        │   │   ├── lib.es2023.full.d.ts
        │   │   ├── lib.es2023.intl.d.ts
        │   │   ├── lib.es2024.arraybuffer.d.ts
        │   │   ├── lib.es2024.collection.d.ts
        │   │   ├── lib.es2024.d.ts
        │   │   ├── lib.es2024.full.d.ts
        │   │   ├── lib.es2024.object.d.ts
        │   │   ├── lib.es2024.promise.d.ts
        │   │   ├── lib.es2024.regexp.d.ts
        │   │   ├── lib.es2024.sharedmemory.d.ts
        │   │   ├── lib.es2024.string.d.ts
        │   │   ├── lib.es5.d.ts
        │   │   ├── lib.es6.d.ts
        │   │   ├── lib.esnext.array.d.ts
        │   │   ├── lib.esnext.collection.d.ts
        │   │   ├── lib.esnext.d.ts
        │   │   ├── lib.esnext.decorators.d.ts
        │   │   ├── lib.esnext.disposable.d.ts
        │   │   ├── lib.esnext.error.d.ts
        │   │   ├── lib.esnext.float16.d.ts
        │   │   ├── lib.esnext.full.d.ts
        │   │   ├── lib.esnext.intl.d.ts
        │   │   ├── lib.esnext.iterator.d.ts
        │   │   ├── lib.esnext.promise.d.ts
        │   │   ├── lib.esnext.sharedmemory.d.ts
        │   │   ├── lib.scripthost.d.ts
        │   │   ├── lib.webworker.asynciterable.d.ts
        │   │   ├── lib.webworker.d.ts
        │   │   ├── lib.webworker.importscripts.d.ts
        │   │   ├── lib.webworker.iterable.d.ts
        │   │   ├── pl/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── pt-br/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── ru/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── tr/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── tsc.js
        │   │   ├── tsserver.js
        │   │   ├── tsserverlibrary.d.ts
        │   │   ├── tsserverlibrary.js
        │   │   ├── typesMap.json
        │   │   ├── typescript.d.ts
        │   │   ├── typescript.js
        │   │   ├── typingsInstaller.js
        │   │   ├── watchGuard.js
        │   │   ├── zh-cn/
        │   │   │   ├── diagnosticMessages.generated.json
        │   │   ├── zh-tw/
        │   │   │   └── diagnosticMessages.generated.json
        │   ├── package.json
        ├── undici-types/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── agent.d.ts
        │   ├── api.d.ts
        │   ├── balanced-pool.d.ts
        │   ├── cache.d.ts
        │   ├── client.d.ts
        │   ├── connector.d.ts
        │   ├── content-type.d.ts
        │   ├── cookies.d.ts
        │   ├── diagnostics-channel.d.ts
        │   ├── dispatcher.d.ts
        │   ├── env-http-proxy-agent.d.ts
        │   ├── errors.d.ts
        │   ├── eventsource.d.ts
        │   ├── fetch.d.ts
        │   ├── file.d.ts
        │   ├── filereader.d.ts
        │   ├── formdata.d.ts
        │   ├── global-dispatcher.d.ts
        │   ├── global-origin.d.ts
        │   ├── handlers.d.ts
        │   ├── header.d.ts
        │   ├── index.d.ts
        │   ├── interceptors.d.ts
        │   ├── mock-agent.d.ts
        │   ├── mock-client.d.ts
        │   ├── mock-errors.d.ts
        │   ├── mock-interceptor.d.ts
        │   ├── mock-pool.d.ts
        │   ├── package.json
        │   ├── patch.d.ts
        │   ├── pool-stats.d.ts
        │   ├── pool.d.ts
        │   ├── proxy-agent.d.ts
        │   ├── readable.d.ts
        │   ├── retry-agent.d.ts
        │   ├── retry-handler.d.ts
        │   ├── util.d.ts
        │   ├── webidl.d.ts
        │   ├── websocket.d.ts
        ├── unpipe/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── vary/
        │   ├── HISTORY.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── index.js
        │   ├── package.json
        ├── vite/
        │   ├── LICENSE.md
        │   ├── README.md
        │   ├── bin/
        │   │   ├── openChrome.js
        │   │   ├── vite.js
        │   ├── client.d.ts
        │   ├── dist/
        │   │   ├── client/
        │   │   │   ├── client.mjs
        │   │   │   ├── env.mjs
        │   │   ├── node/
        │   │   │   └── chunks/
        │   │   │       ├── build.js
        │   │   │       ├── build2.js
        │   │   │       ├── chunk.js
        │   │   │       ├── config.js
        │   │   │       ├── config2.js
        │   │   │       ├── dist.js
        │   │   │       ├── lib.js
        │   │   │       ├── logger.js
        │   │   │       ├── moduleRunnerTransport.d.ts
        │   │   │       ├── optimizer.js
        │   │   │       ├── postcss-import.js
        │   │   │       ├── preview.js
        │   │   │       ├── server.js
        │   │   │   └── cli.js
        │   │   │   └── index.d.ts
        │   │   │   └── index.js
        │   │   │   └── module-runner.d.ts
        │   │   │   └── module-runner.js
        │   ├── misc/
        │   │   ├── false.js
        │   │   ├── true.js
        │   ├── package.json
        │   ├── types/
        │   │   └── customEvent.d.ts
        │   │   └── hmrPayload.d.ts
        │   │   └── hot.d.ts
        │   │   └── import-meta.d.ts
        │   │   └── importGlob.d.ts
        │   │   └── importMeta.d.ts
        │   │   └── internal/
        │   │       ├── cssPreprocessorOptions.d.ts
        │   │       ├── lightningcssOptions.d.ts
        │   │       ├── terserOptions.d.ts
        │   │   └── metadata.d.ts
        │   │   └── package.json
        ├── vitest/
        │   ├── LICENSE.md
        │   ├── README.md
        │   ├── browser/
        │   │   ├── context.d.ts
        │   │   ├── context.js
        │   ├── config.d.ts
        │   ├── coverage.d.ts
        │   ├── dist/
        │   │   ├── browser.d.ts
        │   │   ├── browser.js
        │   │   ├── chunks/
        │   │   │   ├── _commonjsHelpers.D26ty3Ew.js
        │   │   │   ├── base.CJ0Y4ePK.js
        │   │   │   ├── benchmark.B3N2zMcH.js
        │   │   │   ├── benchmark.d.DAaHLpsq.d.ts
        │   │   │   ├── browser.d.ChKACdzH.d.ts
        │   │   │   ├── cac.DVeoLl0M.js
        │   │   │   ├── cli-api.B7PN_QUv.js
        │   │   │   ├── config.d.Cy95HiCx.d.ts
        │   │   │   ├── console.Cf-YriPC.js
        │   │   │   ├── constants.D_Q9UYh-.js
        │   │   │   ├── coverage.AVPTjMgw.js
        │   │   │   ├── coverage.D_JHT54q.js
        │   │   │   ├── coverage.d.BZtK59WP.d.ts
        │   │   │   ├── creator.DAmOKTvJ.js
        │   │   │   ├── date.Bq6ZW5rf.js
        │   │   │   ├── defaults.BOqNVLsY.js
        │   │   │   ├── env.D4Lgay0q.js
        │   │   │   ├── environment.d.CrsxCzP1.d.ts
        │   │   │   ├── evaluatedModules.Dg1zASAC.js
        │   │   │   ├── evaluatedModules.d.BxJ5omdx.d.ts
        │   │   │   ├── git.Bm2pzPAa.js
        │   │   │   ├── global.d.B15mdLcR.d.ts
        │   │   │   ├── globals.DOayXfHP.js
        │   │   │   ├── index.6Qv1eEA6.js
        │   │   │   ├── index.C5r1PdPD.js
        │   │   │   ├── index.Chj8NDwU.js
        │   │   │   ├── index.CyBMJtT7.js
        │   │   │   ├── index.D3XRDfWc.js
        │   │   │   ├── index.D4KonVSU.js
        │   │   │   ├── index.M8mOzt4Y.js
        │   │   │   ├── index.Z5E_ObnR.js
        │   │   │   ├── init-forks._y3TW739.js
        │   │   │   ├── init-threads.DBO2kn-p.js
        │   │   │   ├── init.B6MLFIaN.js
        │   │   │   ├── inspector.CvyFGlXm.js
        │   │   │   ├── modules.BJuCwlRJ.js
        │   │   │   ├── node.Ce0vMQM7.js
        │   │   │   ├── plugin.d.CtqpEehP.d.ts
        │   │   │   ├── reporters.d.CWXNI2jG.d.ts
        │   │   │   ├── rpc.BoxB0q7B.js
        │   │   │   ├── rpc.d.RH3apGEf.d.ts
        │   │   │   ├── setup-common.Cm-kSBVi.js
        │   │   │   ├── startModuleRunner.DEj0jb3e.js
        │   │   │   ├── suite.d.BJWk38HB.d.ts
        │   │   │   ├── test.B8ej_ZHS.js
        │   │   │   ├── traces.CCmnQaNT.js
        │   │   │   ├── traces.d.402V_yFI.d.ts
        │   │   │   ├── utils.DvEY5TfP.js
        │   │   │   ├── vi.2VT5v0um.js
        │   │   │   ├── vm.D3epNOPZ.js
        │   │   │   ├── worker.d.Dyxm8DEL.d.ts
        │   │   ├── cli.js
        │   │   ├── config.cjs
        │   │   ├── config.d.ts
        │   │   ├── config.js
        │   │   ├── coverage.d.ts
        │   │   ├── coverage.js
        │   │   ├── environments.d.ts
        │   │   ├── environments.js
        │   │   ├── index.d.ts
        │   │   ├── index.js
        │   │   ├── mocker.d.ts
        │   │   ├── mocker.js
        │   │   ├── module-evaluator.d.ts
        │   │   ├── module-evaluator.js
        │   │   ├── module-runner.js
        │   │   ├── node.d.ts
        │   │   ├── node.js
        │   │   ├── path.js
        │   │   ├── reporters.d.ts
        │   │   ├── reporters.js
        │   │   ├── runners.d.ts
        │   │   ├── runners.js
        │   │   ├── snapshot.d.ts
        │   │   ├── snapshot.js
        │   │   ├── spy.js
        │   │   ├── suite.d.ts
        │   │   ├── suite.js
        │   │   ├── worker.d.ts
        │   │   ├── worker.js
        │   │   ├── workers/
        │   │   │   └── forks.js
        │   │   │   └── runVmTests.js
        │   │   │   └── threads.js
        │   │   │   └── vmForks.js
        │   │   │   └── vmThreads.js
        │   ├── environments.d.ts
        │   ├── globals.d.ts
        │   ├── import-meta.d.ts
        │   ├── importMeta.d.ts
        │   ├── index.cjs
        │   ├── index.d.cts
        │   ├── jsdom.d.ts
        │   ├── mocker.d.ts
        │   ├── node.d.ts
        │   ├── optional-types.d.ts
        │   ├── package.json
        │   ├── reporters.d.ts
        │   ├── runners.d.ts
        │   ├── snapshot.d.ts
        │   ├── suite.d.ts
        │   ├── suppress-warnings.cjs
        │   ├── vitest.mjs
        │   ├── worker.d.ts
        ├── which/
        │   ├── CHANGELOG.md
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── bin/
        │   │   ├── node-which/
        │   ├── package.json
        │   ├── which.js
        ├── why-is-node-running/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── cli.js
        │   ├── example.js
        │   ├── include.js
        │   ├── index.js
        │   ├── package.json
        ├── wrappy/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── package.json
        │   ├── wrappy.js
        ├── zod-to-json-schema/
        │   ├── LICENSE/
        │   ├── README.md
        │   ├── changelog.md
        │   ├── contributing.md
        │   ├── createIndex.ts
        │   ├── dist/
        │   │   ├── cjs/
        │   │   │   ├── Options.js
        │   │   │   ├── Refs.js
        │   │   │   ├── errorMessages.js
        │   │   │   ├── getRelativePath.js
        │   │   │   ├── index.js
        │   │   │   ├── package.json
        │   │   │   ├── parseDef.js
        │   │   │   ├── parseTypes.js
        │   │   │   ├── parsers/
        │   │   │   │   ├── any.js
        │   │   │   │   ├── array.js
        │   │   │   │   ├── bigint.js
        │   │   │   │   ├── boolean.js
        │   │   │   │   ├── branded.js
        │   │   │   │   ├── catch.js
        │   │   │   │   ├── date.js
        │   │   │   │   ├── default.js
        │   │   │   │   ├── effects.js
        │   │   │   │   ├── enum.js
        │   │   │   │   ├── intersection.js
        │   │   │   │   ├── literal.js
        │   │   │   │   ├── map.js
        │   │   │   │   ├── nativeEnum.js
        │   │   │   │   ├── never.js
        │   │   │   │   ├── null.js
        │   │   │   │   ├── nullable.js
        │   │   │   │   ├── number.js
        │   │   │   │   ├── object.js
        │   │   │   │   ├── optional.js
        │   │   │   │   ├── pipeline.js
        │   │   │   │   ├── promise.js
        │   │   │   │   ├── readonly.js
        │   │   │   │   ├── record.js
        │   │   │   │   ├── set.js
        │   │   │   │   ├── string.js
        │   │   │   │   ├── tuple.js
        │   │   │   │   ├── undefined.js
        │   │   │   │   ├── union.js
        │   │   │   │   ├── unknown.js
        │   │   │   ├── selectParser.js
        │   │   │   ├── zodToJsonSchema.js
        │   │   ├── esm/
        │   │   │   ├── Options.js
        │   │   │   ├── Refs.js
        │   │   │   ├── errorMessages.js
        │   │   │   ├── getRelativePath.js
        │   │   │   ├── index.js
        │   │   │   ├── package.json
        │   │   │   ├── parseDef.js
        │   │   │   ├── parseTypes.js
        │   │   │   ├── parsers/
        │   │   │   │   ├── any.js
        │   │   │   │   ├── array.js
        │   │   │   │   ├── bigint.js
        │   │   │   │   ├── boolean.js
        │   │   │   │   ├── branded.js
        │   │   │   │   ├── catch.js
        │   │   │   │   ├── date.js
        │   │   │   │   ├── default.js
        │   │   │   │   ├── effects.js
        │   │   │   │   ├── enum.js
        │   │   │   │   ├── intersection.js
        │   │   │   │   ├── literal.js
        │   │   │   │   ├── map.js
        │   │   │   │   ├── nativeEnum.js
        │   │   │   │   ├── never.js
        │   │   │   │   ├── null.js
        │   │   │   │   ├── nullable.js
        │   │   │   │   ├── number.js
        │   │   │   │   ├── object.js
        │   │   │   │   ├── optional.js
        │   │   │   │   ├── pipeline.js
        │   │   │   │   ├── promise.js
        │   │   │   │   ├── readonly.js
        │   │   │   │   ├── record.js
        │   │   │   │   ├── set.js
        │   │   │   │   ├── string.js
        │   │   │   │   ├── tuple.js
        │   │   │   │   ├── undefined.js
        │   │   │   │   ├── union.js
        │   │   │   │   ├── unknown.js
        │   │   │   ├── selectParser.js
        │   │   │   ├── zodToJsonSchema.js
        │   │   ├── types/
        │   │   │   └── Options.d.ts
        │   │   │   └── Refs.d.ts
        │   │   │   └── errorMessages.d.ts
        │   │   │   └── getRelativePath.d.ts
        │   │   │   └── index.d.ts
        │   │   │   └── parseDef.d.ts
        │   │   │   └── parseTypes.d.ts
        │   │   │   └── parsers/
        │   │   │       ├── any.d.ts
        │   │   │       ├── array.d.ts
        │   │   │       ├── bigint.d.ts
        │   │   │       ├── boolean.d.ts
        │   │   │       ├── branded.d.ts
        │   │   │       ├── catch.d.ts
        │   │   │       ├── date.d.ts
        │   │   │       ├── default.d.ts
        │   │   │       ├── effects.d.ts
        │   │   │       ├── enum.d.ts
        │   │   │       ├── intersection.d.ts
        │   │   │       ├── literal.d.ts
        │   │   │       ├── map.d.ts
        │   │   │       ├── nativeEnum.d.ts
        │   │   │       ├── never.d.ts
        │   │   │       ├── null.d.ts
        │   │   │       ├── nullable.d.ts
        │   │   │       ├── number.d.ts
        │   │   │       ├── object.d.ts
        │   │   │       ├── optional.d.ts
        │   │   │       ├── pipeline.d.ts
        │   │   │       ├── promise.d.ts
        │   │   │       ├── readonly.d.ts
        │   │   │       ├── record.d.ts
        │   │   │       ├── set.d.ts
        │   │   │       ├── string.d.ts
        │   │   │       ├── tuple.d.ts
        │   │   │       ├── undefined.d.ts
        │   │   │       ├── union.d.ts
        │   │   │       ├── unknown.d.ts
        │   │   │   └── selectParser.d.ts
        │   │   │   └── zodToJsonSchema.d.ts
        │   ├── package.json
        │   ├── postcjs.ts
        │   ├── postesm.ts
        ├── zod/
        │   └── LICENSE/
        │   └── README.md
        │   └── index.cjs
        │   └── index.d.cts
        │   └── index.d.ts
        │   └── index.js
        │   └── package.json
        │   └── src/
        │       ├── index.ts
        │       ├── v3/
        │       │   ├── ZodError.ts
        │       │   ├── benchmarks/
        │       │   │   ├── datetime.ts
        │       │   │   ├── discriminatedUnion.ts
        │       │   │   ├── index.ts
        │       │   │   ├── ipv4.ts
        │       │   │   ├── object.ts
        │       │   │   ├── primitives.ts
        │       │   │   ├── realworld.ts
        │       │   │   ├── string.ts
        │       │   │   ├── union.ts
        │       │   ├── errors.ts
        │       │   ├── external.ts
        │       │   ├── helpers/
        │       │   │   ├── enumUtil.ts
        │       │   │   ├── errorUtil.ts
        │       │   │   ├── parseUtil.ts
        │       │   │   ├── partialUtil.ts
        │       │   │   ├── typeAliases.ts
        │       │   │   ├── util.ts
        │       │   ├── index.ts
        │       │   ├── locales/
        │       │   │   ├── en.ts
        │       │   ├── standard-schema.ts
        │       │   ├── tests/
        │       │   │   ├── Mocker.ts
        │       │   │   ├── all-errors.test.ts
        │       │   │   ├── anyunknown.test.ts
        │       │   │   ├── array.test.ts
        │       │   │   ├── async-parsing.test.ts
        │       │   │   ├── async-refinements.test.ts
        │       │   │   ├── base.test.ts
        │       │   │   ├── bigint.test.ts
        │       │   │   ├── branded.test.ts
        │       │   │   ├── catch.test.ts
        │       │   │   ├── coerce.test.ts
        │       │   │   ├── complex.test.ts
        │       │   │   ├── custom.test.ts
        │       │   │   ├── date.test.ts
        │       │   │   ├── deepmasking.test.ts
        │       │   │   ├── default.test.ts
        │       │   │   ├── description.test.ts
        │       │   │   ├── discriminated-unions.test.ts
        │       │   │   ├── enum.test.ts
        │       │   │   ├── error.test.ts
        │       │   │   ├── firstparty.test.ts
        │       │   │   ├── firstpartyschematypes.test.ts
        │       │   │   ├── function.test.ts
        │       │   │   ├── generics.test.ts
        │       │   │   ├── instanceof.test.ts
        │       │   │   ├── intersection.test.ts
        │       │   │   ├── language-server.source.ts
        │       │   │   ├── language-server.test.ts
        │       │   │   ├── literal.test.ts
        │       │   │   ├── map.test.ts
        │       │   │   ├── masking.test.ts
        │       │   │   ├── mocker.test.ts
        │       │   │   ├── nan.test.ts
        │       │   │   ├── nativeEnum.test.ts
        │       │   │   ├── nullable.test.ts
        │       │   │   ├── number.test.ts
        │       │   │   ├── object-augmentation.test.ts
        │       │   │   ├── object-in-es5-env.test.ts
        │       │   │   ├── object.test.ts
        │       │   │   ├── optional.test.ts
        │       │   │   ├── parseUtil.test.ts
        │       │   │   ├── parser.test.ts
        │       │   │   ├── partials.test.ts
        │       │   │   ├── pickomit.test.ts
        │       │   │   ├── pipeline.test.ts
        │       │   │   ├── preprocess.test.ts
        │       │   │   ├── primitive.test.ts
        │       │   │   ├── promise.test.ts
        │       │   │   ├── readonly.test.ts
        │       │   │   ├── record.test.ts
        │       │   │   ├── recursive.test.ts
        │       │   │   ├── refine.test.ts
        │       │   │   ├── safeparse.test.ts
        │       │   │   ├── set.test.ts
        │       │   │   ├── standard-schema.test.ts
        │       │   │   ├── string.test.ts
        │       │   │   ├── transformer.test.ts
        │       │   │   ├── tuple.test.ts
        │       │   │   ├── unions.test.ts
        │       │   │   ├── validations.test.ts
        │       │   │   ├── void.test.ts
        │       │   ├── types.ts
        │       ├── v4-mini/
        │       │   ├── index.ts
        │       ├── v4/
        │       │   └── classic/
        │       │       ├── checks.ts
        │       │       ├── coerce.ts
        │       │       ├── compat.ts
        │       │       ├── errors.ts
        │       │       ├── external.ts
        │       │       ├── index.ts
        │       │       ├── iso.ts
        │       │       ├── parse.ts
        │       │       ├── schemas.ts
        │       │       ├── tests/
        │       │       │   └── anyunknown.test.ts
        │       │       │   └── array.test.ts
        │       │       │   └── assignability.test.ts
        │       │       │   └── async-parsing.test.ts
        │       │       │   └── async-refinements.test.ts
        │       │       │   └── base.test.ts
        │       │       │   └── bigint.test.ts
        │       │       │   └── brand.test.ts
        │       │       │   └── catch.test.ts
        │       │       │   └── coalesce.test.ts
        │       │       │   └── coerce.test.ts
        │       │       │   └── continuability.test.ts
        │       │       │   └── custom.test.ts
        │       │       │   └── date.test.ts
        │       │       │   └── datetime.test.ts
        │       │       │   └── default.test.ts
        │       │       │   └── description.test.ts
        │       │       │   └── discriminated-unions.test.ts
        │       │       │   └── enum.test.ts
        │       │       │   └── error-utils.test.ts
        │       │       │   └── error.test.ts
        │       │       │   └── file.test.ts
        │       │       │   └── firstparty.test.ts
        │       │       │   └── function.test.ts
        │       │       │   └── generics.test.ts
        │       │       │   └── index.test.ts
        │       │       │   └── instanceof.test.ts
        │       │       │   └── intersection.test.ts
        │       │       │   └── json.test.ts
        │       │       │   └── lazy.test.ts
        │       │       │   └── literal.test.ts
        │       │       │   └── map.test.ts
        │       │       │   └── nan.test.ts
        │       │       │   └── nested-refine.test.ts
        │       │       │   └── nonoptional.test.ts
        │       │       │   └── nullable.test.ts
        │       │       │   └── number.test.ts
        │       │       │   └── object.test.ts
        │       │       │   └── optional.test.ts
        │       │       │   └── partial.test.ts
        │       │       │   └── pickomit.test.ts
        │       │       │   └── pipe.test.ts
        │       │       │   └── prefault.test.ts
        │       │       │   └── preprocess.test.ts
        │       │       │   └── primitive.test.ts
        │       │       │   └── promise.test.ts
        │       │       │   └── prototypes.test.ts
        │       │       │   └── readonly.test.ts
        │       │       │   └── record.test.ts
        │       │       │   └── recursive-types.test.ts
        │       │       │   └── refine.test.ts
        │       │       │   └── registries.test.ts
        │       │       │   └── set.test.ts
        │       │       │   └── standard-schema.test.ts
        │       │       │   └── string-formats.test.ts
        │       │       │   └── string.test.ts
        │       │       │   └── stringbool.test.ts
        │       │       │   └── template-literal.test.ts
        │       │       │   └── to-json-schema.test.ts
        │       │       │   └── transform.test.ts
        │       │       │   └── tuple.test.ts
        │       │       │   └── union.test.ts
        │       │       │   └── validations.test.ts
        │       │       │   └── void.test.ts
        │       │   └── core/
        │       │       ├── api.ts
        │       │       ├── checks.ts
        │       │       ├── config.ts
        │       │       ├── core.ts
        │       │       ├── doc.ts
        │       │       ├── errors.ts
        │       │       ├── function.ts
        │       │       ├── index.ts
        │       │       ├── json-schema.ts
        │       │       ├── parse.ts
        │       │       ├── regexes.ts
        │       │       ├── registries.ts
        │       │       ├── schemas.ts
        │       │       ├── standard-schema.ts
        │       │       ├── tests/
        │       │       │   ├── index.test.ts
        │       │       │   ├── locales/
        │       │       │   │   └── be.test.ts
        │       │       │   │   └── en.test.ts
        │       │       │   │   └── ru.test.ts
        │       │       │   │   └── tr.test.ts
        │       │       ├── to-json-schema.ts
        │       │       ├── util.ts
        │       │       ├── versions.ts
        │       │       ├── zsf.ts
        │       │   └── index.ts
        │       │   └── locales/
        │       │       ├── ar.ts
        │       │       ├── az.ts
        │       │       ├── be.ts
        │       │       ├── ca.ts
        │       │       ├── cs.ts
        │       │       ├── de.ts
        │       │       ├── en.ts
        │       │       ├── eo.ts
        │       │       ├── es.ts
        │       │       ├── fa.ts
        │       │       ├── fi.ts
        │       │       ├── fr-CA.ts
        │       │       ├── fr.ts
        │       │       ├── he.ts
        │       │       ├── hu.ts
        │       │       ├── id.ts
        │       │       ├── index.ts
        │       │       ├── it.ts
        │       │       ├── ja.ts
        │       │       ├── kh.ts
        │       │       ├── ko.ts
        │       │       ├── mk.ts
        │       │       ├── ms.ts
        │       │       ├── nl.ts
        │       │       ├── no.ts
        │       │       ├── ota.ts
        │       │       ├── pl.ts
        │       │       ├── ps.ts
        │       │       ├── pt.ts
        │       │       ├── ru.ts
        │       │       ├── sl.ts
        │       │       ├── sv.ts
        │       │       ├── ta.ts
        │       │       ├── th.ts
        │       │       ├── tr.ts
        │       │       ├── ua.ts
        │       │       ├── ur.ts
        │       │       ├── vi.ts
        │       │       ├── zh-CN.ts
        │       │       ├── zh-TW.ts
        │       │   └── mini/
        │       │       └── checks.ts
        │       │       └── coerce.ts
        │       │       └── external.ts
        │       │       └── index.ts
        │       │       └── iso.ts
        │       │       └── parse.ts
        │       │       └── schemas.ts
        │       │       └── tests/
        │       │           └── assignability.test.ts
        │       │           └── brand.test.ts
        │       │           └── checks.test.ts
        │       │           └── computed.test.ts
        │       │           └── error.test.ts
        │       │           └── functions.test.ts
        │       │           └── index.test.ts
        │       │           └── number.test.ts
        │       │           └── object.test.ts
        │       │           └── prototypes.test.ts
        │       │           └── recursive-types.test.ts
        │       │           └── string.test.ts
        │   └── v3/
        │       ├── ZodError.cjs
        │       ├── ZodError.d.cts
        │       ├── ZodError.d.ts
        │       ├── ZodError.js
        │       ├── errors.cjs
        │       ├── errors.d.cts
        │       ├── errors.d.ts
        │       ├── errors.js
        │       ├── external.cjs
        │       ├── external.d.cts
        │       ├── external.d.ts
        │       ├── external.js
        │       ├── helpers/
        │       │   ├── enumUtil.cjs
        │       │   ├── enumUtil.d.cts
        │       │   ├── enumUtil.d.ts
        │       │   ├── enumUtil.js
        │       │   ├── errorUtil.cjs
        │       │   ├── errorUtil.d.cts
        │       │   ├── errorUtil.d.ts
        │       │   ├── errorUtil.js
        │       │   ├── parseUtil.cjs
        │       │   ├── parseUtil.d.cts
        │       │   ├── parseUtil.d.ts
        │       │   ├── parseUtil.js
        │       │   ├── partialUtil.cjs
        │       │   ├── partialUtil.d.cts
        │       │   ├── partialUtil.d.ts
        │       │   ├── partialUtil.js
        │       │   ├── typeAliases.cjs
        │       │   ├── typeAliases.d.cts
        │       │   ├── typeAliases.d.ts
        │       │   ├── typeAliases.js
        │       │   ├── util.cjs
        │       │   ├── util.d.cts
        │       │   ├── util.d.ts
        │       │   ├── util.js
        │       ├── index.cjs
        │       ├── index.d.cts
        │       ├── index.d.ts
        │       ├── index.js
        │       ├── locales/
        │       │   ├── en.cjs
        │       │   ├── en.d.cts
        │       │   ├── en.d.ts
        │       │   ├── en.js
        │       ├── standard-schema.cjs
        │       ├── standard-schema.d.cts
        │       ├── standard-schema.d.ts
        │       ├── standard-schema.js
        │       ├── types.cjs
        │       ├── types.d.cts
        │       ├── types.d.ts
        │       ├── types.js
        │   └── v4-mini/
        │       ├── index.cjs
        │       ├── index.d.cts
        │       ├── index.d.ts
        │       ├── index.js
        │   └── v4/
        │       └── classic/
        │           ├── checks.cjs
        │           ├── checks.d.cts
        │           ├── checks.d.ts
        │           ├── checks.js
        │           ├── coerce.cjs
        │           ├── coerce.d.cts
        │           ├── coerce.d.ts
        │           ├── coerce.js
        │           ├── compat.cjs
        │           ├── compat.d.cts
        │           ├── compat.d.ts
        │           ├── compat.js
        │           ├── errors.cjs
        │           ├── errors.d.cts
        │           ├── errors.d.ts
        │           ├── errors.js
        │           ├── external.cjs
        │           ├── external.d.cts
        │           ├── external.d.ts
        │           ├── external.js
        │           ├── index.cjs
        │           ├── index.d.cts
        │           ├── index.d.ts
        │           ├── index.js
        │           ├── iso.cjs
        │           ├── iso.d.cts
        │           ├── iso.d.ts
        │           ├── iso.js
        │           ├── parse.cjs
        │           ├── parse.d.cts
        │           ├── parse.d.ts
        │           ├── parse.js
        │           ├── schemas.cjs
        │           ├── schemas.d.cts
        │           ├── schemas.d.ts
        │           ├── schemas.js
        │       └── core/
        │           ├── api.cjs
        │           ├── api.d.cts
        │           ├── api.d.ts
        │           ├── api.js
        │           ├── checks.cjs
        │           ├── checks.d.cts
        │           ├── checks.d.ts
        │           ├── checks.js
        │           ├── core.cjs
        │           ├── core.d.cts
        │           ├── core.d.ts
        │           ├── core.js
        │           ├── doc.cjs
        │           ├── doc.d.cts
        │           ├── doc.d.ts
        │           ├── doc.js
        │           ├── errors.cjs
        │           ├── errors.d.cts
        │           ├── errors.d.ts
        │           ├── errors.js
        │           ├── function.cjs
        │           ├── function.d.cts
        │           ├── function.d.ts
        │           ├── function.js
        │           ├── index.cjs
        │           ├── index.d.cts
        │           ├── index.d.ts
        │           ├── index.js
        │           ├── json-schema.cjs
        │           ├── json-schema.d.cts
        │           ├── json-schema.d.ts
        │           ├── json-schema.js
        │           ├── parse.cjs
        │           ├── parse.d.cts
        │           ├── parse.d.ts
        │           ├── parse.js
        │           ├── regexes.cjs
        │           ├── regexes.d.cts
        │           ├── regexes.d.ts
        │           ├── regexes.js
        │           ├── registries.cjs
        │           ├── registries.d.cts
        │           ├── registries.d.ts
        │           ├── registries.js
        │           ├── schemas.cjs
        │           ├── schemas.d.cts
        │           ├── schemas.d.ts
        │           ├── schemas.js
        │           ├── standard-schema.cjs
        │           ├── standard-schema.d.cts
        │           ├── standard-schema.d.ts
        │           ├── standard-schema.js
        │           ├── to-json-schema.cjs
        │           ├── to-json-schema.d.cts
        │           ├── to-json-schema.d.ts
        │           ├── to-json-schema.js
        │           ├── util.cjs
        │           ├── util.d.cts
        │           ├── util.d.ts
        │           ├── util.js
        │           ├── versions.cjs
        │           ├── versions.d.cts
        │           ├── versions.d.ts
        │           ├── versions.js
        │       └── index.cjs
        │       └── index.d.cts
        │       └── index.d.ts
        │       └── index.js
        │       └── locales/
        │           ├── ar.cjs
        │           ├── ar.d.cts
        │           ├── ar.d.ts
        │           ├── ar.js
        │           ├── az.cjs
        │           ├── az.d.cts
        │           ├── az.d.ts
        │           ├── az.js
        │           ├── be.cjs
        │           ├── be.d.cts
        │           ├── be.d.ts
        │           ├── be.js
        │           ├── ca.cjs
        │           ├── ca.d.cts
        │           ├── ca.d.ts
        │           ├── ca.js
        │           ├── cs.cjs
        │           ├── cs.d.cts
        │           ├── cs.d.ts
        │           ├── cs.js
        │           ├── de.cjs
        │           ├── de.d.cts
        │           ├── de.d.ts
        │           ├── de.js
        │           ├── en.cjs
        │           ├── en.d.cts
        │           ├── en.d.ts
        │           ├── en.js
        │           ├── eo.cjs
        │           ├── eo.d.cts
        │           ├── eo.d.ts
        │           ├── eo.js
        │           ├── es.cjs
        │           ├── es.d.cts
        │           ├── es.d.ts
        │           ├── es.js
        │           ├── fa.cjs
        │           ├── fa.d.cts
        │           ├── fa.d.ts
        │           ├── fa.js
        │           ├── fi.cjs
        │           ├── fi.d.cts
        │           ├── fi.d.ts
        │           ├── fi.js
        │           ├── fr-CA.cjs
        │           ├── fr-CA.d.cts
        │           ├── fr-CA.d.ts
        │           ├── fr-CA.js
        │           ├── fr.cjs
        │           ├── fr.d.cts
        │           ├── fr.d.ts
        │           ├── fr.js
        │           ├── he.cjs
        │           ├── he.d.cts
        │           ├── he.d.ts
        │           ├── he.js
        │           ├── hu.cjs
        │           ├── hu.d.cts
        │           ├── hu.d.ts
        │           ├── hu.js
        │           ├── id.cjs
        │           ├── id.d.cts
        │           ├── id.d.ts
        │           ├── id.js
        │           ├── index.cjs
        │           ├── index.d.cts
        │           ├── index.d.ts
        │           ├── index.js
        │           ├── it.cjs
        │           ├── it.d.cts
        │           ├── it.d.ts
        │           ├── it.js
        │           ├── ja.cjs
        │           ├── ja.d.cts
        │           ├── ja.d.ts
        │           ├── ja.js
        │           ├── kh.cjs
        │           ├── kh.d.cts
        │           ├── kh.d.ts
        │           ├── kh.js
        │           ├── ko.cjs
        │           ├── ko.d.cts
        │           ├── ko.d.ts
        │           ├── ko.js
        │           ├── mk.cjs
        │           ├── mk.d.cts
        │           ├── mk.d.ts
        │           ├── mk.js
        │           ├── ms.cjs
        │           ├── ms.d.cts
        │           ├── ms.d.ts
        │           ├── ms.js
        │           ├── nl.cjs
        │           ├── nl.d.cts
        │           ├── nl.d.ts
        │           ├── nl.js
        │           ├── no.cjs
        │           ├── no.d.cts
        │           ├── no.d.ts
        │           ├── no.js
        │           ├── ota.cjs
        │           ├── ota.d.cts
        │           ├── ota.d.ts
        │           ├── ota.js
        │           ├── pl.cjs
        │           ├── pl.d.cts
        │           ├── pl.d.ts
        │           ├── pl.js
        │           ├── ps.cjs
        │           ├── ps.d.cts
        │           ├── ps.d.ts
        │           ├── ps.js
        │           ├── pt.cjs
        │           ├── pt.d.cts
        │           ├── pt.d.ts
        │           ├── pt.js
        │           ├── ru.cjs
        │           ├── ru.d.cts
        │           ├── ru.d.ts
        │           ├── ru.js
        │           ├── sl.cjs
        │           ├── sl.d.cts
        │           ├── sl.d.ts
        │           ├── sl.js
        │           ├── sv.cjs
        │           ├── sv.d.cts
        │           ├── sv.d.ts
        │           ├── sv.js
        │           ├── ta.cjs
        │           ├── ta.d.cts
        │           ├── ta.d.ts
        │           ├── ta.js
        │           ├── th.cjs
        │           ├── th.d.cts
        │           ├── th.d.ts
        │           ├── th.js
        │           ├── tr.cjs
        │           ├── tr.d.cts
        │           ├── tr.d.ts
        │           ├── tr.js
        │           ├── ua.cjs
        │           ├── ua.d.cts
        │           ├── ua.d.ts
        │           ├── ua.js
        │           ├── ur.cjs
        │           ├── ur.d.cts
        │           ├── ur.d.ts
        │           ├── ur.js
        │           ├── vi.cjs
        │           ├── vi.d.cts
        │           ├── vi.d.ts
        │           ├── vi.js
        │           ├── zh-CN.cjs
        │           ├── zh-CN.d.cts
        │           ├── zh-CN.d.ts
        │           ├── zh-CN.js
        │           ├── zh-TW.cjs
        │           ├── zh-TW.d.cts
        │           ├── zh-TW.d.ts
        │           ├── zh-TW.js
        │       └── mini/
        │           └── checks.cjs
        │           └── checks.d.cts
        │           └── checks.d.ts
        │           └── checks.js
        │           └── coerce.cjs
        │           └── coerce.d.cts
        │           └── coerce.d.ts
        │           └── coerce.js
        │           └── external.cjs
        │           └── external.d.cts
        │           └── external.d.ts
        │           └── external.js
        │           └── index.cjs
        │           └── index.d.cts
        │           └── index.d.ts
        │           └── index.js
        │           └── iso.cjs
        │           └── iso.d.cts
        │           └── iso.d.ts
        │           └── iso.js
        │           └── parse.cjs
        │           └── parse.d.cts
        │           └── parse.d.ts
        │           └── parse.js
        │           └── schemas.cjs
        │           └── schemas.d.cts
        │           └── schemas.d.ts
        │           └── schemas.js
    └── package-lock.json
    └── package.json
    └── scripts/
        ├── sync-version.js
    └── src/
        ├── gui/
        │   ├── auto-archive.ts
        │   ├── config.ts
        ├── index.ts
        ├── schema/
        │   ├── enums.ts
        │   ├── project-meta.ts
        │   ├── root-index.ts
        │   ├── validators.ts
        │   ├── work-package.ts
        │   ├── workflow-manifest-schema.ts
        ├── storage/
        │   ├── atomic-writer.ts
        │   ├── file-lock.ts
        │   ├── ledger-store.ts
        ├── tools/
        │   ├── begin-work.ts
        │   ├── help-content.ts
        │   ├── help.ts
        │   ├── observations.ts
        │   ├── pipeline.ts
        │   ├── project-lifecycle.ts
        │   ├── work-package.ts
        │   ├── workflow-handoff.ts
        │   ├── workflow-next-action-batch.ts
        │   ├── workflow-next-action.ts
        │   ├── workflow.ts
        ├── utils/
        │   └── agent-registry.ts
        │   └── constants.ts
        │   └── if-defined.ts
        │   └── ledger-root.ts
        │   └── path-validator.ts
        │   └── pipeline-maps.ts
        │   └── project-reset.ts
        │   └── read-project-name.ts
        │   └── timestamp.ts
        │   └── workflow-helpers.ts
        │   └── wp-id.ts
    └── storage/
        ├── ledger/
        │   └── 2026-02-23-extend-build-system-vanilla-standalone/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── project-ledger.json
        │   └── 2026-02-23-frame-style-reference/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-23-multi-ide-persona-support/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── project-ledger.json
        │   └── 2026-02-23-strategic-recommendations-gn1-gn6/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-23-strategic-recommendations-gna-gnc/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-23-synthesis-strategic-recommendations/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── project-ledger.json
        │   └── 2026-02-24-gui-insights-overview/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── project-ledger.json
        │   └── 2026-02-24-hubl-high-feasibility/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-24-modules-overview-generator-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-24-modules-overview-generator-rework-2/
        │       ├── WP-001.json
        │       ├── project-ledger.json
        │   └── 2026-02-24-modules-overview-generator/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── project-ledger.json
        │   └── 2026-02-25-orchestrator-smoke-test-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── project-ledger.json
        │   └── 2026-02-25-orchestrator-smoke-test/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── project-ledger.json
        │   └── 2026-02-25-workflow-specification-audit-fixes/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-25-workflow-specification-audit-fixes2-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── project-ledger.json
        │   └── 2026-02-25-workflow-specification-audit-fixes2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── project-ledger.json
        │   └── 2026-02-26-comtype-source-switch-gc-cleanup-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-26-comtype-source-switch-gc-cleanup/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── project-ledger.json
        │   └── 2026-02-26-switch-comtype-variable-source/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── project-ledger.json
        │   └── 2026-02-26-switch-global-content-variable-source/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-26-workflow-spec-audit-fixes/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-27-core-algorithms/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-27-gui-enhancements/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-27-hubspot-variable-source-migration-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── project-ledger.json
        │   └── 2026-02-27-hubspot-variable-source-migration-rework-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── project-ledger.json
        │   └── 2026-02-27-hubspot-variable-source-migration/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── project-ledger.json
        │   └── 2026-02-27-perceval-phase1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-27-perceval-phase2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-27-perceval-phase3/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-27-perceval-phase4/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-27-recommendation-engine/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-27-schema-type-foundations/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-27-technical-debt-resolution/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-27-tool-guards-status-transitions/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-28-gui-api-hardening/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-28-handoff-engine/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-28-ledger-document-archiving-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-28-ledger-document-archiving/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-28-perceval-recommendations/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-28-self-healing-auxiliary/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── project-ledger.json
        │   └── 2026-02-28-synthesis-gui-link/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-02-28-synthesis-strategic-recommendations-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── project-ledger.json
        │   └── 2026-02-28-synthesis-strategic-recommendations/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── WP-009.json
        │       ├── project-ledger.json
        │   └── 2026-03-01-ledger-tool-simplification-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-01-ledger-tool-simplification-rework-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │   └── 2026-03-01-ledger-tool-simplification/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-01-module-keyword-glossary-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-01-module-keyword-glossary/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-01-synthesis-followup-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-01-synthesis-followup/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-begin-work-handoff-guard-fix/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-command-deck-housekeeping-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-command-deck-housekeeping-rework-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-command-deck-housekeeping/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-ionos-cloud-template-migration/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-move-doc-generators-to-framework/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── WP-009.json
        │       ├── WP-010.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-orchestrator-project-path-fix-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-orchestrator-project-path-fix/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-02-perceval-category-graceful-failure/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │   └── 2026-03-02-pm-wait-handoff-embedding/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-03-geshi-to-highlight-php/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-03-hubspot-portal-id-api-fetch/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-03-openapi-spec-generation/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── WP-009.json
        │       ├── WP-010.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-04-export-communication-category-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-04-export-communication-category/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-04-openapi-post-synthesis-rework/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-04-openapi-schema-inference/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-communication-category-test-fixes/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-hubl-high-feasibility-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-hubspot-portal-id-null-fix/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-stub-newsletter-data-updater-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-stub-newsletter-data-updater-rework-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-stub-newsletter-data-updater/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-synthesis-strategic-rework/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-wp003-php84-union-type-fix/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-05-zod-refine-empty-schema/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-06-openapi-schema-inference-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-06-remove-showsnippet-from-hubl-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-06-remove-showsnippet-from-hubl-rework-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-06-remove-showsnippet-from-hubl/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-06-synthesis-gold-nuggets-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-06-synthesis-gold-nuggets/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-global-link-effective-audience-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-global-link-effective-audience/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-gold-nuggets-batch-2-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-gold-nuggets-batch-2-rework-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-gold-nuggets-batch-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-middleware-credential-hardening/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-perceval-category-filter-update/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-perceval-credentials-all-environments/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-persona-build-hardening-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-persona-build-hardening/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-persona-model-field-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-10-persona-model-field/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-11-perceval-admin-screens/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-11-perceval-compatible-flag-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-11-perceval-compatible-flag/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-12-ionos-cloud-followup-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-12-ionos-cloud-followup/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-12-ionos-cloud-layout-template/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-12-persona-model-field-rework/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-12-setup-script/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-13-api-caching-core-rework-1-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-13-api-caching-core-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-13-api-caching-core/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-17-consolidate-wp-writes-followup-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-17-consolidate-wp-writes-followup/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-17-consolidate-wp-writes/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-17-spec-sync-v2.3-v2.4-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-17-spec-sync-v2.3-v2.4/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-18-api-caching-synthesis-followup/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-18-shared-role-manifest-rework-1/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-18-shared-role-manifest-rework-2/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── WP-008.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-18-shared-role-manifest-rework-3/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-18-shared-role-manifest-rework-4/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-18-shared-role-manifest/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-18-spec-sync-fixes/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-19-api-caching-post-synthesis-cleanup/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-19-followup-fixes/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │   └── 2026-03-19-mcp-servers-frontmatter/
        │       ├── WP-001.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │   └── 2026-03-19-parse-attr-dump-tests/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis-report.md
        │       ├── synthesis.md
        │   └── 2026-03-19-php84-modernization/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-19-phpunit-migration/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-19-shared-role-manifest-rework-5/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-19-workflow-orchestrator-persona/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── 2026-03-20-synthesis-followups/
        │       ├── WP-001.json
        │       ├── WP-002.json
        │       ├── WP-003.json
        │       ├── WP-004.json
        │       ├── WP-005.json
        │       ├── WP-006.json
        │       ├── WP-007.json
        │       ├── plan.md
        │       ├── project-ledger.json
        │       ├── synthesis.md
        │   └── gui-config.json
    └── tests/
        ├── gui/
        │   ├── api-reset.test.ts
        │   ├── api-wp-overview.test.ts
        │   ├── api.test.ts
        │   ├── auto-archive.test.ts
        │   ├── client-rendering.test.ts
        │   ├── config.test.ts
        │   ├── handoff-config-integration.test.ts
        ├── helpers/
        │   ├── create-temp-store.ts
        │   ├── fixtures.ts
        │   ├── test-utils.ts
        ├── integration/
        │   ├── auto-handoff.test.ts
        │   ├── full-workflow.test.ts
        ├── schema/
        │   ├── project-archiving-schema.test.ts
        │   ├── root-index.test.ts
        │   ├── validators.test.ts
        │   ├── work-package-schema.test.ts
        ├── storage/
        │   ├── ledger-store.test.ts
        │   ├── project-meta.test.ts
        ├── tools/
        │   ├── begin-work.test.ts
        │   ├── cancelled-status.test.ts
        │   ├── cascade-reblock.test.ts
        │   ├── claim-guard.test.ts
        │   ├── complete-pipeline-guards.test.ts
        │   ├── enrichment-resilience.test.ts
        │   ├── list-projects.test.ts
        │   ├── meta-enrichment.test.ts
        │   ├── observations.test.ts
        │   ├── pipeline.test.ts
        │   ├── project-lifecycle.test.ts
        │   ├── rework-circuit-breaker.test.ts
        │   ├── schema-integrity.test.ts
        │   ├── start-pipeline-guards.test.ts
        │   ├── synthesis-terminal.test.ts
        │   ├── work-package.test.ts
        │   ├── workflow-batch-actions.test.ts
        │   ├── workflow-handoff.test.ts
        │   ├── workflow-next-action.test.ts
        │   ├── workflow-rework-loop.test.ts
        ├── utils/
        │   └── agent-registry.test.ts
        │   └── if-defined.test.ts
        │   └── ledger-root.test.ts
        │   └── path-validator.test.ts
        │   └── pipeline-maps.test.ts
        │   └── project-reset.test.ts
        │   └── timestamp.test.ts
        │   └── workflow-helpers.test.ts
        │   └── workflow-manifest.test.ts
        │   └── wp-id.test.ts
    └── tsconfig.json
    └── vitest.config.ts

```