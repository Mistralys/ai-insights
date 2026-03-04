# Question

"When working with subagents in VS Code chat, where an agent runs a subagent using the `runSubagent` tool, when given the exact name of a custom agent added in VS Code, does this subagent get the custom agent's prompt?"

---

# Gemini's Answer

The short answer is **yes**. When an agent uses the `runSubagent` tool (or the underlying `vscode.lm` API to trigger another participant), the subagent retains its identity, including its custom system prompt and specific instructions.

Think of it like delegating a task to a specialist. If you ask a "Code Reviewer" agent to help, it doesn't forget it’s a code reviewer just because another agent was the one to ask.

---

### How the Prompting Works

When a subagent is invoked by name, the VS Code platform routes the request to that specific agent's **Chat Participant Handler**. Here is how the instructions stay intact:

* **Instruction Ownership:** The custom prompt (often called "participant instructions") is baked into the subagent's extension logic. When the tool triggers the subagent, it executes the handler code that explicitly includes those instructions before sending the request to the Language Model (LLM).
* **Context Injection:** The primary agent usually passes a specific "task" or "query" to the subagent. The subagent then wraps that task with its own system prompt (e.g., *"You are an expert in SQL optimization..."*).
* **Isolation:** The subagent operates in its own "execution context." It doesn't just inherit the primary agent's personality; it maintains its own persona as defined in its `package.json` and its implementation logic.

### A Key Distinction: Agent vs. Model

It is important to distinguish between calling an **Agent** and calling a **Language Model**:

| Invocation Type | Does it get the Custom Prompt? |
| --- | --- |
| **`runSubagent(@custom-agent)`** | **Yes.** It triggers the full extension logic, including its system instructions. |
| **`vscode.lm.sendRequest`** | **No.** This calls the raw LLM directly. You would have to manually provide any "custom" instructions in the prompt. |

### Important Nuance: History

While the subagent gets its own *instructions*, it may not automatically see the entire chat history between the user and the primary agent unless the primary agent explicitly passes that context along through the `runSubagent` tool call. The subagent starts with its persona, but it only knows what it's told for that specific turn.

> **Note:** If you are developing an extension, ensure your subagent handler is designed to receive "delegated" requests gracefully, as the "user" in this scenario is actually another AI.
