## Documentation Scope

A fact does not stay in the manifest. It is copied into the README, restated in `AGENTS.md`, drawn into a diagram, and repeated in a concepts document — and every copy drifts on its own schedule. A pass bounded by the manifest directory therefore corrects one instance of a wrong fact and leaves the others in place, still being read.

The scope is the manifest plus four things around it. All five rows are resolved into an explicit file list before anything is read, by command rather than from memory: a scope assembled by recalling which documents matter reproduces the previous pass's list, and the document that goes missing is the one no pass has looked at yet — which is where the findings are.

| Scope | What it covers | Resolved by |
|---|---|---|
| **The manifest** | Every document under the manifest directory | Listing the manifest directory |
| **The change set** | Every document touched by the commits this pass covers | A name-only diff over the range this pass covers |
| **Routed documents** | Every document the root `AGENTS.md` links or routes readers to | Extracting every document path `AGENTS.md` links to or names in a lookup rule, including paths inside routing tables and "check X first" directives |
| **Diagrams** | Any `.puml`, `.dot`, `.mermaid`, or equivalent that names a class, module, or path | A file listing filtered to diagram extensions |
| **Class-naming documents** | Any remaining document that names a class, module, or symbol — a concepts document, an architecture note, a changelog | A repository-wide documentation listing, less the rows above |

Widening the read surface does not make every document in it yours to reshape. {{scope_write_surface}}

The class-existence check runs across all of it — every class named anywhere in the scope goes against `git ls-files` or an equivalent listing, not only the ones annotated in the file tree. A deleted class keeps its mentions in the diagram and the concepts document long after the file tree drops it.

### Routing

{{> documentation-ownership}}

### What Counts as a Finding

| Document | What counts |
|---|---|
| `AGENTS.md` | A manifest document listed that no longer exists, or one that exists and is unlisted; a described document whose stated contents no longer match; a manifest path that has moved; a lookup rule routing readers to a document that was removed or merged; a codebase fact no manifest document states, or one the manifest states differently; a Project Stats entry `tech-stack.md` states differently |
| `README.md` | A link into the manifest directory that no longer resolves; a project fact — stack, runtime, entry point, structure — contradicted by the manifest; a count, tally, or inventory the manifest deliberately omits; a described capability the manifest shows no longer exists |
| Any other document in scope | A class, path, or symbol that no longer exists; a stated capability the codebase does not have; a literal value contradicting its source-of-truth file; a claim the manifest states differently |

The last two `AGENTS.md` items mirror the AGENTS.md Curator's own boundary rule: every codebase fact in that file is sourced from the manifest, and Project Stats is its one sanctioned restatement of `tech-stack.md`. That makes Project Stats the highest-drift surface between the two documents, so a divergent entry there is High severity. A fact the manifest carries nowhere is Medium.

### Constraints

- {{scope_edit_prohibition}} {{scope_finding_action}}
- {{scope_dispatch_rule}}
- Restrict the check to claims about the codebase or about the manifest. A README weakness of tone or structure, and a guide's choice of examples, belong to their own owners and are not reported here.
- Resolve the file list by command before reading anything, record both the list and the commands, and check the result against every path `AGENTS.md` routes to. A routed document missing from the list is a resolution failure, not a document out of scope.
- Report the check's outcome explicitly, naming every document in the resolved list that went uncovered — including the case where every document in scope was consistent. An omitted result is indistinguishable from a check that never ran, and a scope stated as the documents actually opened reports a narrow pass as a complete one.
- Skip a document that is absent, and say so. A project with no `AGENTS.md` is not a finding — proposing one is the AGENTS.md Curator's call.
- Never treat another document's assertion as evidence for a fact. {{unsourced_fact_action}}
