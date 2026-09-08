## Reference: Manifest Specification

The manifest is a set of Markdown documents with logical, descriptive filenames — never numbered. Content adapts to the project; the document set does not.

### Document Set

| Section | Filename | Contents |
|---|---|---|
| **Index** | `README.md` | A table of contents with brief descriptions and links to each section document. |
| **Tech Stack & Patterns** | `tech-stack.md` | Runtime, language version, frameworks, libraries, architectural patterns (e.g., MVVM, microservices, static services), build tools, package managers — `{no file, test, class, or dependency counts; these go stale on the next commit}`. |
| **File Tree** | `file-tree.md` | A visual directory structure with brief annotations on the non-obvious directories, and trivial or generated folders (`node_modules/`, `bin/`) collapsed. Omitted entirely for CTX-enabled projects — see *CTX Detection* below. |
| **Public API Surface** | `api-surface.md` | Public constructors, properties, and method signatures for every Service, Model, ViewModel, Controller, and equivalent — signatures only, grouped by module or namespace. |
| **Key Data Flows** | `data-flows.md` | The main interaction paths through the system, as short prose or simple diagrams (e.g., "User clicks Save → `MainViewModel.SaveCommand` → `FileService.WriteAsync()` → disk"). |
| **Constraints & Conventions** | `constraints.md` | Established rules, conventions, and non-obvious gotchas, phrased as directives — "All file I/O must be async", "Environment config is loaded from `.env` only in dev". |
| **Curation Log** | `curation-log.md` | Standing decisions settled with the user, and the dated trail of curation passes — see *The Curation Log* below. |

Additional documents fit projects that warrant them — `database-schema.md`, `authentication.md`, `deployment.md`. Use judgement.

### Register Map

Each manifest document is written in one of two voices, following the Stratified Authority principle. Of the documents above, only `constraints.md` enforces anything; the rest describe. The tonal shift between them is what marks a convention as real, so a manifest written uniformly in command voice has lost the signal rather than gained emphasis. Prose that introduces or frames a section stays descriptive even inside `constraints.md` — the command voice belongs to the conventions themselves, not to their preamble.

### CTX Detection

A `context.yaml` at the project root means the project uses the [CTX Generator](https://github.com/context-hub/generator) for automated context documentation, which already produces a comprehensive file structure. For these projects `file-tree.md` is omitted, and the CTX configuration is maintained by the **{{agent_ctx_architect}}**.

### Truth Ownership

A fact has one owner inside the manifest, exactly as it has one owner across the wider documentation set. Before writing a fact, grep for it: where another document already states it, link to that statement instead of repeating it. `data-flows.md` and `constraints.md` link to `api-surface.md` for anything mechanistic rather than restating it, because a copied fact gains a second maintainer and a second decay rate, and a reader meeting both copies cannot tell which is current.
