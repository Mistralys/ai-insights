# Research Report

## Problem Statement
Agents running inside the headless PHP and Python Orchestrator pipelines report that they do not have access to typical CLI commands (like `php` and `python`), preventing them from linting, testing, or executing code. 

## Problem Decomposition
1. **Environment Issue vs. Installation Issue**: Do the agents truly lack the binaries, or are the binaries simply not in the shell's execution path?
2. **Subprocess Isolation Architecture**: How does the underlying dependency (`deepagents`) run tool commands?
3. **Security Constraints**: What are the trade-offs of exposing the host user's environment arrays to the agent execution sandbox?

## Context & Constraints
- **Library Behavior**: The orchestrator wraps agents in the `deepagents.backends.LocalShellBackend`. Inspection of its source code reveals that by default, it does **not** inherit environment variables from the parent process (`inherit_env=False`).
- **Missing `$PATH`**: Because `os.environ` is dropped during initialization of `LocalShellBackend` in `orchestrator/src/nodes/__init__.py:201`, the agent shell subprocess starts with an empty environment array, meaning system `$PATH` variables (like `/usr/bin`, `/opt/homebrew/bin`, `~/.pyenv/shims`) are stripped.
- **Security Check**: Passing `inherit_env=True` to the local shell backend will expose all host environment variables (including potentially sensitive tokens like `AWS_ACCESS_KEY_ID` or local development `.env` configs) to the agent.
- **Cross-Platform Needs**: Any fix should handle macOS, Windows, and Linux transparently without hardcoding `/usr/local/bin` paths.

## Prior Art & Known Patterns

### Pattern 1: Inheriting the Parent Environment (`inherit_env=True`)
- **Description:** Adjust the `LocalShellBackend` initialization inside `orchestrator/src/nodes/__init__.py` to pass `inherit_env=True`. 
- **Where used:** Standard practice in local CLI scripting wraps and build pipelines (e.g. `subprocess.run(env=os.environ)`).
- **Strengths:** 
  - Immediately restores access to `python`, `php`, `npm`, `git`, and all host integrations.
  - Trivial 1-line change (`backend = LocalShellBackend(root_dir=target_path or None, inherit_env=True)`).
- **Weaknesses:** Subprocesses immediately gain access to all host secrets stored in the parent shell environment variables.
- **Fit:** Very high fit. Because these agents execute locally on specific developer hosts rather than shared production infrastructure, inheriting environment data generally aligns with developer expectations of local agents.

### Pattern 2: Explicitly Sandboxing a curated `$PATH`
- **Description:** Instead of importing all of `os.environ`, explicitly detect and pass only a safe subset, most notably `PATH`, `USER`, `HOME`. 
  `env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME")}`.
- **Where used:** Managed worker scripts and cron jobs.
- **Strengths:** Prevents leakage of `API_KEY` style secrets that run in the parent terminal.
- **Weaknesses:** Hard to perfectly emulate interactive shell tools (e.g., node, pyenv, composer) without `HOME`, `USER`, or specific tool root environment variables (e.g., `PYENV_ROOT`). It often leads to cascading issues where a tool is found, but behaves incorrectly due to a missing helper EV.
- **Fit:** High fit, strikes a balance between agent empowerment and local security.

### Pattern 3: True Application Containerization (Docker/E2B)
- **Description:** Replace `LocalShellBackend` entirely with a sandboxed implementation using containerized Docker runners or cloud sandboxes.
- **Where used:** E2B, SWE-Agent, and hosted agentic coding tools.
- **Strengths:** Implements reliable, deterministic execution independent of the developer's laptop quirks. Provides robust security against `rm -rf /`.
- **Weaknesses:** Significant architectural redesign within the orchestrator. DeepAgents Python library may not provide a built-in Docker drop-in without custom backend extensions. Slower runtime performance.
- **Fit:** Poor short-term fit due to heavy implementation cost, but ideal long-term if moving away from local file adjustments.

## Comparative Evaluation
| Criterion         | Pattern 1 (`inherit_env=True`) | Pattern 2 (Curated `$PATH`) | Pattern 3 (Docker Sandbox)  |
|-------------------|--------------------------------|-----------------------------|-----------------------------|
| **Complexity**    | Lowest (1-line code change)    | Low (Dictionary filter)     | Very High                   |
| **Performance**   | Instant (bare metal subshell)  | Instant                     | Moderate (Container bound)  |
| **Maintainability** | High                           | Moderate                    | Low                         |
| **Risk**          | Local System Secret Leakage    | Agent tool failure due EV   | Host Isolation secured      |
| **Time to implement** | Mins                           | Mins                        | Weeks                       |

## Recommendation
**Implement Pattern 2 (Curated Environment Injection) falling back to Pattern 1 as strictly necessary.**

Given the agents are run locally on non-production repositories, the easiest and most effective fix is to provide the agent with local path structures. However, passing every EV raw poses unnecessary risks if the parent orchestrator is run with cloud tokens. 

Modify `orchestrator/src/nodes/__init__.py` to selectively inject safe `os.environ` keys (like `PATH`, `HOME`, `LANG`, `PWD`, `VIRTUAL_ENV`) into `LocalShellBackend`, ensuring the CLI targets are reachable but shielding extraneous token variables.

### Proof‑of‑Concept Outline
1. Open up `orchestrator/src/nodes/__init__.py`.
2. Locate line `~201`: `backend = LocalShellBackend(root_dir=target_path or None)`.
3. Modify to extract and pass safe environment variables:
   ```python
   import os
   
   # Curate safe environment variables to carry over to the agent shell
   safe_keys = {"PATH", "HOME", "USER", "LANG", "VIRTUAL_ENV", "NVM_DIR", "PYENV_ROOT"}
   agent_env = {k: v for k, v in os.environ.items() if k in safe_keys}
   
   backend = LocalShellBackend(
       root_dir=target_path or None,
       env=agent_env
   )
   ```
4. Run agent node tests and confirm standard commands like `python --version` and `php -v` emit successfully.

## Open Questions
- Does `orchestrator` rely on specific Python virtual environments that also modify `sys.prefix` or `VIRTUAL_ENV`? If so, ensuring `PATH` has the active Python environment's `/bin` up front is critical.
- Has the security posture of the project deemed local host code execution acceptable, or is true Docker-based isolation natively planned?

## References
- DeepAgents `LocalShellBackend` Source Code (`lib/python3.14/site-packages/deepagents/backends/local.py`)
- Python `subprocess` documentation regarding `env` propagation.