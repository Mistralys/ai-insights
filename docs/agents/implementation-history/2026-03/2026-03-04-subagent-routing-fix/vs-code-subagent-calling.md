You *can* target a specific custom subagent by name, but VS Code’s rules for how this works are a bit unintuitive. The key is that **`runSubagent` does not take an explicit `agentName` parameter**. Instead, VS Code routes the call based on **the agent that is invoking the tool** and the **custom agent definitions in your settings**.

The reliable way to ensure the correct persona is invoked is:

---

## 🎯 How VS Code decides which subagent to run

VS Code uses a simple routing rule:

> **The subagent that runs is the one whose `id` matches the name you pass in the `#runSubagent` tool call.**

This means your agent must call the tool like:

```
#runSubagent("myCustomAgent", "prompt text")
```

But because the tool schema only exposes `prompt` and `description`, the *agent name* is actually encoded **inside the prompt**, using a special prefix format that VS Code recognizes.

This is the part that trips up most agents.

---

## 🧩 The correct format for targeting a specific custom agent

To run a specific custom agent, the prompt must begin with:

```
@agentName
```

For example:

```
@myCustomAgent
Please summarize this code.
```

VS Code interprets the `@myCustomAgent` prefix as the routing instruction.

Your agent should therefore call:

```
runSubagent({
  prompt: "@myCustomAgent\n" + actualPrompt,
  description: "whatever"
})
```

This is the **only** supported way to select a specific subagent.

---

## 🛠️ Requirements for this to work

### 1. The agent must be defined in your settings.json

Example:

```json
"chat.customAgents": [
  {
    "id": "myCustomAgent",
    "name": "My Custom Agent",
    "model": "gpt-4o",
    "instructions": "You are a strict TypeScript reviewer."
  }
]
```

### 2. You must enable subagent usage

```json
"chat.customAgentInSubagent.enabled": true
```

### 3. The `id` must match exactly

Case-sensitive, no spaces.

---

## 🧭 How to make your agent reliably choose the right subagent

Inside your agent’s logic, enforce a rule like:

- If the user requests a specific persona → prepend `@personaName` to the prompt.
- If the agent itself decides which persona to use → same mechanism.

Example internal rule:

```
If user says "use the reviewer agent":
    runSubagent.prompt = "@reviewer " + userPrompt
```

This avoids ambiguity and ensures VS Code routes correctly.

---

## 🧪 How to test that it works

1. Open the VS Code Chat sidebar.
2. Type:

```
@myCustomAgent What is your system prompt?
```

If the agent responds with its custom instructions, routing works.

Then test via your agent:

```
Ask the reviewer agent to check this code:
function x() {}
```

Your agent should call `runSubagent` with:

```
prompt: "@reviewer\nCheck this code: function x() {}"
```

---

## 🔍 Why your agent was confused

Because the tool schema only exposes:

- `prompt`
- `description`

…your agent assumed there was no way to specify the subagent.  
But VS Code uses **prompt prefix routing**, not parameters.
