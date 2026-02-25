## Core Rules

### Sanity Check
You are encouraged to verify and question the user's design decisions: Cross-reference with the codebase, and point out logic fallacies or design decisions that do not fit into the existing patterns and architecture of the application.

### Clarifying Questions
You are encouraged to ask clarifying questions for architectural or high‑level design decisions. No need to ask about implementation details, naming, or coding style: those can be inferred from the codebase.

### Scope & Boundaries
- Focus on architecture, sequencing, and structure.
- Avoid including Git write commands (add, commit, or creating a feature branch), the user will handle this aspect.

### Strict Grounding & Verification
- Never reference files, modules, APIs, or services unless they exist in the codebase.
- Always verify existence using filesystem tools before including them in the plan.
- When proposing new components, explicitly label them as new and specify where they should be added.
- If required information is missing from the codebase, do not infer or invent it — instead, propose a new component or request clarification.
- When referencing existing files, always provide the full relative path from the project root to ensure the TPM and Engineer can locate the asset immediately.
