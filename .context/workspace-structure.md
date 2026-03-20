# AI Insights - Workspace Structure
_SOURCE: Top-level directory tree_
# Top-level directory tree
###  
```
└── AGENTS.md
└── CLAUDE.md
└── README.md
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
    │   ├── bidi-js/
    │   │   ├── LICENSE.txt
    │   │   ├── README.md
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
    │   ├── css-tree/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── data-urls/
    │   │   ├── LICENSE.txt
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── debug/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── decimal.js/
    │   │   ├── LICENCE.md
    │   │   ├── README.md
    │   │   ├── decimal.d.ts
    │   │   ├── decimal.js
    │   │   ├── decimal.mjs
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
    │   ├── entities/
    │   │   ├── LICENSE/
    │   │   ├── decode.d.ts
    │   │   ├── decode.js
    │   │   ├── escape.d.ts
    │   │   ├── escape.js
    │   │   ├── package.json
    │   │   ├── readme.md
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
    │   ├── html-encoding-sniffer/
    │   │   ├── LICENSE.txt
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
    │   ├── is-potential-custom-element-name/
    │   │   ├── LICENSE-MIT.txt
    │   │   ├── README.md
    │   │   ├── index.js
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
    │   ├── jsdom/
    │   │   ├── LICENSE.txt
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
    │   ├── lru-cache/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
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
    │   ├── mdn-data/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
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
    │   ├── parse5/
    │   │   ├── LICENSE/
    │   │   ├── README.md
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
    │   ├── punycode/
    │   │   ├── LICENSE-MIT.txt
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── punycode.es6.js
    │   │   ├── punycode.js
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
    │   ├── saxes/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── saxes.d.ts
    │   │   ├── saxes.js
    │   │   ├── saxes.js.map
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
    │   ├── symbol-tree/
    │   │   ├── LICENSE/
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
    │   ├── tldts-core/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.ts
    │   │   ├── package.json
    │   ├── tldts/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.ts
    │   │   ├── package.json
    │   ├── toidentifier/
    │   │   ├── HISTORY.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   ├── tough-cookie/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── tr46/
    │   │   ├── LICENSE.md
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
    │   ├── undici/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── index-fetch.js
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── package.json
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
    │   ├── w3c-xmlserializer/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── webidl-conversions/
    │   │   ├── LICENSE.md
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── whatwg-mimetype/
    │   │   ├── LICENSE.txt
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── whatwg-url/
    │   │   ├── LICENSE.txt
    │   │   ├── README.md
    │   │   ├── index.js
    │   │   ├── package.json
    │   │   ├── webidl2js-wrapper.js
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
    │   ├── xml-name-validator/
    │   │   ├── LICENSE.txt
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── xmlchars/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── xmlchars.d.ts
    │   │   ├── xmlchars.js
    │   │   ├── xmlchars.js.map
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
└── node_modules/
    ├── @jridgewell/
    │   ├── sourcemap-codec/
    │   │   └── LICENSE/
    │   │   └── README.md
    │   │   └── package.json
    ├── @oxc-project/
    │   ├── runtime/
    │   │   ├── CHANGELOG.md
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── types/
    │   │   └── LICENSE/
    │   │   └── README.md
    │   │   └── package.json
    │   │   └── types.d.ts
    ├── @rolldown/
    │   ├── binding-win32-x64-msvc/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── rolldown-binding.win32-x64-msvc.node
    │   ├── pluginutils/
    │   │   └── LICENSE/
    │   │   └── README.md
    │   │   └── package.json
    ├── @standard-schema/
    │   ├── spec/
    │   │   └── LICENSE/
    │   │   └── README.md
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
    │   │   └── LICENSE/
    │   │   └── README.md
    │   │   └── flow.d.ts
    │   │   └── index.d.ts
    │   │   └── package.json
    ├── @vitest/
    │   ├── expect/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── mocker/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── pretty-format/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── runner/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   │   ├── types.d.ts
    │   │   ├── utils.d.ts
    │   ├── snapshot/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── environment.d.ts
    │   │   ├── manager.d.ts
    │   │   ├── package.json
    │   ├── spy/
    │   │   ├── LICENSE/
    │   │   ├── README.md
    │   │   ├── package.json
    │   ├── utils/
    │   │   └── LICENSE/
    │   │   └── README.md
    │   │   └── diff.d.ts
    │   │   └── error.d.ts
    │   │   └── helpers.d.ts
    │   │   └── package.json
    ├── assertion-error/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── index.d.ts
    │   ├── index.js
    │   ├── package.json
    ├── chai/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── index.js
    │   ├── package.json
    │   ├── register-assert.js
    │   ├── register-expect.js
    │   ├── register-should.js
    ├── convert-source-map/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── index.js
    │   ├── package.json
    ├── detect-libc/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── index.d.ts
    │   ├── lib/
    │   │   ├── detect-libc.js
    │   │   ├── elf.js
    │   │   ├── filesystem.js
    │   │   ├── process.js
    │   ├── package.json
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
    ├── fdir/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── dist/
    │   │   ├── index.cjs
    │   │   ├── index.d.cts
    │   │   ├── index.d.mts
    │   │   ├── index.mjs
    │   ├── package.json
    ├── lightningcss-win32-x64-msvc/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── lightningcss.win32-x64-msvc.node
    │   ├── package.json
    ├── lightningcss/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── node/
    │   │   ├── ast.d.ts
    │   │   ├── ast.js.flow
    │   │   ├── browserslistToTargets.js
    │   │   ├── composeVisitors.js
    │   │   ├── flags.js
    │   │   ├── index.d.ts
    │   │   ├── index.js
    │   │   ├── index.js.flow
    │   │   ├── index.mjs
    │   │   ├── targets.d.ts
    │   │   ├── targets.js.flow
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
    ├── pathe/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── dist/
    │   │   ├── index.cjs
    │   │   ├── index.d.cts
    │   │   ├── index.d.mts
    │   │   ├── index.d.ts
    │   │   ├── index.mjs
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
    ├── rolldown/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── bin/
    │   │   ├── cli.mjs
    │   ├── dist/
    │   │   ├── cli.d.mts
    │   │   ├── cli.mjs
    │   │   ├── config.d.mts
    │   │   ├── config.mjs
    │   │   ├── experimental-index.d.mts
    │   │   ├── experimental-index.mjs
    │   │   ├── experimental-runtime-types.d.ts
    │   │   ├── filter-index.d.mts
    │   │   ├── filter-index.mjs
    │   │   ├── get-log-filter.d.mts
    │   │   ├── get-log-filter.mjs
    │   │   ├── index.d.mts
    │   │   ├── index.mjs
    │   │   ├── parallel-plugin-worker.d.mts
    │   │   ├── parallel-plugin-worker.mjs
    │   │   ├── parallel-plugin.d.mts
    │   │   ├── parallel-plugin.mjs
    │   │   ├── parse-ast-index.d.mts
    │   │   ├── parse-ast-index.mjs
    │   │   ├── plugins-index.d.mts
    │   │   ├── plugins-index.mjs
    │   │   ├── utils-index.d.mts
    │   │   ├── utils-index.mjs
    │   ├── package.json
    ├── siginfo/
    │   ├── LICENSE/
    │   ├── README.md
    │   ├── index.js
    │   ├── package.json
    │   ├── test.js
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
    ├── std-env/
    │   ├── LICENCE/
    │   ├── README.md
    │   ├── dist/
    │   │   ├── index.d.mts
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
    │   │   ├── LICENSES.txt
    │   │   ├── main.d.mts
    │   │   ├── main.mjs
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
    ├── vite/
    │   ├── LICENSE.md
    │   ├── README.md
    │   ├── bin/
    │   │   ├── openChrome.js
    │   │   ├── vite.js
    │   ├── client.d.ts
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
    │   │   └── metadata.d.ts
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
    │   │   ├── module-evaluator.d.ts
    │   │   ├── module-evaluator.js
    │   │   ├── node.d.ts
    │   │   ├── node.js
    │   │   ├── nodejs-worker-loader.js
    │   │   ├── path.js
    │   │   ├── reporters.d.ts
    │   │   ├── reporters.js
    │   │   ├── runners.d.ts
    │   │   ├── runners.js
    │   │   ├── runtime.d.ts
    │   │   ├── runtime.js
    │   │   ├── snapshot.d.ts
    │   │   ├── snapshot.js
    │   │   ├── spy.js
    │   │   ├── suite.d.ts
    │   │   ├── suite.js
    │   │   ├── worker.d.ts
    │   │   ├── worker.js
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
    ├── why-is-node-running/
    │   └── LICENSE/
    │   └── README.md
    │   └── cli.js
    │   └── example.js
    │   └── include.js
    │   └── index.js
    │   └── package.json
└── orchestrator/
    ├── README.md
    ├── changelog.md
    ├── docs/
    │   ├── architecture.md
    │   ├── jsonl-log-schema.md
    │   ├── public-api.md
    │   ├── smoke-testing.md
    │   ├── supervisor-routing.md
    ├── module-context.yaml
    ├── pyproject.toml
    ├── requirements.txt
    ├── src/
    │   ├── __init__.py
    │   ├── __pycache__/
    │   │   ├── __init__.cpython-313.pyc
    │   │   ├── cli.cpython-313.pyc
    │   │   ├── config.cpython-313.pyc
    │   │   ├── graph.cpython-313.pyc
    │   │   ├── mcp_client.cpython-313.pyc
    │   │   ├── state.cpython-313.pyc
    │   │   ├── supervisor.cpython-313.pyc
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
    │       ├── __init__.cpython-313.pyc
    │       ├── test_cli.cpython-313-pytest-9.0.2.pyc
    │       ├── test_graph.cpython-313-pytest-9.0.2.pyc
    │       ├── test_integration.cpython-313-pytest-9.0.2.pyc
    │       ├── test_nodes.cpython-313-pytest-9.0.2.pyc
    │       ├── test_plan_parser.cpython-313-pytest-9.0.2.pyc
    │       ├── test_state.cpython-313-pytest-9.0.2.pyc
    │       ├── test_supervisor.cpython-313-pytest-9.0.2.pyc
    │       ├── test_tool_wrappers.cpython-313-pytest-9.0.2.pyc
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