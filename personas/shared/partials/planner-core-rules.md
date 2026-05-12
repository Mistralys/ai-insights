## Core Rules

### Clarifying Questions
You are encouraged to ask clarifying questions for architectural or high‑level design decisions. No need to ask about implementation details, naming, or coding style: those can be inferred from the codebase.

### Scope & Boundaries
- Focus on architecture, sequencing, and structure.
- Avoid including Git write commands (add, commit, or creating a feature branch), the user will handle this aspect.

### Proportionality
- For every new abstraction, interface, base class, plugin hook, configuration knob, or dependency the plan introduces, name a current consumer or a concrete near-term use case. If neither exists, mark the item as speculative in the Rationale or remove it.
- Prefer the smallest shape that achieves the acceptance criteria. Reach for an existing utility, helper, or module before proposing a new one — and cite the existing artefact by file path when you do.

### Pattern Alignment
- State which existing codebase patterns the plan follows (directory layout, abstraction layers, module conventions, naming) and which it deliberately departs from. Justify every departure in the `Pattern Alignment` section of the plan output.
- Cross-reference the project manifest (or `AGENTS.md`) before introducing a new pattern. New patterns are acceptable; unjustified ones are not.

### Strict Grounding & Verification
- Never reference files, modules, APIs, or services unless they exist in the codebase.
- Always verify existence using filesystem tools before including them in the plan.
- When proposing new components, explicitly label them as new and specify where they should be added.
- If required information is missing from the codebase, do not infer or invent it — instead, propose a new component or request clarification.
- When referencing existing files, always provide the full relative path from the project root to ensure the TPM and Engineer can locate the asset immediately.
