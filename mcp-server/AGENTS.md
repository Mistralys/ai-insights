# AI Agents Operating System — Project Ledger MCP Server

> **Purpose:** This document is the authoritative "Source of Truth" and "Operating System" for AI agents entering this codebase. It defines how agents interact with the project to ensure architectural integrity, token efficiency, and consistent quality.

---

## 📚 Project Manifest — The Source of Truth

**Core Philosophy:** The Project Manifest is the canonical documentation of this codebase. If implementation code contradicts the manifest, the **code is likely wrong**.

### 🎯 Manifest Location

All manifest documents are located in:

```
/docs/agents/project-manifest/
```

### 📖 Manifest Documents (Read in Order)

| # | Document | Purpose | When to Consult |
|---|----------|---------|-----------------|
| 0 | [Workflow Specification](docs/agents/workflow-specification/README.md) | Authoritative specification of all workflow logic — state machines, routing, handoffs, edge cases | **Before modifying any pipeline, routing, status, handoff, or recommendation logic** |
| 1 | [README.md](docs/agents/project-manifest/README.md) | Project overview, purpose, and context | **FIRST** — Before any work |
| 2 | [tech-stack.md](docs/agents/project-manifest/tech-stack.md) | Runtime, frameworks, libraries, architectural patterns | Understanding system design |
| 3 | [constraints.md](docs/agents/project-manifest/constraints.md) | Critical rules, gotchas, and conventions | **MANDATORY** — Before making changes |
| 4 | [file-tree.md](docs/agents/project-manifest/file-tree.md) | Visual directory structure with annotations | Finding files and modules |
| 5 | [api-surface.md](docs/agents/project-manifest/api-surface.md) | Public constructors, methods, and signatures | Understanding interfaces before reading implementations |
| 6 | [data-flows.md](docs/agents/project-manifest/data-flows.md) | Main interaction paths through the system | Tracing execution paths |

---

## 🚀 Quick Start Workflow — Agent Ingestion Path

**Follow this sequence when entering the codebase:**

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Read README.md                                     │
│  → Understand: Project purpose, problem, solution           │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Read tech-stack.md                                 │
│  → Understand: Runtime, language version, patterns          │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Read constraints.md                                │
│  → Internalize: MANDATORY rules, anti-patterns, gotchas     │
│  ⚠️  CRITICAL — These rules are non-negotiable              │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Consult file-tree.md + api-surface.md             │
│  → Search: Find relevant modules and their public APIs      │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Read Implementation Code (Only When Necessary)     │
│  → Read: Specific files/functions identified in Step 4      │
└─────────────────────────────────────────────────────────────┘
```

**Time Budget (Estimated):**
- Steps 1-3: ~10 minutes (high-level understanding)
- Step 4: ~5 minutes per module (targeted search)
- Step 5: Only read source code when you need implementation details

---

## 📝 Manifest Maintenance Rules

**When you modify the codebase, you MUST update the manifest accordingly.**

| Change Made | Manifest Documents to Update | Notes |
|-------------|------------------------------|-------|
| **Add new MCP tool** | `api-surface.md`, `file-tree.md` (if new file), `data-flows.md` (if new flow) | Document signature, parameters, and data flow |
| **Add new class/service** | `api-surface.md`, `file-tree.md` | Document public constructors, properties, and methods |
| **Add new dependency** | `tech-stack.md` | Add to Production or Development dependencies table |
| **Add new file/directory** | `file-tree.md` | Add to tree structure with brief annotation |
| **Change architectural pattern** | `tech-stack.md`, `README.md` | Update pattern description and rationale |
| **Add new constraint/convention** | `constraints.md` | Document rule, anti-pattern, and enforcement mechanism |
| **Change data flow** | `data-flows.md` | Update or add flow diagram and description |
| **Modify public method signature** | `api-surface.md` | Update signature (do NOT include implementation) |
| **Rename/move file** | `file-tree.md`, `api-surface.md` (if public) | Update paths and references |
| **Add new status transition** | `constraints.md`, `data-flows.md` | Document rule and update transition table |
| **Change schema/validation** | `constraints.md`, `tech-stack.md` (if pattern), `api-surface.md` (if signature) | Document new validation rules |

**Enforcement:** Before completing any work package, verify you have updated ALL relevant manifest documents.

---

## ⚡ Efficiency Rules — Search Smart, Read Less

**Token efficiency is critical. Follow this search hierarchy:**

### 🔍 Search Hierarchy (Mandatory Order)

| What You Need | Search Here FIRST | Search Here SECOND | Read Source Code LAST |
|---------------|-------------------|--------------------|-----------------------|
| **Understand workflow behavior** | [Workflow Specification](docs/agents/workflow-specification/README.md) | `constraints.md` | Only for implementation details |
| **Find a file location** | `file-tree.md` | grep/file search | Never needed |
| **Understand a method signature** | `api-surface.md` | Source code | Only for implementation logic |
| **Trace how data flows** | `data-flows.md` | Source code | Only for edge cases |
| **Check if rule exists** | `constraints.md` | Source code comments | Only if ambiguous |
| **Identify dependencies** | `tech-stack.md` | `package.json` | Never needed |
| **Understand patterns** | `tech-stack.md` | Source code | Only for complex logic |

### 🛑 Anti-Patterns (Do NOT Do This)

| ❌ Inefficient | ✅ Efficient |
|---------------|-------------|
| Grep entire codebase for "LedgerStore" | Search `api-surface.md` for "LedgerStore" |
| Read 10 files to find "atomicWriteJson" | Search `file-tree.md` for "atomic-writer.ts" |
| Read source code to understand status transitions | Read `constraints.md` §8 "Status Transitions Are Enforced" |
| Clone the repo and run grep on all TS files | Read `data-flows.md` to trace execution path |

**Rationale:** Reading manifest documents consumes ~1/10th the tokens of reading source code. Use the manifest as your index.

---

## 🚨 Failure Protocol & Decision Matrix

**When you encounter ambiguity, missing documentation, or errors, follow this protocol:**

### Decision Matrix

| Scenario | Action | Priority | Example |
|----------|--------|----------|---------|
| **Manifest vs. Code Conflict** | Trust manifest. Flag code for correction. If unsafe, pause and ask user. | **MUST** | `api-surface.md` says method returns `Promise<void>`, code returns `Promise<string>` → Code is wrong |
| **Ambiguous Requirement** | Use most restrictive interpretation. Document assumption in work notes. | **MUST** | "Update status" unclear → Assume full validation required (stricter) |
| **Missing Manifest Documentation** | Pause work. Read source code. Create draft manifest entry. Request review. | **MUST** | New tool not in `api-surface.md` → Draft signature and request manifest update |
| **Untested Code Path** | Write test first. Do not ship code without tests. | **MUST** | Adding new validator → Write test in `tests/schema/validators.test.ts` |
| **Unclear Constraints** | Search for similar constraints in `constraints.md`. Apply same pattern. | **SHOULD** | Unsure of logging discipline → See §4 "STDIO Logging Discipline" |
| **Breaking Change Proposal** | Document change in work package. Flag for review. Never implement silently. | **MUST** | Changing MCP tool signature → Document breaking change + migration path |
| **Dependency Not in Tech Stack** | Check if dependency is transitive. If new, justify in work notes before adding. | **SHOULD** | Need `lodash` → Justify vs. native JS; update `tech-stack.md` if added |
| **Performance Concern** | Measure first. Optimize only if needed. Document tradeoffs. | **SHOULD** | Atomic writes feel slow → Measure latency before optimizing |
| **Legacy Code with No Tests** | Add characterization tests before modifying. Do not assume it works. | **SHOULD** | Modifying `file-lock.ts` → Add test to capture current behavior first |
| **Unclear Architecture Decision** | Search `tech-stack.md` for pattern rationale. Follow existing pattern. | **SHOULD** | Should I use class or function? → Check "Architectural Patterns" section |

### 🚦 Escalation Path

```
Issue Detected
    ↓
Can I resolve with manifest + constraints?
    ↓ YES → Proceed
    ↓ NO
    ↓
Is this a breaking change or architectural decision?
    ↓ YES → Pause and request user input
    ↓ NO
    ↓
Is this a missing manifest entry?
    ↓ YES → Draft entry + request Manifest Curator review
    ↓ NO
    ↓
Is this a bug or inconsistency?
    ↓ YES → Document in work package + flag for review
    ↓ NO
    ↓
Unclear → Pause and request user clarification
```

---

## 📊 Project Statistics

| Property | Value |
|----------|-------|
| **Project Name** | Project Ledger MCP Server |
| **Language** | TypeScript 5.7.2 (ES2022 target) |
| **Runtime** | Node.js (ESM) |
| **Architecture** | MCP Server with Repository Pattern |
| **Primary Pattern** | Schema-First Design (Zod) + Atomic Writes + File Locking |
| **Lines of Code** | ~2,000 (src/) |
| **Test Coverage** | ~85% (unit + integration) |
| **MCP Tools** | 22 registered tools |
| **Pipeline Types** | 6 (`implementation`, `qa`, `security-audit`, `code-review`, `release-engineering`, `documentation`) |
| **Agent Roles** | 9 (`Planner`, `Project Manager`, `Developer`, `QA`, `Security Auditor`, `Reviewer`, `Release Engineer`, `Documentation`, `Synthesis`) |
| **Dependencies** | 3 production, 4 development |

---

## 🔐 Critical Constraints (Know Before Coding)

These constraints are **non-negotiable**. Violating them will cause bugs or protocol failures.

| # | Constraint | Consequence of Violation |
|---|------------|--------------------------|
| 1 | All file I/O must use `atomicWriteJson()` | Readers see corrupt JSON / partial writes |
| 2 | Dual-file updates require `withLock()` | Race conditions + dual-file desync |
| 3 | `project_path` must be absolute | Server cannot resolve relative paths |
| 4 | Never log to `stdout` (use `stderr` only) | Breaks MCP protocol communication |
| 5 | Work package IDs match `/^WP-\d{3,}$/` | Schema validation fails |
| 6 | Timestamps use `now()` utility (YYYY-MM-DD HH:MM:SS) | Inconsistent format + parsing errors |
| 7 | JSON must be pretty-printed (2-space indent + newline) | Ugly diffs + manual editing pain |
| 8 | Status transitions follow legal transition table | Business rule violation + data corruption |
| 9 | `COMPLETE` requires all acceptance criteria met | Premature completion + false positives |
| 10 | Pipelines require `IN_PROGRESS` work package | Starting work before claiming |
| 11 | Pre-mutation state passed out of `updateWorkPackageWithSync` must use outer-scope `let` | TS2304 compile error + runtime ReferenceError at call site |
| 12 | All workflow logic must implement the Workflow Specification exactly | Spec drift → behavioral divergence → test false positives → production bugs |

**Memorize these constraints.** Reference [constraints.md](docs/agents/project-manifest/constraints.md) for full details.

---

## 🧭 Navigation Quick Reference

| I Need To... | Go Here |
|--------------|---------|
| Understand what this project does | [README.md](docs/agents/project-manifest/README.md) |
| Find where a file is located | [file-tree.md](docs/agents/project-manifest/file-tree.md) |
| Look up a method signature | [api-surface.md](docs/agents/project-manifest/api-surface.md) |
| Understand how data flows through system | [data-flows.md](docs/agents/project-manifest/data-flows.md) |
| Check architectural patterns | [tech-stack.md](docs/agents/project-manifest/tech-stack.md) |
| Verify a rule or constraint | [constraints.md](docs/agents/project-manifest/constraints.md) |
| See previous implementation notes | [docs/agents/implementation-history/](docs/agents/implementation-history/) |
| Understand workflow logic (state machines, routing, handoffs) | [Workflow Specification](docs/agents/workflow-specification/README.md) |

---

## 🤖 Agent-Specific Guidance

If you are operating in a **specific agent role**, consult the relevant persona document:

| Agent Role | VS Code Persona | Claude Code Persona | Focus |
|------------|-----------------|---------------------|-------|
| Planner | `/personas/ledger/vs-code/1-planner.md` | `/personas/ledger/claude-code/1-planner.md` | Breaking user requests into work packages |
| Project Manager | `/personas/ledger/vs-code/2-project-manager.md` | `/personas/ledger/claude-code/2-project-manager.md` | Creating work packages + dependency management |
| Developer | `/personas/ledger/vs-code/3-developer.md` | `/personas/ledger/claude-code/3-developer.md` | Implementation + pipeline execution |
| Validator (QA) | `/personas/ledger/vs-code/4-qa.md` | `/personas/ledger/claude-code/4-qa.md` | Testing + quality assurance |
| Security Auditor | `/personas/ledger/vs-code/5-security-auditor.md` | `/personas/ledger/claude-code/5-security-auditor.md` | Security review (stub — full content in Plan 2) |
| Reviewer | `/personas/ledger/vs-code/6-reviewer.md` | `/personas/ledger/claude-code/6-reviewer.md` | Code review + architecture validation |
| Release Engineer | `/personas/ledger/vs-code/7-release-engineer.md` | `/personas/ledger/claude-code/7-release-engineer.md` | Release validation (stub — full content in Plan 2) |
| Documentation | `/personas/ledger/vs-code/8-documentation.md` | `/personas/ledger/claude-code/8-documentation.md` | Manifest maintenance + README updates |
| Synthesis | `/personas/ledger/vs-code/9-synthesis.md` | `/personas/ledger/claude-code/9-synthesis.md` | Cross-session coordination + handoff |

---

**Version:** 1.0.0  
**Last Updated:** 2026-02-23  
**Maintained By:** Manifest Curator Agent