# Agent References

Reference documents for deeper, topic-specific guidance used across the AI Insights agent ecosystem.

## Index

| Document | Scope |
|----------|-------|
| [ledger-workflow-visual-guide.md](ledger-workflow-visual-guide.md) | Diagram-first view of the ledger workflow, handoffs, sub-agents, pipeline ordering, and knowledge flow |
| [ctx-generator-guide.md](ctx-generator-guide.md) | CTX generator reference for authoring and maintaining context.yaml configuration |
| [langgraph-deep-agents-subagent-handbook.md](langgraph-deep-agents-subagent-handbook.md) | Practical handbook for Deep Agents personas, subagent delegation, and LangGraph setup |
| [claude-code-subagent-dispatch.md](claude-code-subagent-dispatch.md) | Observed Claude Code sub-agent dispatch and waiting behaviour, with evidence and a hung-chain debugging checklist |

## When To Use Which

- Use the visual guide when you need a fast mental model of end-to-end ledger execution.
- Use the CTX guide when changing generated context docs or context.yaml structure.
- Use the Deep Agents handbook when extending orchestrator or persona-driven subagent patterns.
- Use the Claude Code dispatch reference when writing a persona that dispatches sub-agents, or when debugging a hung Claude Code chain.
