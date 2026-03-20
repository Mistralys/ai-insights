# AI Insights - Workspace Structure
_SOURCE: Top-level directory tree_
# Top-level directory tree
###  
```
└── AGENTS.md
└── CLAUDE.md
└── README.md
└── build/
    ├── notebooklm-bundle.md
    ├── workflow-specification.md
└── changelog.md
└── context.yaml
└── discussions/
    ├── 2026-02-26-ui-agentic-techniques.md
    ├── 2026-03-01-future-without-libraries.md
    ├── documentation-audit.md
    ├── loading-mcp-tools-explained.md
    ├── prompt-clarity.md
└── docs/
    ├── agents/
    │   └── implementation-history/
    │       └── README.md
└── history/
    ├── error-ledger.md
    ├── key-learnings.md
    ├── screenshots/
    │   └── 2026-02-17-qa-ledger-handoff.png
└── mcp-server/
    ├── AGENTS.md
    ├── README.md
    ├── changelog.md
    ├── dist/
    │   ├── gui/
    │   │   ├── auto-archive.d.ts
    │   │   ├── auto-archive.d.ts.map
    │   │   ├── auto-archive.js
    │   │   ├── auto-archive.js.map
    │   │   ├── config.d.ts
    │   │   ├── config.d.ts.map
    │   │   ├── config.js
    │   │   ├── config.js.map
    │   ├── index.d.ts
    │   ├── index.d.ts.map
    │   ├── index.js
    │   ├── index.js.map
    │   ├── schema/
    │   │   ├── enums.d.ts
    │   │   ├── enums.d.ts.map
    │   │   ├── enums.js
    │   │   ├── enums.js.map
    │   │   ├── project-meta.d.ts
    │   │   ├── project-meta.d.ts.map
    │   │   ├── project-meta.js
    │   │   ├── project-meta.js.map
    │   │   ├── root-index.d.ts
    │   │   ├── root-index.d.ts.map
    │   │   ├── root-index.js
    │   │   ├── root-index.js.map
    │   │   ├── validators.d.ts
    │   │   ├── validators.d.ts.map
    │   │   ├── validators.js
    │   │   ├── validators.js.map
    │   │   ├── work-package.d.ts
    │   │   ├── work-package.d.ts.map
    │   │   ├── work-package.js
    │   │   ├── work-package.js.map
    │   │   ├── workflow-manifest-schema.d.ts
    │   │   ├── workflow-manifest-schema.d.ts.map
    │   │   ├── workflow-manifest-schema.js
    │   │   ├── workflow-manifest-schema.js.map
    │   ├── storage/
    │   │   ├── atomic-writer.d.ts
    │   │   ├── atomic-writer.d.ts.map
    │   │   ├── atomic-writer.js
    │   │   ├── atomic-writer.js.map
    │   │   ├── file-lock.d.ts
    │   │   ├── file-lock.d.ts.map
    │   │   ├── file-lock.js
    │   │   ├── file-lock.js.map
    │   │   ├── ledger-store.d.ts
    │   │   ├── ledger-store.d.ts.map
    │   │   ├── ledger-store.js
    │   │   ├── ledger-store.js.map
    │   ├── tools/
    │   │   ├── begin-work.d.ts
    │   │   ├── begin-work.d.ts.map
    │   │   ├── begin-work.js
    │   │   ├── begin-work.js.map
    │   │   ├── help-content.d.ts
    │   │   ├── help-content.d.ts.map
    │   │   ├── help-content.js
    │   │   ├── help-content.js.map
    │   │   ├── help.d.ts
    │   │   ├── help.d.ts.map
    │   │   ├── help.js
    │   │   ├── help.js.map
    │   │   ├── observations.d.ts
    │   │   ├── observations.d.ts.map
    │   │   ├── observations.js
    │   │   ├── observations.js.map
    │   │   ├── pipeline.d.ts
    │   │   ├── pipeline.d.ts.map
    │   │   ├── pipeline.js
    │   │   ├── pipeline.js.map
    │   │   ├── project-lifecycle.d.ts
    │   │   ├── project-lifecycle.d.ts.map
    │   │   ├── project-lifecycle.js
    │   │   ├── project-lifecycle.js.map
    │   │   ├── work-package.d.ts
    │   │   ├── work-package.d.ts.map
    │   │   ├── work-package.js
    │   │   ├── work-package.js.map
    │   │   ├── workflow-batch-actions.d.ts
    │   │   ├── workflow-batch-actions.d.ts.map
    │   │   ├── workflow-batch-actions.js
    │   │   ├── workflow-batch-actions.js.map
    │   │   ├── workflow-handoff.d.ts
    │   │   ├── workflow-handoff.d.ts.map
    │   │   ├── workflow-handoff.js
    │   │   ├── workflow-handoff.js.map
    │   │   ├── workflow-next-action-batch.d.ts
    │   │   ├── workflow-next-action-batch.d.ts.map
    │   │   ├── workflow-next-action-batch.js
    │   │   ├── workflow-next-action-batch.js.map
    │   │   ├── workflow-next-action.d.ts
    │   │   ├── workflow-next-action.d.ts.map
    │   │   ├── workflow-next-action.js
    │   │   ├── workflow-next-action.js.map
    │   │   ├── workflow.d.ts
    │   │   ├── workflow.d.ts.map
    │   │   ├── workflow.js
    │   │   ├── workflow.js.map
    │   ├── utils/
    │   │   └── agent-registry.d.ts
    │   │   └── agent-registry.d.ts.map
    │   │   └── agent-registry.js
    │   │   └── agent-registry.js.map
    │   │   └── constants.d.ts
    │   │   └── constants.d.ts.map
    │   │   └── constants.js
    │   │   └── constants.js.map
    │   │   └── if-defined.d.ts
    │   │   └── if-defined.d.ts.map
    │   │   └── if-defined.js
    │   │   └── if-defined.js.map
    │   │   └── ledger-root.d.ts
    │   │   └── ledger-root.d.ts.map
    │   │   └── ledger-root.js
    │   │   └── ledger-root.js.map
    │   │   └── path-validator.d.ts
    │   │   └── path-validator.d.ts.map
    │   │   └── path-validator.js
    │   │   └── path-validator.js.map
    │   │   └── pipeline-maps.d.ts
    │   │   └── pipeline-maps.d.ts.map
    │   │   └── pipeline-maps.js
    │   │   └── pipeline-maps.js.map
    │   │   └── project-reset.d.ts
    │   │   └── project-reset.d.ts.map
    │   │   └── project-reset.js
    │   │   └── project-reset.js.map
    │   │   └── read-project-name.d.ts
    │   │   └── read-project-name.d.ts.map
    │   │   └── read-project-name.js
    │   │   └── read-project-name.js.map
    │   │   └── timestamp.d.ts
    │   │   └── timestamp.d.ts.map
    │   │   └── timestamp.js
    │   │   └── timestamp.js.map
    │   │   └── workflow-helpers.d.ts
    │   │   └── workflow-helpers.d.ts.map
    │   │   └── workflow-helpers.js
    │   │   └── workflow-helpers.js.map
    │   │   └── wp-id.d.ts
    │   │   └── wp-id.d.ts.map
    │   │   └── wp-id.js
    │   │   └── wp-id.js.map
    ├── gui/
    │   ├── api.ts
    │   ├── public/
    │   │   ├── api-client.js
    │   │   ├── app.js
    │   │   ├── index.html
    │   │   ├── router.js
    │   │   ├── styles.css
    │   │   ├── theme.js
    │   │   ├── utils.js
    │   ├── server.ts
    ├── module-context.yaml
    ├── node_modules/
    │   ├── accepts/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── ajv-formats/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── ajv/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── assertion-error/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── body-parser/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── bytes/
    │   │   ├── History.md
    │   │   ├── LICENSE/
    │   │   ├── Readme.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── call-bind-apply-helpers/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── actualApply.d.ts
    │   │   ├── actualApply.js
    │   │   ├── applyBind.d.ts
    │   │   ├── applyBind.js
    │   │   ├── functionApply.d.ts
    │   │   ├── functionApply.js
    │   │   ├── functionCall.d.ts
    │   │   ├── functionCall.js
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── reflectApply.d.ts
    │   │   ├── reflectApply.js
    │   │   ├── tsconfig.json
    │   ├── call-bound/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── chai/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── register-assert.js
    │   │   ├── register-expect.js
    │   │   ├── register-should.js
    │   ├── content-disposition/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── content-type/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── cookie-signature/
    │   │   ├── History.md
    │   │   ├── LICENSE/
    │   │   ├── Readme.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── cookie/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── SECURITY.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── cors/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── cross-spawn/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── debug/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── depd/
    │   │   ├── History.md
    │   │   ├── LICENSE/
    │   │   ├── Readme.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── dunder-proto/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── get.d.ts
    │   │   ├── get.js
    │   │   ├── package.json
    │   │   ├── set.d.ts
    │   │   ├── set.js
    │   │   ├── tsconfig.json
    │   ├── ee-first/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── encodeurl/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── es-define-property/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── es-errors/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── eval.d.ts
    │   │   ├── eval.js
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── range.d.ts
    │   │   ├── range.js
    │   │   ├── ref.d.ts
    │   │   ├── ref.js
    │   │   ├── syntax.d.ts
    │   │   ├── syntax.js
    │   │   ├── tsconfig.json
    │   │   ├── type.d.ts
    │   │   ├── type.js
    │   │   ├── uri.d.ts
    │   │   ├── uri.js
    │   ├── es-module-lexer/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── lexer.js
    │   │   ├── package.json
    │   ├── es-object-atoms/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── RequireObjectCoercible.d.ts
    │   │   ├── RequireObjectCoercible.js
    │   │   ├── ToObject.d.ts
    │   │   ├── ToObject.js
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── isObject.d.ts
    │   │   ├── isObject.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── esbuild/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── install.js
    │   │   ├── package.json
    │   ├── escape-html/
    │   │   ├── LICENSE/
    │   │   ├── Readme.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── estree-walker/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── etag/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── eventsource-parser/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── stream.js
    │   ├── eventsource/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── expect-type/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── SECURITY.md
    │   │   ├── package.json
    │   ├── express-rate-limit/
    │   │   ├── license.md
    │   │   ├── package.json
    │   │   ├── readme.md
    │   │   ├── tsconfig.json
    │   ├── express/
    │   │   ├── LICENSE/
    │   │   ├── Readme.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── fast-deep-equal/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── react.d.ts
    │   │   ├── react.js
    │   ├── fast-uri/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── eslint.config.js
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── fdir/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── finalhandler/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── forwarded/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── fresh/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── fsevents/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── fsevents.d.ts
    │   │   ├── fsevents.js
    │   │   ├── fsevents.node
    │   │   ├── package.json
    │   ├── function-bind/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── implementation.js
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── get-intrinsic/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── get-proto/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── Object.getPrototypeOf.d.ts
    │   │   ├── Object.getPrototypeOf.js
    │   │   ├── README.md
    │   │   ├── Reflect.getPrototypeOf.d.ts
    │   │   ├── Reflect.getPrototypeOf.js
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── get-tsconfig/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── gopd/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── gOPD.d.ts
    │   │   ├── gOPD.js
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── graceful-fs/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── clone.js
    │   │   ├── graceful-fs.js
    │   │   ├── legacy-streams.js
    │   │   ├── package.json
    │   │   ├── polyfills.js
    │   ├── has-symbols/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── shams.d.ts
    │   │   ├── shams.js
    │   │   ├── tsconfig.json
    │   ├── hasown/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── hono/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── http-errors/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── iconv-lite/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── inherits/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── inherits.js
    │   │   ├── inherits_browser.js
    │   │   ├── package.json
    │   ├── ip-address/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── ipaddr.js/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── ipaddr.min.js
    │   │   ├── package.json
    │   ├── is-promise/
    │   │   ├── LICENSE/
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── index.mjs
    │   │   ├── package.json
    │   │   ├── readme.md
    │   ├── isexe/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── mode.js
    │   │   ├── package.json
    │   │   ├── windows.js
    │   ├── jose/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── json-schema-traverse/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── json-schema-typed/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── draft_07.d.ts
    │   │   ├── draft_07.js
    │   │   ├── draft_2019_09.d.ts
    │   │   ├── draft_2019_09.js
    │   │   ├── draft_2020_12.d.ts
    │   │   ├── draft_2020_12.js
    │   │   ├── package.json
    │   ├── magic-string/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── math-intrinsics/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── abs.d.ts
    │   │   ├── abs.js
    │   │   ├── floor.d.ts
    │   │   ├── floor.js
    │   │   ├── isFinite.d.ts
    │   │   ├── isFinite.js
    │   │   ├── isInteger.d.ts
    │   │   ├── isInteger.js
    │   │   ├── isNaN.d.ts
    │   │   ├── isNaN.js
    │   │   ├── isNegativeZero.d.ts
    │   │   ├── isNegativeZero.js
    │   │   ├── max.d.ts
    │   │   ├── max.js
    │   │   ├── min.d.ts
    │   │   ├── min.js
    │   │   ├── mod.d.ts
    │   │   ├── mod.js
    │   │   ├── package.json
    │   │   ├── pow.d.ts
    │   │   ├── pow.js
    │   │   ├── round.d.ts
    │   │   ├── round.js
    │   │   ├── sign.d.ts
    │   │   ├── sign.js
    │   │   ├── tsconfig.json
    │   ├── media-typer/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── merge-descriptors/
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── license/
    │   │   ├── package.json
    │   │   ├── readme.md
    │   ├── mime-db/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── db.json
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── mime-types/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── mimeScore.js
    │   │   ├── package.json
    │   ├── ms/
    │   │   ├── index.js
    │   │   ├── license.md
    │   │   ├── package.json
    │   │   ├── readme.md
    │   ├── nanoid/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.browser.cjs
    │   │   ├── index.browser.js
    │   │   ├── index.cjs
    │   │   ├── index.d.cts
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── nanoid.js
    │   │   ├── package.json
    │   ├── negotiator/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── object-assign/
    │   │   ├── index.js
    │   │   ├── license/
    │   │   ├── package.json
    │   │   ├── readme.md
    │   ├── object-inspect/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── index.js
    │   │   ├── package-support.json
    │   │   ├── package.json
    │   │   ├── readme.markdown
    │   │   ├── test-core-js.js
    │   │   ├── util.inspect.js
    │   ├── obug/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── on-finished/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── once/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── once.js
    │   │   ├── package.json
    │   ├── parseurl/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── path-key/
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── license/
    │   │   ├── package.json
    │   │   ├── readme.md
    │   ├── path-to-regexp/
    │   │   ├── LICENSE/
    │   │   ├── Readme.md
    │   │   ├── package.json
    │   ├── pathe/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── utils.d.ts
    │   ├── picocolors/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── picocolors.browser.js
    │   │   ├── picocolors.d.ts
    │   │   ├── picocolors.js
    │   │   ├── types.d.ts
    │   ├── picomatch/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── posix.js
    │   ├── pkce-challenge/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── postcss/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── proper-lockfile/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── proxy-addr/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── qs/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── eslint.config.mjs
    │   │   ├── package.json
    │   ├── range-parser/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── raw-body/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── require-from-string/
    │   │   ├── index.js
    │   │   ├── license/
    │   │   ├── package.json
    │   │   ├── readme.md
    │   ├── resolve-pkg-maps/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── retry/
    │   │   ├── License/
    │   │   ├── Makefile/
    │   │   ├── README.md
    │   │   ├── equation.gif
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── rollup/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── router/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── safer-buffer/
    │   │   ├── LICENSE/
    │   │   ├── Porting-Buffer.md
    │   │   ├── Readme.md
    │   │   ├── dangerous.js
    │   │   ├── package.json
    │   │   ├── safer.js
    │   │   ├── tests.js
    │   ├── send/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── serve-static/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── setprototypeof/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── shebang-command/
    │   │   ├── index.js
    │   │   ├── license/
    │   │   ├── package.json
    │   │   ├── readme.md
    │   ├── shebang-regex/
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── license/
    │   │   ├── package.json
    │   │   ├── readme.md
    │   ├── side-channel-list/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── list.d.ts
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── side-channel-map/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── side-channel-weakmap/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── side-channel/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── tsconfig.json
    │   ├── siginfo/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── test.js
    │   ├── signal-exit/
    │   │   ├── LICENSE.txt
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── signals.js
    │   ├── source-map-js/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── source-map.d.ts
    │   │   ├── source-map.js
    │   ├── stackback/
    │   │   ├── README.md
    │   │   ├── formatstack.js
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── test.js
    │   ├── statuses/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── codes.json
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── std-env/
    │   │   ├── LICENCE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── tinybench/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── tinyexec/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── tinyglobby/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── tinyrainbow/
    │   │   ├── LICENCE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── toidentifier/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── tsx/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── type-is/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── typescript/
    │   │   ├── LICENSE.txt
    │   │   ├── README.md
    │   │   ├── SECURITY.md
    │   │   ├── ThirdPartyNoticeText.txt
    │   │   ├── package.json
    │   ├── undici-types/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── agent.d.ts
    │   │   ├── api.d.ts
    │   │   ├── balanced-pool.d.ts
    │   │   ├── cache.d.ts
    │   │   ├── client.d.ts
    │   │   ├── connector.d.ts
    │   │   ├── content-type.d.ts
    │   │   ├── cookies.d.ts
    │   │   ├── diagnostics-channel.d.ts
    │   │   ├── dispatcher.d.ts
    │   │   ├── env-http-proxy-agent.d.ts
    │   │   ├── errors.d.ts
    │   │   ├── eventsource.d.ts
    │   │   ├── fetch.d.ts
    │   │   ├── file.d.ts
    │   │   ├── filereader.d.ts
    │   │   ├── formdata.d.ts
    │   │   ├── global-dispatcher.d.ts
    │   │   ├── global-origin.d.ts
    │   │   ├── handlers.d.ts
    │   │   ├── header.d.ts
    │   │   ├── index.d.ts
    │   │   ├── interceptors.d.ts
    │   │   ├── mock-agent.d.ts
    │   │   ├── mock-client.d.ts
    │   │   ├── mock-errors.d.ts
    │   │   ├── mock-interceptor.d.ts
    │   │   ├── mock-pool.d.ts
    │   │   ├── package.json
    │   │   ├── patch.d.ts
    │   │   ├── pool-stats.d.ts
    │   │   ├── pool.d.ts
    │   │   ├── proxy-agent.d.ts
    │   │   ├── readable.d.ts
    │   │   ├── retry-agent.d.ts
    │   │   ├── retry-handler.d.ts
    │   │   ├── util.d.ts
    │   │   ├── webidl.d.ts
    │   │   ├── websocket.d.ts
    │   ├── unpipe/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── vary/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── vite/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── client.d.ts
    │   │   ├── package.json
    │   ├── vitest/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── config.d.ts
    │   │   ├── coverage.d.ts
    │   │   ├── environments.d.ts
    │   │   ├── globals.d.ts
    │   │   ├── import-meta.d.ts
    │   │   ├── importMeta.d.ts
    │   │   ├── index.cjs
    │   │   ├── index.d.cts
    │   │   ├── jsdom.d.ts
    │   │   ├── mocker.d.ts
    │   │   ├── node.d.ts
    │   │   ├── optional-types.d.ts
    │   │   ├── package.json
    │   │   ├── reporters.d.ts
    │   │   ├── runners.d.ts
    │   │   ├── snapshot.d.ts
    │   │   ├── suite.d.ts
    │   │   ├── suppress-warnings.cjs
    │   │   ├── vitest.mjs
    │   │   ├── worker.d.ts
    │   ├── which/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── which.js
    │   ├── why-is-node-running/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── cli.js
    │   │   ├── example.js
    │   │   ├── include.js
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── wrappy/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── wrappy.js
    │   ├── zod-to-json-schema/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── changelog.md
    │   │   ├── contributing.md
    │   │   ├── createIndex.ts
    │   │   ├── package.json
    │   │   ├── postcjs.ts
    │   │   ├── postesm.ts
    │   ├── zod/
    │   │   └── LICENSE/
    │   │   └── README.md
    │   │   └── index.cjs
    │   │   └── index.d.cts
    │   │   └── index.d.ts
    │   │   └── index.js
    │   │   └── package.json
    ├── package-lock.json
    ├── package.json
    ├── scripts/
    │   ├── sync-version.js
    ├── src/
    │   ├── gui/
    │   │   ├── auto-archive.ts
    │   │   ├── config.ts
    │   ├── index.ts
    │   ├── schema/
    │   │   ├── enums.ts
    │   │   ├── project-meta.ts
    │   │   ├── root-index.ts
    │   │   ├── validators.ts
    │   │   ├── work-package.ts
    │   │   ├── workflow-manifest-schema.ts
    │   ├── storage/
    │   │   ├── atomic-writer.ts
    │   │   ├── file-lock.ts
    │   │   ├── ledger-store.ts
    │   ├── tools/
    │   │   ├── begin-work.ts
    │   │   ├── help-content.ts
    │   │   ├── help.ts
    │   │   ├── observations.ts
    │   │   ├── pipeline.ts
    │   │   ├── project-lifecycle.ts
    │   │   ├── work-package.ts
    │   │   ├── workflow-handoff.ts
    │   │   ├── workflow-next-action-batch.ts
    │   │   ├── workflow-next-action.ts
    │   │   ├── workflow.ts
    │   ├── utils/
    │   │   └── agent-registry.ts
    │   │   └── constants.ts
    │   │   └── if-defined.ts
    │   │   └── ledger-root.ts
    │   │   └── path-validator.ts
    │   │   └── pipeline-maps.ts
    │   │   └── project-reset.ts
    │   │   └── read-project-name.ts
    │   │   └── timestamp.ts
    │   │   └── workflow-helpers.ts
    │   │   └── wp-id.ts
    ├── storage/
    │   ├── ledger/
    │   │   └── gui-config.json
    ├── tests/
    │   ├── gui/
    │   │   ├── api-reset.test.ts
    │   │   ├── api-wp-overview.test.ts
    │   │   ├── api.test.ts
    │   │   ├── auto-archive.test.ts
    │   │   ├── client-rendering.test.ts
    │   │   ├── config.test.ts
    │   │   ├── handoff-config-integration.test.ts
    │   ├── helpers/
    │   │   ├── create-temp-store.ts
    │   │   ├── fixtures.ts
    │   │   ├── test-utils.ts
    │   ├── integration/
    │   │   ├── auto-handoff.test.ts
    │   │   ├── full-workflow.test.ts
    │   ├── schema/
    │   │   ├── project-archiving-schema.test.ts
    │   │   ├── root-index.test.ts
    │   │   ├── validators.test.ts
    │   │   ├── work-package-schema.test.ts
    │   ├── storage/
    │   │   ├── ledger-store.test.ts
    │   │   ├── project-meta.test.ts
    │   ├── tools/
    │   │   ├── begin-work.test.ts
    │   │   ├── cancelled-status.test.ts
    │   │   ├── cascade-reblock.test.ts
    │   │   ├── claim-guard.test.ts
    │   │   ├── complete-pipeline-guards.test.ts
    │   │   ├── enrichment-resilience.test.ts
    │   │   ├── list-projects.test.ts
    │   │   ├── meta-enrichment.test.ts
    │   │   ├── observations.test.ts
    │   │   ├── pipeline.test.ts
    │   │   ├── project-lifecycle.test.ts
    │   │   ├── rework-circuit-breaker.test.ts
    │   │   ├── schema-integrity.test.ts
    │   │   ├── start-pipeline-guards.test.ts
    │   │   ├── synthesis-terminal.test.ts
    │   │   ├── work-package.test.ts
    │   │   ├── workflow-batch-actions.test.ts
    │   │   ├── workflow-handoff.test.ts
    │   │   ├── workflow-next-action.test.ts
    │   │   ├── workflow-rework-loop.test.ts
    │   ├── utils/
    │   │   └── agent-registry.test.ts
    │   │   └── if-defined.test.ts
    │   │   └── ledger-root.test.ts
    │   │   └── path-validator.test.ts
    │   │   └── pipeline-maps.test.ts
    │   │   └── project-reset.test.ts
    │   │   └── timestamp.test.ts
    │   │   └── workflow-helpers.test.ts
    │   │   └── workflow-manifest.test.ts
    │   │   └── wp-id.test.ts
    ├── tsconfig.json
    ├── vitest.config.ts
└── orchestrator/
    ├── README.md
    ├── ai_insights_orchestrator.egg-info/
    │   ├── PKG-INFO/
    │   ├── SOURCES.txt
    │   ├── dependency_links.txt
    │   ├── entry_points.txt
    │   ├── requires.txt
    │   ├── top_level.txt
    ├── changelog.md
    ├── checkpoints/
    │   ├── test/
    │   │   ├── workflow.sqlite
    │   ├── workflow.sqlite
    ├── docs/
    │   ├── architecture.md
    │   ├── jsonl-log-schema.md
    │   ├── public-api.md
    │   ├── smoke-testing.md
    │   ├── supervisor-routing.md
    ├── logs/
    │   ├── 20260225T113355-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T113428-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T113453-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T113615-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T113646-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T113659-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T114154-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T114221-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T123200-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260225T124109-2026-02-25-orchestrator-smoke-test.jsonl
    │   ├── 20260320T120730-2026-03-20-synthesis-followups.jsonl
    │   ├── 20260320T120840-2026-03-20-synthesis-followups.jsonl
    │   ├── 20260320T121750-2026-03-20-synthesis-followups.jsonl
    │   ├── 20260320T121830-2026-03-20-synthesis-followups.jsonl
    │   ├── 20260320T121831-2026-03-20-synthesis-followups.jsonl
    │   ├── 20260320T122350-2026-03-20-synthesis-followups.jsonl
    │   ├── 20260320T133046-2026-03-20-naming-convention-sweep.jsonl
    ├── module-context.yaml
    ├── pyproject.toml
    ├── requirements.txt
    ├── src/
    │   ├── __init__.py
    │   ├── __pycache__/
    │   │   ├── __init__.cpython-314.pyc
    │   │   ├── cli.cpython-314.pyc
    │   │   ├── config.cpython-314.pyc
    │   │   ├── graph.cpython-314.pyc
    │   │   ├── mcp_client.cpython-314.pyc
    │   │   ├── state.cpython-314.pyc
    │   │   ├── supervisor.cpython-314.pyc
    │   ├── cli.py
    │   ├── config.py
    │   ├── graph.py
    │   ├── mcp_client.py
    │   ├── nodes/
    │   │   ├── __init__.py
    │   │   ├── developer.py
    │   │   ├── docs.py
    │   │   ├── pm.py
    │   │   ├── qa.py
    │   │   ├── release_engineer.py
    │   │   ├── reviewer.py
    │   │   ├── security_auditor.py
    │   │   ├── synthesis.py
    │   ├── state.py
    │   ├── supervisor.py
    │   ├── utils/
    │   │   └── __init__.py
    │   │   └── logging.py
    │   │   └── persona.py
    │   │   └── plan_parser.py
    │   │   └── tool_wrappers.py
    ├── tests/
    │   └── __init__.py
    │   └── __pycache__/
    │       ├── __init__.cpython-314.pyc
    │       ├── test_cli.cpython-314-pytest-9.0.2.pyc
    │       ├── test_config.cpython-314-pytest-9.0.2.pyc
    │       ├── test_graph.cpython-314-pytest-9.0.2.pyc
    │       ├── test_integration.cpython-314-pytest-9.0.2.pyc
    │       ├── test_nodes.cpython-314-pytest-9.0.2.pyc
    │       ├── test_plan_parser.cpython-314-pytest-9.0.2.pyc
    │       ├── test_state.cpython-314-pytest-9.0.2.pyc
    │       ├── test_supervisor.cpython-314-pytest-9.0.2.pyc
    │       ├── test_tool_wrappers.cpython-314-pytest-9.0.2.pyc
    │   └── test_cli.py
    │   └── test_config.py
    │   └── test_graph.py
    │   └── test_integration.py
    │   └── test_nodes.py
    │   └── test_plan_parser.py
    │   └── test_state.py
    │   └── test_supervisor.py
    │   └── test_tool_wrappers.py
└── package-lock.json
└── package.json
└── personas/
    ├── README.md
    ├── changelog.md
    ├── ledger/
    │   ├── README.md
    │   ├── claude-code/
    │   │   ├── 1-planner.md
    │   │   ├── 2-project-manager.md
    │   │   ├── 3-developer.md
    │   │   ├── 4-qa.md
    │   │   ├── 5-security-auditor.md
    │   │   ├── 6-reviewer.md
    │   │   ├── 7-release-engineer.md
    │   │   ├── 8-documentation.md
    │   │   ├── 9-synthesis.md
    │   ├── vs-code/
    │   │   └── 1-planner.agent.md
    │   │   └── 2-pm.agent.md
    │   │   └── 3-dev.agent.md
    │   │   └── 4-qa.agent.md
    │   │   └── 5-security-auditor.agent.md
    │   │   └── 6-reviewer.agent.md
    │   │   └── 7-release-engineer.agent.md
    │   │   └── 8-docs.agent.md
    │   │   └── 9-synthesis.agent.md
    ├── module-context.yaml
    ├── node_modules/
    │   ├── argparse/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── argparse.js
    │   │   ├── package.json
    │   ├── js-yaml/
    │   │   └── LICENSE/
    │   │   └── README.md
    │   │   └── index.js
    │   │   └── package.json
    ├── package-lock.json
    ├── package.json
    ├── shared/
    │   ├── partials/
    │   │   └── agent-roster.md
    │   │   └── developer-operational-protocol.md
    │   │   └── developer-output-format.md
    │   │   └── developer-strict-constraints.md
    │   │   └── docs-operational-protocol.md
    │   │   └── docs-output-format.md
    │   │   └── incident-logging.md
    │   │   └── planner-core-rules.md
    │   │   └── planner-output-template.md
    │   │   └── pm-output-format.md
    │   │   └── qa-operational-protocol.md
    │   │   └── qa-output-format.md
    │   │   └── release-engineer-operational-protocol.md
    │   │   └── release-engineer-output-format.md
    │   │   └── reviewer-operational-protocol.md
    │   │   └── reviewer-output-format.md
    │   │   └── security-auditor-operational-protocol.md
    │   │   └── security-auditor-output-format.md
    │   │   └── synthesis-operational-protocol.md
    │   │   └── synthesis-output-format.md
    ├── standalone/
    │   └── README.md
    │   └── claude-code/
    │       ├── agents-md-curator.md
    │       ├── changelog-curator.md
    │       ├── composer-curator.md
    │       ├── ctx-architect.md
    │       ├── dependency-sequencer.md
    │       ├── ledger-bootstrapper.md
    │       ├── manifest-curator.md
    │       ├── module-intent-architect.md
    │       ├── orchestrator-runner.md
    │       ├── pipeline-configurator.md
    │       ├── readme-curator.md
    │       ├── researcher.md
    │       ├── unit-test-auditor.md
    │       ├── whatsnew-curator.md
    │       ├── workflow-orchestrator.md
    │       ├── wp-decomposer.md
    │   └── vs-code/
    │       └── agents-md-curator.agent.md
    │       └── changelog-curator.agent.md
    │       └── composer-curator.agent.md
    │       └── ctx-architect.agent.md
    │       └── dependency-sequencer.agent.md
    │       └── ledger-bootstrapper.agent.md
    │       └── manifest-curator.agent.md
    │       └── module-intent-architect.agent.md
    │       └── orchestrator-runner.agent.md
    │       └── pipeline-configurator.agent.md
    │       └── readme-curator.agent.md
    │       └── researcher.agent.md
    │       └── unit-test-auditor.agent.md
    │       └── whatsnew-curator.agent.md
    │       └── workflow-orchestrator.agent.md
    │       └── wp-decomposer.agent.md
└── scripts/
    ├── build-personas.js
    ├── bundle-docs.js
    ├── check-known-roles.js
    ├── cli.js
    ├── extract-changelog-entry.js
    ├── install-hooks.js
    ├── lib/
    │   ├── persona-helpers.js
    ├── package-personas.js
    ├── preflight-orchestrator.js
    ├── run-gui.js
    ├── run-orchestrator.js
    ├── sync-personas.js
    ├── tests/
    │   ├── persona-helpers.test.js
    ├── validate-workflow-manifest.js
└── shared/
    ├── workflow-manifest.json
    ├── workflow-manifest.schema.json
└── vitest.config.ts

```