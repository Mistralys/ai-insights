"""Quick test: does LangGraph pass custom configurable keys to nodes?"""
import asyncio
from operator import add
from typing import Annotated, TypedDict

import aiosqlite
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph


class S(TypedDict):
    x: Annotated[list, add]


def node(state, config=None):
    configurable = (config or {}).get("configurable", {})
    has_custom = "my_obj" in configurable
    return {"x": [f"got_config={has_custom}"]}


async def main():
    builder = StateGraph(S)
    builder.add_node("a", node)
    builder.add_edge(START, "a")
    builder.add_edge("a", END)

    # Without checkpointer
    g1 = builder.compile()
    r1 = g1.invoke({"x": []}, {"configurable": {"my_obj": "hello"}})
    print("Without checkpointer:", r1["x"])

    # With checkpointer
    conn = await aiosqlite.connect(":memory:")
    cp = AsyncSqliteSaver(conn)
    await cp.setup()
    g2 = builder.compile(checkpointer=cp)
    r2 = await g2.ainvoke(
        {"x": []},
        {"configurable": {"thread_id": "t1", "my_obj": "hello"}},
    )
    print("With checkpointer:", r2["x"])
    await conn.close()


asyncio.run(main())
