# Personas - Ledger Suite Guide
_SOURCE: Ledger workflow user guide (9-agent pipeline usage, prerequisites, step-by-step)_
# Ledger workflow user guide (9-agent pipeline usage, prerequisites, step-by-step)
```
// Structure of documents
└── personas/
    └── ledger/
        └── README.md

```
###  Path: `/personas/ledger/README.md`

```md
# Agentic Coding Workflow - Ledger-Enabled

## Overview

This is a structured multi-agent workflow for systematic software development. It uses a **centralized ledger** managed by an MCP server to maintain state across chat sessions, enabling agents to collaborate on complex projects without losing context.

### Why Use This Workflow?

- **State Persistence**: The centralized ledger preserves project state between chat sessions
- **Separation of Concerns**: Each agent focuses on a specific role (planning, implementation, QA, review)
- **Traceability**: Track work packages, acceptance criteria, dependencies, and blockers
- **Quality Assurance**: Built-in validation, review, and documentation stages
- **Scalability**: Handle complex projects by breaking them into manageable work packages
- **Corruption Resistance**: Split-file architecture isolates work package data — a bad edit to one WP doesn't affect others
- **MCP Server**: All ledger operations are managed through a dedicated MCP server that enforces schema validation, atomic writes, and centralized storage
- **Automatic Handoffs**: Agents 2–9 can pass control to the next agent automatically via `runSubagent` when the MCP server returns an `auto_handoff` response — no manual copy-paste required

### Agents in the Workflow

1. **Planner Agent**: Creates high-level strategy and implementation plan
2. **Project Manager Agent**: Breaks plan into work packages and initializes the ledger
3. **Developer Agent**: Implements work packages with context awareness
4. **QA Agent**: Verifies acceptance criteria and runs tests
5. **Security Auditor Agent**: Performs security review and vulnerability assessment
6. **Reviewer Agent**: Performs code quality and architecture review
7. **Release Engineer Agent**: Manages changelogs, versioning, and release artifacts
8. **Documentation Agent**: Updates project documentation
9. **Synthesis Agent**: Consolidates results and generates project report

### Dynamic Pipeline Configuration

Each work package runs only the pipeline stages configured by the Project Manager. The canonical ordering is:

```
implementation → qa → security-audit → code-review → release-engineering → documentation
```

> **Hard constraint:** Stages may be omitted but **never reordered**. `ledger_create_work_package` rejects any `active_pipeline_stages` array that is not a strict subsequence of the canonical order. See [personas constraints.md §44](docs/agents/project-manifest/constraints.md).

Stages not included in a WP's configuration are skipped automatically. **Common composition patterns:**

| Pattern | Stages | Typical Use |
|---------|--------|-------------|
| **Standard** | `implementation → qa → code-review → documentation` | Most code changes |
| **Full** | `implementation → qa → security-audit → code-review → release-engineering → documentation` | Security-sensitive features or milestone releases |
| **Security-focused** | `implementation → qa → security-audit → code-review → documentation` | Features touching auth, input handling, or external APIs |
| **Release-engineering** | `implementation → qa → code-review → release-engineering → documentation` | Changes requiring a changelog entry or version bump |
| **Doc-only** | `documentation` | Pure documentation updates with no code changes |
| **Verification** | `qa → code-review` | Lightweight review of minor changes |

> The PM uses the `pipeline-configurator` standalone sub-agent to select the appropriate pattern for each WP. Agents 3–9 each query `ledger_get_next_action` to discover work — they act only on WPs where their pipeline stage is configured and not yet completed.

---

## Quick Reference

> **Prefer automation?** Use the **Workflow Orchestrator** persona to run the full pipeline automatically — see [Automated Orchestration with the Workflow Orchestrator](#automated-orchestration-with-the-workflow-orchestrator) below.

**For experienced users** - follow these steps (expand sections below for detailed instructions):

1. **[Setup](#prerequisites)**: Configure the MCP server via `.mcp.json`
2. **[Planning](#stage-1-planning)**: New chat → Open context files → Paste [1-planner.agent.md](vs-code/1-planner.agent.md) → Describe feature → Review plan
3. **[Project Management](#stage-2-project-management)**: New chat → Open plan document → Paste [2-pm.agent.md](vs-code/2-pm.agent.md) → Review work packages & ledger
4. **[Implementation](#stage-3-implementation-iterative)**: New chat → Open work package spec → Paste [3-dev.agent.md](vs-code/3-dev.agent.md) → Agent reads ledger via MCP → Review code
5. **[Validation](#stage-4-validation-per-work-package)**: New/continue chat → Paste [4-qa.agent.md](vs-code/4-qa.agent.md) → Agent reads ledger via MCP → Review test results
6. **[Security Audit](#stage-5-security-audit-per-work-package)**: New/continue chat → Paste [5-security-auditor.agent.md](vs-code/5-security-auditor.agent.md) → Agent reads ledger via MCP → Review findings
7. **[Code Review](#stage-6-code-review-per-work-package)**: New/continue chat → Open relevant source files → Paste [6-reviewer.agent.md](vs-code/6-reviewer.agent.md) → Agent reads ledger via MCP → Address findings
8. **[Release Engineering](#stage-7-release-engineering-per-work-package)**: New/continue chat → Paste [7-release-engineer.agent.md](vs-code/7-release-engineer.agent.md) → Agent reads ledger via MCP → Review release artifacts
9. **[Documentation](#stage-8-documentation-update)**: New chat → Paste [8-docs.agent.md](vs-code/8-docs.agent.md) → Agent reads ledger via MCP → Review updates
10. **[Synthesis](#stage-9-synthesis--reporting)**: New chat → Paste [9-synthesis.agent.md](vs-code/9-synthesis.agent.md) → Agent reads ledger via MCP → Review final report

**Repeat steps 4-8 for each work package**, including only the stages included in that WP's configured pipeline. See [Pipeline Configuration](#dynamic-pipeline-configuration) for common patterns. See detailed instructions below for tips, troubleshooting, and best practices.

---

## Automated Orchestration with the Workflow Orchestrator

The **Workflow Orchestrator** is a standalone persona that automates the entire pipeline. Instead of manually pasting personas and switching sessions for each stage, you invoke it once and it dispatches agents in the correct order — with the ledger as the single source of truth.

The generated persona file is available at:
- **Claude Code:** `personas/standalone/claude-code/workflow-orchestrator.md`
- **VS Code:** `personas/standalone/vs-code/workflow-orchestrator.agent.md`

After syncing (`node scripts/sync-personas.js`), it is also deployed to `~/.claude/agents/workflow-orchestrator.md` for use as a Claude Code sub-agent.

### When to use it

Use the Workflow Orchestrator when you want an agent to coordinate the full pipeline autonomously, eliminating manual handoffs and the risk of skipping stages or advancing WPs out of turn.

Use the manual step-by-step approach when you want fine-grained control over each stage — for example, to iterate on a plan with the Planner before committing, or to review QA results before the Reviewer runs.

### Usage

Paste (or open) the persona and describe what you want:

```
# interactive mode (default)
Run the workflow for my project.

# autonomous mode
Run the workflow automatically with no confirmation between stages.

# start from an existing plan
Run the workflow using docs/agents/plans/2026-03-18-name/plan.md
```

**Interactive mode** (default): The agent detects the project state, reports it to you, and asks for confirmation before dispatching each agent. Good for first-time use or when you want to stay in the loop.

**Autonomous mode**: Agents are dispatched continuously without per-stage confirmation. The orchestrator still pauses on errors, rework-limit hits, or repeated failures. Good for unattended runs.

**Plan path argument**: Skips the Planner and jumps straight to the Project Manager using the specified plan file.

### How it works

1. **Project detection** — calls `ledger_detect_project` to find an active project in the current workspace.
2. **State report** — calls `ledger_get_project_status` and prints a summary (project name, status, WP counts, current stage).
3. **Dispatch loop** — repeatedly consults `ledger_get_handoff_status` to determine the next agent, spawns it via the Agent tool, then checks ledger state after it returns. Continues until the project reaches COMPLETE.

The orchestrator enforces the same constraints the ledger does:

- **Never skips agents.** Every handoff is determined by `ledger_get_handoff_status`, not by the orchestrator's own judgment.
- **Never marks WPs complete out of turn.** Only the Documentation agent triggers WP completion (via auto-finalization in `ledger_complete_pipeline`).
- **Never calls pipeline tools.** The orchestrator is read-only; only sub-agents interact with `ledger_begin_work`, `ledger_complete_pipeline`, etc.
- **Handles rework automatically.** When QA or Reviewer bounces a WP, the ledger routes back to Developer; the orchestrator follows that routing without intervention.

### Resuming a paused workflow

If the workflow is interrupted (session ends, error, or you pause it), invoke the Workflow Orchestrator again. It reads the current ledger state and resumes from wherever the pipeline left off — no manual bookkeeping required.

---

## Prerequisites

### MCP Server (Required)

Agents 2–9 depend on the **project-ledger MCP server** for all ledger operations. The server is a hard prerequisite — agents will refuse to start if it is unreachable.

> **Server name is configurable.** The personas reference the server by the name defined in `_shared.yaml` → `mcp_server_name` (default: `central_pm`). If your `.mcp.json` uses a different key, update `mcp_server_name` in `personas/ledger/src/meta/_shared.yaml` and rebuild.

**For setup instructions, see the [MCP Server Documentation](../../mcp-server/README.md).**

Quick summary:
1. Install dependencies: `cd mcp-server && npm install`
2. Configure `.mcp.json` with absolute path to server
3. Restart your AI IDE to load the MCP server
4. Agents will verify connectivity on startup

### Initial Project Setup

Before starting the workflow, ensure your project has:

1. **Documentation Structure**: Create `/docs/agents/` directory in your project
   ```bash
   mkdir -p docs/agents
   ```

2. **Project Context** (Recommended):
   - Create `AGENTS.md` or project manifest describing tech stack, architecture, and conventions
   - Ensure relevant code files are accessible
   - Have existing documentation (README, API docs) available

---

## Step-by-Step Workflow

### Stage 1: Planning

**Goal**: Create a comprehensive implementation plan

1. **Start a new chat session** in your AI IDE
2. **Open relevant context files**: Project manifest, existing docs, related code
3. **Copy and send** the contents of [1-planner.agent.md](vs-code/1-planner.agent.md)
4. **Describe your feature or task** when prompted
5. **Review and refine** the plan with the agent
6. **Verify output**: Plan saved to `/docs/agents/plans/YYYY-MM-DD-feature-name.md`

**Tips**:
- Be specific about requirements, constraints, and acceptance criteria
- Reference existing patterns or components to maintain consistency
- Discuss architectural decisions if the feature is complex

---

### Stage 2: Project Management

**Goal**: Break the plan into actionable work packages and initialize the ledger

1. **Start a new chat session** (fresh context)
2. **Open the plan document** created in Stage 1
3. **Copy and send** the contents of [2-pm.agent.md](vs-code/2-pm.agent.md)
4. **Review the work packages** for logical sequencing and dependencies
5. **Verify outputs** (the agent creates work package specs as markdown and initializes the ledger via MCP):
   - Work package summary index: `/docs/agents/plans/{plan-name}/work.md`
   - Individual WP specification files: `/docs/agents/plans/{plan-name}/work/WP-001.md`, etc.
   - The project ledger is stored centrally by the MCP server (not as files in the plan directory)

**Tips**:
- Check that dependencies between work packages are correctly identified
- Ensure each package has clear acceptance criteria
- Verify the ledger initializes correctly via `ledger_get_project_status`

**PM Sub-Agents (Advanced):**
The Project Manager persona can invoke four specialized standalone sub-agents to decompose complex projects. These are available in `standalone/vs-code/` and `standalone/claude-code/`:
- `wp-decomposer` — Breaks the plan into atomic, well-scoped work packages
- `dependency-sequencer` — Orders WPs by dependency topology
- `pipeline-configurator` — Selects the appropriate pipeline stages for each WP
- `ledger-bootstrapper` — Registers WPs in the ledger via MCP tools

> **Claude Code note:** The `ledger-bootstrapper` sub-agent requires MCP tool access (`central_pm/*`) for ledger initialization. This access is available only in VS Code builds — the standalone Claude Code frontmatter template does not support `mcpServers` configuration. Claude Code users should initialize the ledger through the full PM persona rather than invoking `ledger-bootstrapper` directly.

---

### Stage 3: Implementation (Iterative)

**Goal**: Implement work packages one at a time

For **each work package**:

1. **Start a new chat session** (or continue if working on related packages)
2. **Open** the work package specification (`work/WP-###.md`) and relevant source files for context
3. **Copy and send** the contents of [3-dev.agent.md](vs-code/3-dev.agent.md)
4. **Specify which work package** to implement (e.g., "Implement WP-1")
5. **Monitor progress**: The agent reads and updates the ledger via MCP tools automatically
6. **Verify outputs**:
   - Code changes in your project files
   - Ledger updated with artifacts, pipeline entry, and observations (via MCP)

**Tips**:
- Keep related files open for the agent to reference
- Review code incrementally if work packages are large
- Check that the agent follows your project's coding conventions
- Note any insights or improvements the agent logs in the ledger

---

### Stage 4: Validation (Per Work Package)

**Goal**: Verify acceptance criteria and run tests

1. **Start a new chat session** or continue from implementation
2. **Open** the work package specification (`work/WP-###.md`) and relevant source files
3. **Copy and send** the contents of [4-qa.agent.md](vs-code/4-qa.agent.md)
4. **Specify the work package** to validate (the agent reads implementation artifacts from the ledger via MCP)
5. **Review validation results**:
   - **PASS**: All acceptance criteria met, tests pass
   - **FAIL**: Issues found → Agent sets WP to BLOCKED via MCP, returns to developer
6. **Verify**: The agent records QA metrics, findings, and AC status in the ledger via MCP

**Tips**:
- Ensure test environment is properly configured
- Review edge cases the agent identifies
- If validation fails, address issues before proceeding
- Check test coverage metrics in the ledger

---

### Stage 5: Security Audit (Per Work Package)

**Goal**: Identify security vulnerabilities before code review

1. **Start a new chat session** or continue from validation
2. **Open** the work package specification and relevant source files
3. **Copy and send** the contents of [5-security-auditor.agent.md](vs-code/5-security-auditor.agent.md)
4. **The agent reads** WP details and implementation artifacts from the ledger via MCP
5. **Review security findings**:
   - **PASS**: No Critical or High severity issues found
   - **FAIL**: Blocking vulnerability found → Agent marks pipeline FAIL, issue routes back to developer
6. **Verify**: The agent records security findings, severity classifications, and metrics in the ledger via MCP

**Tips**:
- Pay attention to Critical and High severity findings — these block the pipeline
- Medium and Low severity issues are recorded but do not block release
- Check OWASP Top 10 coverage (A01–A10) in the findings
- Ensure authentication, authorization, and input validation are verified

---

### Stage 6: Code Review (Per Work Package)

**Goal**: Ensure code quality, maintainability, and architectural alignment

1. **Start a new chat session** or continue from security audit
2. **Open** relevant source files modified by the developer
3. **Copy and send** the contents of [6-reviewer.agent.md](vs-code/6-reviewer.agent.md)
4. **The agent reads** WP details and implementation artifacts from the ledger via MCP
5. **Review the analysis**:
   - Maintainability assessment
   - Security and performance concerns
   - Architectural alignment
   - Suggested improvements
6. **Address blocking issues** if any are identified
7. **Verify**: The agent records review findings and scores in the ledger via MCP

**Tips**:
- Pay attention to technical debt warnings
- Note non-blocking suggestions for future iterations
- Ensure security vulnerabilities are addressed
- Review "gold nuggets" (valuable insights) in the ledger

---

### Stage 7: Release Engineering (Per Work Package)

**Goal**: Prepare changelog entries, version bumps, and release artifacts

1. **Start a new chat session** or continue from code review
2. **Open** the project changelog and relevant release files
3. **Copy and send** the contents of [7-release-engineer.agent.md](vs-code/7-release-engineer.agent.md)
4. **The agent reads** WP details and review artifacts from the ledger via MCP
5. **Review release artifacts**:
   - Changelog entry for the feature or fix
   - Version bump recommendation (semver: patch/minor/major)
   - Migration guide (if breaking changes are present)
   - Deployment readiness check
6. **Verify**: The agent records release engineering results in the ledger via MCP

**Tips**:
- Check the semver decision — breaking changes require a major version bump
- Ensure the changelog entry is user-facing and clearly describes the change
- If a migration guide was generated, review it before release
- Confirm all deployment readiness items are addressed

---

### Stage 8: Documentation Update

**Goal**: Keep documentation synchronized with code changes

1. **Start a new chat session**
2. **Open** current project documentation (README, API docs) for context
3. **Copy and send** the contents of [8-docs.agent.md](vs-code/8-docs.agent.md)
4. **The agent reads** completed WP details and artifacts from the ledger via MCP
5. **Review documentation updates**:
   - Updated API references
   - New configuration instructions
   - Architecture diagram changes
6. **Verify**: The agent records documentation pipeline results in the ledger via MCP

**Tips**:
- Ensure all new features are documented
- Verify code examples in docs are accurate
- Check that breaking changes are clearly noted
- Update user-facing documentation if applicable

---

### Stage 9: Synthesis & Reporting

**Goal**: Generate comprehensive project status report

1. **Start a new chat session**
3. **Copy and send** the contents of [9-synthesis.agent.md](vs-code/9-synthesis.agent.md)
3. **The agent reads** the full project status, all WP details, and pipeline data from the ledger via MCP
4. **Review the generated report**:
   - Executive summary of what was built
   - Metrics (tests passed, coverage, issues found)
   - Strategic recommendations and insights
   - Next steps and future improvements
5. **Verify outputs**:
   - Report saved to `/docs/agents/{plan-name}-report.md`
   - Ledger status updated to `COMPLETE`

**Tips**:
- Use this report for stakeholder communication
- Review strategic insights for future planning
- Archive the report and ledger for project history
- Identify technical debt and improvement opportunities

---

## Best Practices

### Context Management

- **Fresh sessions**: Start new chats between major stages to avoid context bloat
- **Keep files open**: Have relevant documents visible to provide context automatically
- **Reference paths**: Use absolute paths when referencing files in prompts

### Ledger Hygiene

- **Commit regularly**: Version control your plan and work package Markdown files with your code
- **MCP handles consistency**: The MCP server stores ledger data centrally and ensures atomic writes — all ledger state is managed automatically
- **Monitor status**: Track work package statuses (`READY` → `IN_PROGRESS` → `COMPLETE` → `BLOCKED`)
- **Never edit the ledger manually**: Always let agents use MCP tools to modify ledger state

### Workflow Flexibility

- **Skip stages**: If working on simple tasks, you may skip validation or review
- **Iterate**: Return to earlier stages if issues are discovered
- **Adapt**: Modify personas to fit your team's specific needs
- **Batch work**: Implement multiple related work packages in one session if appropriate

### Quality Gates

- Never skip validation for customer-facing features
- Always review security-critical code
- Update documentation for public APIs and configuration changes
- Run synthesis after completing major milestones

---

## Troubleshooting

### Common Issues

**Agent stops with "MCP server unavailable"**:
- Verify `.mcp.json` exists and points to the correct MCP server path
- Ensure the MCP server dependencies are installed (`cd mcp-server && npm install`)
- Restart Claude Code to reload the MCP configuration

**MCP tool call fails with unexpected error**:
- Check the MCP server logs for details
- Ensure the `project_path` is an absolute path to the plan folder
- Verify the ledger files haven't been corrupted by manual editing

**Work package dependencies not respected**:
- The MCP server validates dependencies automatically — check the error message for details
- Ensure prerequisite packages are marked as `COMPLETE` before starting dependent work

**Context getting lost**:
- Start fresh chat sessions between stages
- Agents read ledger state via MCP, so you only need to keep work package specs and source files open
- Reference specific work package IDs in prompts

**Agent modifying wrong files**:
- Ensure project manifest or AGENTS.md describes file structure
- Keep relevant source files open for context
- Be explicit about which files should be modified

### Recovery Strategies

**If validation fails**:
1. Check the ledger for specific blocker details
2. Return to Stage 3 (Implementation) with the same work package
3. Reference the validation findings in the ledger

**If the workflow gets interrupted**:
1. Open the ledger to check current status
2. Identify the last completed pipeline entry
3. Resume at the next appropriate stage
4. Use the ledger's timestamps to understand what was done

**If you need to change the plan**:
1. Update the plan document manually
2. Have the Project Manager regenerate work packages
3. Update the ledger to reflect new structure
4. Note the plan revision in the ledger's `project_comments`

---

## Advanced Usage

### Parallel Work Packages

For independent work packages, you can run multiple implementation sessions in parallel:
- Use separate chat sessions for each package
- Ensure packages don't modify the same files
- Merge ledger updates carefully to avoid conflicts

### Custom Pipelines

Add custom validation or review steps by:
1. Creating additional pipeline entries in the ledger
2. Defining custom agent personas
3. Following the pipeline schema in the ledger documentation

### Integration with CI/CD

- Run the QA agent in automated test pipelines
- Parse the ledger data (via MCP tools) for build status and metrics
- Generate reports from the Synthesis agent for dashboards

---

## Workflow Diagram

```
           ┌─────────────────┐
           │  User Request   │
           └────────┬────────┘
                    │
                    ▼
            ┌─────────────────┐
            │  1. Planner     │
            │     Agent       │
            └────────┬────────┘
                    │ Implementation Plan
                    ▼
           ┌─────────────────┐
           │  2. Project     │
           │     Manager     │
           │     Agent       │
           └────────┬────────┘
                    │ Work Packages & Ledger
                    ▼
        ╔═══════════════════════════════════════════════╗
        ║    ITERATIVE LOOP (for Each Work Package)     ║
        ║                                               ║
        ║  ┌─────────────────┐                          ║
        ║  │  3. Developer   │◄───────────┐             ║
        ║  │     Agent       │            │ REWORK      ║
        ║  └────────┬────────┘            │             ║
        ║           │                     │             ║
        ║           ▼                     │             ║
        ║  ┌─────────────────┐            │             ║
        ║  │   4. QA Agent   │────FAIL────┘             ║
        ║  └────────┬────────┘                          ║
        ║           │ PASS                              ║
        ║           ▼                                   ║
        ║  ╔═════════════════╗                          ║
        ║  ║  5. Security    ║  ← optional stage        ║
        ║  ║     Auditor     ║────FAIL────┐             ║
        ║  ╚════════╤════════╝            │             ║
        ║           │ PASS / skipped      │ REWORK      ║
        ║           ▼                     │             ║
        ║  ┌─────────────────┐            │             ║
        ║  │  6. Reviewer    │────FAIL────┘             ║
        ║  │     Agent       │                          ║
        ║  └────────┬────────┘                          ║
        ║           │ PASS                              ║
        ║           ▼                                   ║
        ║  ╔═════════════════╗                          ║
        ║  ║  7. Release     ║  ← optional stage        ║
        ║  ║     Engineer    ║                          ║
        ║  ╚════════╤════════╝                          ║
        ║           │ PASS / skipped                    ║
        ║           ▼                                   ║
        ║  ┌─────────────────┐                          ║
        ║  │ 8. Documenta-   │                          ║
        ║  │    tion Agent   │                          ║
        ║  └────────┬────────┘                          ║
        ╚═══════════╪═══════════════════════════════════╝
                    │
                    │ All Work Packages Complete
                    ▼
           ┌─────────────────┐
           │  9. Synthesis   │
           │     Agent       │
           └────────┬────────┘
                    │ Final Report
                    ▼
           ┌─────────────────┐
           │     Project     │
           │    Complete     │
           └─────────────────┘
```

### Agent Flow Description

1. **Planner Agent** → Creates high-level implementation plan
2. **Project Manager Agent** → Breaks plan into work packages and initializes ledger
3. **Developer Agent** → Implements work packages (iterative, one at a time)
4. **QA Agent** → Verifies acceptance criteria and runs tests
   - If tests fail → Returns to Developer (REWORK)
5. **Security Auditor Agent** → Performs security review and vulnerability assessment *(optional stage)*
   - If blocking issue found → Returns to Developer (REWORK)
6. **Reviewer Agent** → Performs code quality and architecture review
   - If blocking issues found → Returns to Developer (REWORK)
7. **Release Engineer Agent** → Manages changelogs, versioning, and release artifacts *(optional stage)*
8. **Documentation Agent** → Updates project documentation for this work package
9. **Synthesis Agent** → Generates comprehensive project report

**Note**: Steps 3–8 form a configurable per-WP loop. Stages 5 (Security Audit) and 7 (Release Engineering) are **optional** — included only for WPs that require them. Which stages run for a given work package is determined by the PM during project setup (see [Pipeline Configuration](#dynamic-pipeline-configuration)). Stages not in the WP's pipeline are skipped automatically. Step 9 (Synthesis) runs once after all work packages are complete.

---

## File Structure After Running Workflow

```
your-project/
├── docs/
│   ├── agents/
│   │   ├── project-ledger-schema.md   # Reference doc
│   │   └── plans/
│   │       └── 2026-02-11-feature-name/
│   │           ├── plan.md                # Plan document
│   │           ├── work.md                # WP summary index
│   │           ├── work/                  # WP specification files
│   │           │   ├── WP-001.md
│   │           │   ├── WP-002.md
│   │           │   └── ...
│   │           └── synthesis.md           # Final report
│   └── [other project docs]
└── [your source code]
```

---

## Building Personas

The ledger persona files (`1-planner.md` … `9-synthesis.md`) are **auto-generated** from source templates in `personas/ledger/src/`. Do not edit them directly — changes will be overwritten on the next build.

**Quick commands:**

```bash
# Install build dependency (once)
cd personas && npm install

# Build all personas (both VS Code and Claude Code targets)
node scripts/build-personas.js

# Build for a specific IDE only
node scripts/build-personas.js --target vscode
node scripts/build-personas.js --target claude-code

# Verify no unresolved {{…}} tokens remain in any generated file
node scripts/build-personas.js --strict --suite all

# Build + sync to both IDEs (VS Code prompts folder + ~/.claude/agents/)
node scripts/sync-personas.js

# Build + sync to a specific IDE only
node scripts/sync-personas.js --target vscode
node scripts/sync-personas.js --target claude-code
```

> `--strict` exits with code 1 if any unresolved `{{…}}` markers remain after the build. Use it in CI or pre-commit hooks. Full flag documentation is in the [Personas Project Manifest](../docs/agents/project-manifest/README.md).

For the full build system documentation — source layout, metadata schema, template syntax, and conventions — see the [Personas Project Manifest](../docs/agents/project-manifest/README.md).

---

## Next Steps

1. **Try the workflow**: Start with a small feature to familiarize yourself — use the **Workflow Orchestrator** persona for automated orchestration, or follow the manual stages above
2. **Customize personas**: Adapt the agent prompts to your team's conventions
3. **Build system details**: See the [Personas Project Manifest](../docs/agents/project-manifest/README.md) for template syntax, metadata schema, and source layout
4. **Review the ledger schema**: Understand all available fields in [project-ledger-schema.md](project-ledger-schema.md)
5. **Explore MCP tools**: The MCP server exposes tools for project lifecycle, work packages, pipelines, observations, and workflow coordination
6. **Share feedback**: Document what works and what doesn't for your use cases

For questions or improvements, refer to the main project [README.md](../../README.md).

```