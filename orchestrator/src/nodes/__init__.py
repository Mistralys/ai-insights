"""
nodes — One module per pipeline stage.

Each node module exposes a ``make_<stage>_node(config, mcp_tools)`` factory
that returns a LangGraph node function.  The generic scaffolding lives here in
:func:`create_stage_node`; individual modules provide stage-specific prompt
builders.

Public factories
----------------
- :func:`create_stage_node` — Generic factory used internally by each module.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from src.config import Config
    from src.state import WorkflowState

log = logging.getLogger(__name__)


def create_stage_node(
    stage: str,
    build_prompt: Callable[["WorkflowState"], str],
    config: "Config",
    mcp_tools: list[Any],
) -> Callable[["WorkflowState"], dict]:
    """
    Generic LangGraph node factory.

    Parameters
    ----------
    stage:
        Stage name matching a key in :data:`~src.config.PERSONA_FILES`
        (e.g. ``"developer"``).
    build_prompt:
        Callable ``(state) -> str`` that produces the user-turn prompt for
        this stage.  Receives the full :class:`~src.state.WorkflowState`.
    config:
        Application config (provides ``model_name``, ``workspace_root``).
    mcp_tools:
        LangChain tool objects from the shared :class:`~src.mcp_client.MCPToolkit`.

    Returns
    -------
    Callable[[WorkflowState], dict]
        A LangGraph node function that creates a Deep Agent, invokes it, and
        returns a state-update dict.
    """

    def node_fn(state: "WorkflowState") -> dict:
        from deepagents import create_deep_agent  # type: ignore[import]
        from deepagents.backends import LocalShellBackend  # type: ignore[import]

        from src.utils.persona import load_persona

        try:
            persona_prompt = load_persona(stage, workspace_root=config.workspace_root)
            user_prompt = build_prompt(state)

            target_path: str = state.get("target_project_path", "")  # type: ignore[call-overload]
            backend = LocalShellBackend(root_dir=target_path or None)

            agent = create_deep_agent(
                model=config.model_name,
                backend=backend,
                system_prompt=persona_prompt,
                tools=mcp_tools,
            )

            result = agent.invoke({"messages": [{"role": "user", "content": user_prompt}]})
            final_content: str = result["messages"][-1].content  # type: ignore[index]

            log.info("Stage %s completed successfully.", stage)
            return {
                "stage_result": final_content,
                "stage_success": True,
                "run_log": [
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "stage": stage,
                        "wp_id": state.get("current_wp_id", ""),  # type: ignore[call-overload]
                        "action": "stage_complete",
                        "result": "PASS",
                    }
                ],
            }

        except Exception as exc:  # noqa: BLE001
            ts = datetime.now(timezone.utc).isoformat()
            log.error("Stage %s failed: %s", stage, exc, exc_info=True)
            return {
                "stage_result": "",
                "stage_success": False,
                "errors": [
                    {
                        "timestamp": ts,
                        "stage": stage,
                        "wp_id": state.get("current_wp_id", ""),  # type: ignore[call-overload]
                        "message": str(exc),
                    }
                ],
                "run_log": [
                    {
                        "timestamp": ts,
                        "stage": stage,
                        "wp_id": state.get("current_wp_id", ""),  # type: ignore[call-overload]
                        "action": "stage_error",
                        "result": "FAIL",
                        "error": str(exc),
                    }
                ],
            }

    node_fn.__name__ = f"{stage}_node"
    node_fn.__qualname__ = f"{stage}_node"
    return node_fn
