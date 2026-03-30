# Deferred Topics

This document tracks implementation decisions that were deliberately deferred — where a simpler approach was chosen now, with a known future hardening path. Entries are organized by sub-project and use a structured format to keep them scannable and actionable.

---

## Orchestrator

### Curated Environment Injection (Pattern 2)

| Field | Detail |
|-------|--------|
| **Topic** | Curated environment injection for agent subprocesses |
| **Current State** | `LocalShellBackend` is constructed with `inherit_env=True`, which copies the full `os.environ` into every agent subprocess. This unblocks host CLI access (`python`, `npm`, `git`, etc.) on developer machines. |
| **Target State** | Switch to a curated allowlist of safe environment keys — e.g. `PATH`, `HOME`, `USER`, `LANG`, `VIRTUAL_ENV`, `NVM_DIR`, `PYENV_ROOT` — to prevent leaking host secrets (e.g. `AWS_ACCESS_KEY_ID`, API tokens) to agent subprocesses. This is Pattern 2 from the research paper. |
| **Trigger / Timeline** | Before any CI or shared-infrastructure deployment of the orchestrator. Not required for local developer use. |
| **Reference** | `docs/agents/research/2026-03-30-orchestrator-cli-access.md`; inline comment at `orchestrator/src/nodes/__init__.py` (`LocalShellBackend` call site). |

---

## MCP Server

No deferred topics.

---

## Personas

No deferred topics.
