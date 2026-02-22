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
- **Automatic Handoffs**: Agents 2–7 can pass control to the next agent automatically via `runSubagent` when the MCP server returns an `auto_handoff` response — no manual copy-paste required

### Agents in the Workflow

1. **Planner Agent**: Creates high-level strategy and implementation plan
2. **Project Manager Agent**: Breaks plan into work packages and initializes the ledger
3. **Developer Agent**: Implements work packages with context awareness
4. **Validator Agent**: Verifies acceptance criteria and runs tests
5. **Reviewer Agent**: Performs code quality and architecture review
6. **Documentation Agent**: Updates project documentation
7. **Synthesis Agent**: Consolidates results and generates project report

---

## Quick Reference

**For experienced users** - follow these steps (expand sections below for detailed instructions):

1. **[Setup](#prerequisites)**: Configure the MCP server via `.mcp.json`
2. **[Planning](#stage-1-planning)**: New chat → Open context files → Paste [1-planner.md](1-planner.md) → Describe feature → Review plan
3. **[Project Management](#stage-2-project-management)**: New chat → Open plan document → Paste [2-project-manager.md](2-project-manager.md) → Review work packages & ledger
4. **[Implementation](#stage-3-implementation-iterative)**: New chat → Open work package spec → Paste [3-developer.md](3-developer.md) → Agent reads ledger via MCP → Review code
5. **[Validation](#stage-4-validation-per-work-package)**: New/continue chat → Paste [4-qa.md](4-qa.md) → Agent reads ledger via MCP → Review test results
6. **[Review](#stage-5-code-review-per-work-package)**: New/continue chat → Paste [5-reviewer.md](5-reviewer.md) → Agent reads ledger via MCP → Address findings
7. **[Documentation](#stage-6-documentation-update)**: New chat → Paste [6-documentation.md](6-documentation.md) → Agent reads ledger via MCP → Review updates
8. **[Synthesis](#stage-7-synthesis--reporting)**: New chat → Paste [7-synthesis.md](7-synthesis.md) → Agent reads ledger via MCP → Review final report

**Repeat steps 4-6** for each work package. See detailed instructions below for tips, troubleshooting, and best practices.

---

## Prerequisites

### MCP Server (Required)

Agents 2–7 depend on the **project-ledger MCP server** for all ledger operations. The server is a hard prerequisite — agents will refuse to start if it is unreachable.

> **Server name is configurable.** The personas reference the server by the name defined in `_shared.yaml` → `mcp_server_name` (default: `project-ledger`). If your `.mcp.json` uses a different key, update `mcp_server_name` in `personas/ledger/src/meta/_shared.yaml` and rebuild.

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
3. **Copy and send** the contents of [1-planner.md](1-planner.md)
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
3. **Copy and send** the contents of [2-project-manager.md](2-project-manager.md)
4. **Review the work packages** for logical sequencing and dependencies
5. **Verify outputs** (the agent creates work package specs as markdown and initializes the ledger via MCP):
   - Work package summary index: `/docs/agents/plans/{plan-name}/work.md`
   - Individual WP specification files: `/docs/agents/plans/{plan-name}/work/WP-001.md`, etc.
   - The project ledger is stored centrally by the MCP server (not as files in the plan directory)

**Tips**:
- Check that dependencies between work packages are correctly identified
- Ensure each package has clear acceptance criteria
- Verify the ledger initializes correctly via `ledger_get_project_status`

---

### Stage 3: Implementation (Iterative)

**Goal**: Implement work packages one at a time

For **each work package**:

1. **Start a new chat session** (or continue if working on related packages)
2. **Open** the work package specification (`work/WP-###.md`) and relevant source files for context
3. **Copy and send** the contents of [3-developer.md](3-developer.md)
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
3. **Copy and send** the contents of [4-qa.md](4-qa.md)
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

### Stage 5: Code Review (Per Work Package)

**Goal**: Ensure code quality, maintainability, and architectural alignment

1. **Start a new chat session** or continue from validation
2. **Open** relevant source files modified by the developer
3. **Copy and send** the contents of [5-reviewer.md](5-reviewer.md)
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

### Stage 6: Documentation Update

**Goal**: Keep documentation synchronized with code changes

1. **Start a new chat session**
2. **Open** current project documentation (README, API docs) for context
3. **Copy and send** the contents of [6-documentation.md](6-documentation.md)
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

### Stage 7: Synthesis & Reporting

**Goal**: Generate comprehensive project status report

1. **Start a new chat session**
2. **Copy and send** the contents of [7-synthesis.md](7-synthesis.md)
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

- Run the Validator agent in automated test pipelines
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
        ╔═════════════════════════════════════════════╗
        ║    ITERATIVE LOOP (for Each Work Package)   ║
        ║                                             ║
        ║  ┌─────────────────┐                        ║
        ║  │  3. Developer   │◄───────────┐           ║
        ║  │     Agent       │            │           ║
        ║  └────────┬────────┘            │           ║
        ║           │ Implemented Code    │           ║
        ║           ▼                     │           ║
        ║  ┌─────────────────┐            │           ║
        ║  │  4. Validator   │            │           ║
        ║  │     Agent       │            │           ║
        ║  └────────┬────────┘            │           ║
        ║           │                     │           ║
        ║           ├─Tests Fail──────────┘           ║
        ║           │                     │           ║
        ║           │ Tests Pass          │           ║
        ║           ▼                     │           ║
        ║  ┌─────────────────┐            │           ║
        ║  │  5. Reviewer    │            │           ║
        ║  │     Agent       │            │           ║
        ║  └────────┬────────┘            │           ║
        ║           │                     │           ║
        ║           ├─Blocking Issues─────┘           ║
        ║           │                                 ║
        ║           │ Code Approved                   ║
        ╚═══════════╪═════════════════════════════════╝
                    │
                    │ All Work Packages Complete
                    ▼
           ┌─────────────────┐
           │  6. Documenta-  │
           │     tion Agent  │
           └────────┬────────┘
                    │ Updated Docs
                    ▼
           ┌─────────────────┐
           │  7. Synthesis   │
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
4. **Validator Agent** → Verifies acceptance criteria and runs tests
   - If tests fail → Returns to Developer
5. **Reviewer Agent** → Performs code quality and architecture review
   - If blocking issues found → Returns to Developer
6. **Documentation Agent** → Updates project documentation (after all packages complete)
7. **Synthesis Agent** → Generates comprehensive project report

**Note**: Steps 3-5 form an iterative loop that repeats for each work package. The workflow proceeds to Documentation only after all work packages are validated and reviewed.

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

The ledger persona files (`1-planner.md` … `7-synthesis.md`) are **auto-generated** from source templates in `personas/ledger/src/`. Do not edit them directly — changes will be overwritten on the next build.

**Quick commands:**

```bash
# Install build dependency (once)
cd personas && npm install

# Build all personas
node scripts/build-personas.js

# Build + sync to your AI IDE's prompts folder
node scripts/sync-personas.js
```

For the full build system documentation — source layout, metadata schema, template syntax, and conventions — see the [Personas Project Manifest](docs/agents/project-manifest/README.md).

---

## Next Steps

1. **Try the workflow**: Start with a small feature to familiarize yourself
2. **Customize personas**: Adapt the agent prompts to your team's conventions
3. **Build system details**: See the [Personas Project Manifest](docs/agents/project-manifest/README.md) for template syntax, metadata schema, and source layout
4. **Review the ledger schema**: Understand all available fields in [project-ledger-schema.md](project-ledger-schema.md)
5. **Explore MCP tools**: The MCP server exposes tools for project lifecycle, work packages, pipelines, observations, and workflow coordination
6. **Share feedback**: Document what works and what doesn't for your use cases

For questions or improvements, refer to the main project [README.md](../../README.md).
