"""
fake_chat_model.py — ToolCallableFakeChatModel for deterministic Deep Agent tests.

Subclasses ``GenericFakeChatModel`` with three targeted overrides to support
tool-calling workflows without consuming LLM API tokens.

Usage::

    from langchain_core.messages import AIMessage
    from tests.helpers.fake_chat_model import ToolCallableFakeChatModel

    model = ToolCallableFakeChatModel(messages=iter([
        AIMessage(content="", tool_calls=[{
            "name": "ledger_begin_work",
            "args": {"work_package_id": "WP-001", "type": "implementation",
                     "agent_role": "Developer"},
            "id": "call_1",
            "type": "tool_call",
        }]),
        AIMessage(content="Implementation complete."),
    ]))
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any

from langchain_core.callbacks.manager import CallbackManagerForLLMRun
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult


class ToolCallableFakeChatModel(GenericFakeChatModel):
    """A ``GenericFakeChatModel`` subclass that preserves ``tool_calls`` through streaming.

    Key differences from ``GenericFakeChatModel``:

    - ``bind_tools()`` is a no-op returning ``self``.  Deep Agents calls
      ``bind_tools`` during construction; without this override the call would
      propagate to ``BaseChatModel.bind_tools`` which raises
      ``NotImplementedError``.
    - ``_generate()`` catches ``StopIteration`` so an exhausted scripted iterator
      returns a terminal message instead of propagating a ``RuntimeError``.
    - ``_stream()`` preserves ``tool_calls`` on the yielded ``AIMessageChunk``.
      It does **not** call ``super()._stream()`` because the parent's
      implementation calls ``_generate()`` internally, which would
      double-advance the scripted iterator and silently skip a scripted message.
    """

    def bind_tools(self, *args: Any, **kwargs: Any) -> ToolCallableFakeChatModel:
        """No-op — Deep Agents calls ``bind_tools`` during agent construction."""
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Advance the scripted iterator; return a terminal message when exhausted.

        Catches ``StopIteration`` raised by the parent when the iterator runs
        out and returns a safe sentinel ``AIMessage`` rather than letting a
        ``RuntimeError`` propagate.
        """
        try:
            return super()._generate(
                messages, stop=stop, run_manager=run_manager, **kwargs
            )
        except StopIteration:
            terminal = AIMessage(content="[end of scripted responses]")
            return ChatResult(generations=[ChatGeneration(message=terminal)])

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        """Yield the next scripted message as streaming chunks.

        - If the scripted message has non-empty ``tool_calls``, emits a single
          ``AIMessageChunk`` with those tool calls preserved so that the Deep
          Agents harness can dispatch them.
        - For text-only messages, splits ``content`` on whitespace
          (``re.split(r"(\\s)", content)``) and yields one
          ``ChatGenerationChunk`` per token, mirroring the parent's behaviour.

        Does **not** call ``super()._stream()`` to avoid double-advancing the
        scripted iterator (the parent's ``_stream`` calls ``_generate``
        internally).
        """
        result = self._generate(
            messages, stop=stop, run_manager=run_manager, **kwargs
        )
        message = result.generations[0].message

        if message.tool_calls:
            # Yield a single chunk with tool calls intact so the framework can
            # route them to the appropriate mock tools.
            chunk = ChatGenerationChunk(
                message=AIMessageChunk(
                    content=message.content or "",
                    tool_calls=message.tool_calls,
                    id=message.id,
                )
            )
            if run_manager:
                run_manager.on_llm_new_token("", chunk=chunk)
            yield chunk
        else:
            # Text-only message: split on whitespace and yield one token per chunk.
            content = message.content
            if content:
                if not isinstance(content, str):
                    raise ValueError("Expected content to be a string.")
                content_chunks = re.split(r"(\s)", content)
                for token in content_chunks:
                    chunk = ChatGenerationChunk(
                        message=AIMessageChunk(content=token, id=message.id)
                    )
                    if run_manager:
                        run_manager.on_llm_new_token(token, chunk=chunk)
                    yield chunk
