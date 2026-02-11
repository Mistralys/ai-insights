# Agentic Coding Workflow - Vanilla

## Overview

This is a structured multi-agent workflow for systematic software development. Unlike the ledger-enabled workflow, this version uses Markdown documents to track progress, making it simpler but with less automated state management.

### Why Use This Workflow?

- **Simplicity**: No JSON ledger to maintain—just Markdown files
- **Documentation Focus**: All outputs are human-readable Markdown documents
- **Separation of Concerns**: Each agent focuses on a specific role (planning, implementation, QA, review)
- **Traceability**: Track progress through a series of dated Markdown files
- **Flexibility**: Easier to customize and adapt to specific needs
- **Version Control Friendly**: All artifacts are Markdown files that diff well in Git

### Agents in the Workflow

1. **Planner Agent**: Creates high-level strategy and implementation plan
2. **Project Manager Agent**: Breaks plan into work packages
3. **Developer Agent**: Implements work packages and creates implementation summaries
4. **Validator Agent**: Verifies acceptance criteria and runs tests
5. **Reviewer Agent**: Performs code quality and architecture review
6. **Documentation Agent**: Updates project documentation
7. **Synthesis Agent**: Consolidates all reports into final project status

---

## Quick Reference

**For experienced users** - follow these steps (expand sections below for detailed instructions):

1. **[Setup](#prerequisites)**: Create `/docs/agents/plans/` directory in your project
2. **[Planning](#stage-1-planning)**: New chat → Open context files → Paste [1-planner.md](1-planner.md) → Describe feature → Review plan
3. **[Project Management](#stage-2-project-management)**: New chat → Open plan document → Paste [2-project-manager.md](2-project-manager.md) → Review work packages
4. **[Implementation](#stage-3-implementation-iterative)**: New chat → Open work packages → Paste [3-developer.md](3-developer.md) → Specify work package → Review code & implementation summary
5. **[Validation](#stage-4-validation-per-work-package)**: New/continue chat → Open work packages & impl summary → Paste [4-validator.md](4-validator.md) → Review QA report
6. **[Review](#stage-5-code-review-per-work-package)**: New/continue chat → Open QA report & code → Paste [5-reviewer.md](5-reviewer.md) → Review findings
7. **[Documentation](#stage-6-documentation-update)**: New chat → Open all reports → Paste [6-documentation.md](6-documentation.md) → Review updates
8. **[Synthesis](#stage-7-synthesis--reporting)**: New chat → Open all documents → Paste [7-synthesis.md](7-synthesis.md) → Review final report

**Repeat steps 4-6** for each work package. See detailed instructions below for tips, troubleshooting, and best practices.

---

## Prerequisites

### Initial Project Setup

Before starting the workflow, ensure your project has:

1. **Documentation Structure**: Create `/docs/agents/plans/` directory in your project
   ```bash
   mkdir -p docs/agents/plans
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
- The plan document is your source of truth for the entire project

---

### Stage 2: Project Management

**Goal**: Break the plan into actionable work packages

1. **Start a new chat session** (fresh context)
2. **Open the plan document** created in Stage 1
3. **Copy and send** the contents of [2-project-manager.md](2-project-manager.md)
4. **Review the work packages** for logical sequencing and dependencies
5. **Verify output**: Work packages document saved to `/docs/agents/plans/{plan-name}-work.md`

**What the work packages document contains**:
- Overview table with work package IDs, descriptions, and dependencies
- Detailed specifications for each package including:
  - Description and scope
  - Acceptance criteria
  - Dependencies
  - Technical notes
  - Estimated complexity

**Tips**:
- Check that dependencies between work packages are correctly identified
- Ensure each package has clear, testable acceptance criteria
- Verify the packages are appropriately sized (not too large or too small)
- Note the suggested implementation order

---

### Stage 3: Implementation (Iterative)

**Goal**: Implement work packages one at a time

For **each work package**:

1. **Start a new chat session** (or continue if working on related packages)
2. **Open the work packages document** (`{plan-name}-work.md`)
3. **Copy and send** the contents of [3-developer.md](3-developer.md)
4. **Specify which work package** to implement (e.g., "Implement WP-1")
5. **Review the code changes** as they're made
6. **Verify outputs**:
   - Code changes in your project files
   - Implementation summary saved to `/docs/agents/plans/{plan-name}-impl.md`
   - Work package marked as completed in the work packages document

**What the implementation summary contains**:
- Summary of changes (files modified/created)
- Implementation details and design decisions
- Verification results and test outcomes
- Updated work package status
- Blockers, observations, or technical debt notes

**Tips**:
- Keep related files open for the agent to reference
- Review code incrementally if work packages are large
- Check that the agent follows your project's coding conventions
- Note any insights or improvement opportunities in the summary
- The summary document grows with each work package implementation

---

### Stage 4: Validation (Per Work Package)

**Goal**: Verify acceptance criteria and run tests

1. **Start a new chat session** or continue from implementation
2. **Open these files**:
   - Work packages document (for acceptance criteria)
   - Implementation summary (to see what was implemented)
   - Implemented code files
3. **Copy and send** the contents of [4-validator.md](4-validator.md)
4. **Specify the work package** to validate
5. **Review validation results** in the QA report
6. **Verify output**: QA report saved to `/docs/agents/plans/{plan-name}-qa.md`

**What the QA report contains**:
- Final status (PASS/FAIL/BOUNCE)
- Acceptance criteria checklist with evidence
- Test execution logs and results
- Regression testing outcomes
- Edge cases tested
- Recommendations for future testing
- Updated work package status

**Tips**:
- Ensure test environment is properly configured
- Review edge cases the agent identifies
- If validation fails, address issues before proceeding to review
- Check for regression issues in existing functionality
- The QA report grows with each work package validation

---

### Stage 5: Code Review (Per Work Package)

**Goal**: Ensure code quality, maintainability, and architectural alignment

1. **Start a new chat session** or continue from validation
2. **Open these files**:
   - Work packages document
   - Implementation summary
   - QA report
   - Implemented code
3. **Copy and send** the contents of [5-reviewer.md](5-reviewer.md)
4. **Review the analysis** covering:
   - Maintainability assessment
   - Best practices compliance
   - Security and performance review
   - Architectural alignment
5. **Address blocking issues** if any are identified
6. **Verify output**: Code review report saved to `/docs/agents/plans/{plan-name}-review.md`

**What the review report contains**:
- Final status (PASS/FAIL)
- Maintainability assessment with code readability score
- Best practices compliance rating
- Security and performance findings
- Strategic insights and "gold nuggets"
- Blocking vs. non-blocking issues
- Next steps and refactoring recommendations

**Tips**:
- Pay attention to technical debt warnings
- Note non-blocking suggestions for future iterations
- Ensure security vulnerabilities are addressed before moving on
- Review "gold nuggets" for valuable architectural insights
- The review report grows with each work package review

---

### Stage 6: Documentation Update

**Goal**: Keep documentation synchronized with code changes

1. **Start a new chat session**
2. **Open these files**:
   - Work packages document
   - All implementation summaries, QA reports, and review reports
   - Current project documentation (README, API docs)
3. **Copy and send** the contents of [6-documentation.md](6-documentation.md)
4. **Review documentation updates**:
   - Updated API references
   - New configuration instructions
   - Architecture diagram changes
   - User-facing feature documentation
5. **Verify outputs**:
   - Updated documentation files (README.md, docs/*.md)
   - Documentation summary saved to `/docs/agents/plans/{plan-name}-docs.md`

**What the documentation summary contains**:
- List of files updated
- Description of changes made to each file
- New sections added
- Deprecated features documented
- Configuration updates

**Tips**:
- Ensure all new features are documented
- Verify code examples in docs are accurate
- Check that breaking changes are clearly noted
- Update user-facing documentation if applicable
- Consider creating migration guides for breaking changes

---

### Stage 7: Synthesis & Reporting

**Goal**: Generate comprehensive project status report

1. **Start a new chat session**
2. **Open all generated files**:
   - Plan document
   - Work packages document
   - Implementation summaries
   - QA reports
   - Code review reports
   - Documentation summary
3. **Copy and send** the contents of [7-synthesis.md](7-synthesis.md)
4. **Review the generated report** covering:
   - Executive summary of what was built
   - Metrics (tests passed, coverage, issues found)
   - Strategic recommendations and insights
   - Technical debt and refactoring opportunities
   - Next steps and future work
5. **Verify output**: Final report saved to `/docs/agents/plans/{plan-name}-report.md`

**What the final report contains**:
- Executive summary
- Overall project status (COMPLETE/PARTIAL/BLOCKED)
- Detailed metrics and quality scores
- Work package completion status
- All files created and modified
- Aggregated insights from all agents
- Strategic recommendations
- Technical debt inventory
- Next steps and future considerations
- Lessons learned

**Tips**:
- Use this report for stakeholder communication
- Review strategic insights for future planning
- Archive all documents for project history
- Identify technical debt and improvement opportunities
- Share lessons learned with your team

---

## Document Naming Conventions

All agent outputs follow a consistent naming pattern based on the plan file name:

| Agent | Output File | Example |
|-------|-------------|---------|
| Planner | `YYYY-MM-DD-feature-name.md` | `2026-02-11-user-auth.md` |
| Project Manager | `{plan-name}-work.md` | `2026-02-11-user-auth-work.md` |
| Developer | `{plan-name}-impl.md` | `2026-02-11-user-auth-impl.md` |
| Validator | `{plan-name}-qa.md` | `2026-02-11-user-auth-qa.md` |
| Reviewer | `{plan-name}-review.md` | `2026-02-11-user-auth-review.md` |
| Documentation | `{plan-name}-docs.md` | `2026-02-11-user-auth-docs.md` |
| Synthesis | `{plan-name}-report.md` | `2026-02-11-user-auth-report.md` |

**Note**: Implementation, QA, and Review files are appended to with each work package, creating a complete history of the project.

---

## Best Practices

### Context Management

- **Fresh sessions**: Start new chats between major stages to avoid context bloat
- **Keep files open**: Have relevant documents visible to provide context automatically
- **Sequential reading**: Open documents in order (plan → work → impl → qa → review) when needed

### Document Hygiene

- **Commit regularly**: Version control all Markdown documents with your code
- **Review outputs**: Check that agents update documents correctly after each stage
- **Organize by date**: Use date prefixes in plan names for easy chronological sorting
- **Archive completed projects**: Move finished plan documents to an archive folder

### Workflow Flexibility

- **Skip stages**: For simple tasks, you may skip validation or review
- **Iterate**: Return to earlier stages if issues are discovered
- **Adapt personas**: Modify agent prompts to fit your team's specific needs
- **Batch work**: Implement multiple related work packages in one session if appropriate
- **Merge documents**: For small projects, agents can append to a single progress document

### Quality Gates

- Never skip validation for customer-facing features
- Always review security-critical code
- Update documentation for public APIs and configuration changes
- Run synthesis after completing all work packages

### Working with Multiple Developers

- **Assign work packages**: Different developers can work on independent packages
- **Share documents**: Keep all agent-generated documents in a shared location
- **Update status**: Manually update work package status in the work packages document
- **Merge summaries**: Combine implementation summaries from multiple developers

---

## Troubleshooting

### Common Issues

**Agent can't find previous documents**:
- Ensure all files are in `/docs/agents/plans/` directory
- Keep relevant documents open in the editor
- Check file naming follows the conventions

**Work package dependencies not followed**:
- Review the work packages document's dependency table
- Implement packages in the suggested order
- Update work package status as you complete them

**Context getting lost between stages**:
- Start fresh chat sessions between major stages
- Keep the work packages document open as anchor context
- Explicitly reference work package IDs in prompts

**Agent not updating status correctly**:
- Remind the agent to update the work packages document
- Manually update status if needed (mark as "COMPLETED")
- Check that status indicators are clear (READY/IN_PROGRESS/COMPLETED)

**Documents getting too large**:
- Split large projects into multiple plans
- Create separate implementation summaries per major feature area
- Archive older sections of growing documents

### Recovery Strategies

**If validation fails**:
1. Review the QA report for specific failure details
2. Return to Stage 3 (Implementation) with the same work package
3. Reference the QA report in your prompt to the developer
4. Re-run validation after fixes

**If the workflow gets interrupted**:
1. Open the work packages document to check progress
2. Review the latest implementation/QA/review files
3. Identify which work packages are completed
4. Resume at the appropriate stage for the next work package

**If you need to change the plan**:
1. Update the plan document manually or with the Planner agent
2. Have the Project Manager regenerate work packages
3. Note the plan revision in the work packages document
4. Continue with updated work packages

**If multiple agents disagree**:
1. Review all relevant reports (impl, QA, review)
2. Make a judgment call or consult with team
3. Document the decision in the work packages document
4. Update affected work package status accordingly

---

## Advanced Usage

### Parallel Work Packages

For independent work packages, you can run multiple implementation sessions in parallel:
- Use separate chat sessions for each package
- Ensure packages don't modify the same files
- Manually merge implementation summaries
- Coordinate on work package status updates

### Simplified Workflow

For small projects, combine stages:
- **Planning + PM**: Create both plan and work packages in one session
- **Implementation + Validation**: Have developer run tests immediately
- **Review + Documentation**: Combined quality check and doc update
- **Single Document**: Use one progress document instead of separate files

### Custom Report Templates

Modify the synthesis agent to generate custom reports:
- Add project-specific metrics (performance benchmarks, bundle sizes)
- Include custom sections (deployment checklist, rollback plan)
- Format for specific audiences (technical vs. stakeholder)
- Generate automated changelogs from work package completions

### Integration with Tools

- **Git Hooks**: Automatically commit agent documents after each stage
- **CI/CD**: Parse QA reports to fail builds on validation failures
- **Project Management**: Import work packages into task tracking tools
- **Documentation Sites**: Auto-publish agent docs to documentation portals

---

## Comparison: Vanilla vs. Ledger-Enabled Workflows

| Feature | Vanilla | Ledger-Enabled |
|---------|---------|----------------|
| **State Management** | Markdown documents | JSON ledger file |
| **Complexity** | Simpler | More structured |
| **Automation** | Manual updates | Automated tracking |
| **Dependencies** | Documented in text | Tracked in JSON |
| **Metrics** | Narrative reports | Quantitative data |
| **Tool Integration** | Manual parsing | JSON parsing |
| **Learning Curve** | Easier | Steeper |
| **Best For** | Small to medium projects | Large, complex projects |
| **Session Recovery** | Read documents | Read ledger JSON |
| **Multi-agent Coordination** | Manual handoffs | Structured state machine |

**Choose Vanilla when**:
- Working on smaller projects
- Prefer simplicity over automation
- Want human-readable outputs only
- Don't need automated metrics
- Learning the workflow for the first time

**Choose Ledger-Enabled when**:
- Working on large, complex projects
- Need automated state management
- Want quantitative metrics and tracking
- Have multiple dependencies to manage
- Need better tool integration
- Want automated progress tracking

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
                    │ Work Packages
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

---

## File Structure After Running Workflow

```
your-project/
├── docs/
│   ├── agents/
│   │   └── plans/
│   │       ├── 2026-02-11-feature-name.md          # Plan document
│   │       ├── 2026-02-11-feature-name-work.md     # Work packages
│   │       ├── 2026-02-11-feature-name-impl.md     # Implementation summaries (grows)
│   │       ├── 2026-02-11-feature-name-qa.md       # QA reports (grows)
│   │       ├── 2026-02-11-feature-name-review.md   # Review reports (grows)
│   │       ├── 2026-02-11-feature-name-docs.md     # Documentation summary
│   │       └── 2026-02-11-feature-name-report.md   # Final project report
│   └── [other project docs]
└── [your source code]
```

---

## Next Steps

1. **Try the workflow**: Start with a small feature to familiarize yourself
2. **Customize personas**: Adapt the agent prompts to your team's conventions
3. **Establish naming conventions**: Decide on your preferred file naming pattern
4. **Set up templates**: Create project-specific templates for common report sections
5. **Consider upgrading**: If complexity grows, explore the [ledger-enabled workflow](../ledger/README.md)
6. **Share feedback**: Document what works and what doesn't for your use cases

For questions or improvements, refer to the main project [README.md](../../README.md).
