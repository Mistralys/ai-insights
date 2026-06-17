---
title: Persona Quickstart Guide
---

# Persona Quickstart Guide

> How to create your own AI agent persona — from zero to a working prompt file.

This guide covers two paths to creating a persona. Pick whichever suits your situation:

| Path | Best For | Requirements |
|------|----------|--------------|
| **A — Standalone** | Quick start | Any AI chat interface (Gemini, Copilot, Claude...) |
| **B — With AI Insights** | Best results | VS Code or Claude Code + the AI Insights project |

Both paths produce a well-structured persona file you can use in any AI chat interface or IDE.

---

## Path A — Standalone (Any Model)

This path works with any capable model. You download the Persona Design Guide, give it to the model, and describe the persona you want. The model does the rest.

### Step 1: Get the Persona Design Guide

Download the guide from the AI Insights repository:

**[personas/docs/persona-design-guide.md](https://github.com/Mistralys/ai-insights/blob/main/personas/docs/persona-design-guide.md)**

This is a comprehensive reference document that teaches the model the structure, principles, and quality standards for persona creation.

### Step 2: Start a Conversation

Open a chat with your preferred model (Claude, Gemini, ChatGPT, etc.) and provide the guide as context. You can:

- **Upload it** as a file attachment (Claude, Gemini, ChatGPT all support file uploads).
- **Paste it** directly into the chat if file uploads are not available.
- **Add it as project instructions** (Claude Projects, Gemini Gems, ChatGPT Projects) so it persists across conversations.

Then send a message like:

> I've attached the Persona Design Guide. Please use it as a reference for creating a new persona.
>
> I need a persona for **[describe the role]**. Here's what it should do:
>
> - [Key responsibility 1]
> - [Key responsibility 2]
> - [Any specific constraints or preferences]

### Step 3: Review and Iterate

The model will produce a complete persona following the guide's structure:

- **Mission** with an identity anchor
- **Inputs** and **Outputs**
- **Rules & Constraints**
- **Workflow** with numbered steps

Review the output. Common things to refine:

| What to Check | Why |
|---------------|-----|
| Is the identity specific enough? | "Technical Writer" produces different behavior than "Senior API Documentation Architect." |
| Are constraints concrete? | "Be careful with formatting" is weak. "Use Markdown headers. Never use HTML." is strong. |
| Does the workflow end with a clear handoff? | The model should know exactly how to signal completion. |
| Is there an Operating Philosophy? | For judgment-heavy roles, guiding principles dramatically improve output quality. |

Ask the model to revise specific sections until you're satisfied.

### Step 4: Save and Use

Save the persona as a Markdown file (`.md`). You can now use it by:

- **Pasting it** at the start of a new chat session.
- **Adding it as project instructions** in Claude, Gemini, or ChatGPT.
- **Saving it as a `.agent.md` file** in your VS Code workspace (`.github/prompts/` for Copilot, or wherever your IDE expects custom agent instructions).

### Tips for Better Results

- **Be specific about your domain.** "I plan meals for a family of four, mostly Mediterranean diet, with a well-stocked herb garden" gives the model far more to work with than "I need a meal planning persona."
- **Include equipment and constraints.** If the persona needs to know about your tools, environment, or limitations, say so. Domain knowledge that the model can't guess is exactly what makes a persona powerful.
- **Start with one workflow, then expand.** If the persona has multiple modes (e.g., Create / Update / Audit), start with the primary mode. Add the others once the first one works well.
- **Iterate after real use.** The best refinements come from actually using the persona and noticing where it falls short. Personas are living documents.

---

## Path B — With the AI Insights Project

This path uses the **Persona Curator** agent, a purpose-built persona that creates other personas. It reads the Design Guide automatically and follows a structured creation workflow.

### Prerequisites

- **VS Code** or **Claude Code**
- **Node.js** >= 18

### Step 1: Clone and Set Up

```bash
git clone https://github.com/Mistralys/ai-insights.git
cd ai-insights
./menu.sh          # macOS / Linux
menu.cmd           # Windows
```

On first launch, the setup wizard installs dependencies, builds the project, and syncs personas to your IDE. The **Persona Curator** agent will be available after setup completes.

### Step 2: Activate the Persona Curator

In your IDE:

- **VS Code (Copilot):** Open the Copilot Chat panel, click the agent/mode selector, and choose **Persona Curator**.
- **Claude Code:** Start a conversation with `/persona-curator` or load the persona from `~/.claude/agents/`.

### Step 3: Describe What You Need

Tell the Persona Curator what kind of persona you want:

> Create a new persona for a **Travel Research Analyst**. It should:
>
> - Research destinations based on travel preferences and constraints
> - Produce structured itinerary recommendations with alternatives
> - Consider budget, season, dietary needs, and accessibility
> - Always include off-the-beaten-path options alongside popular choices

The Persona Curator will:

1. Read the Persona Design Guide automatically.
2. Ask clarifying questions if needed (professional identity, output format, tools, etc.).
3. Draft a complete persona following the guide's structure and conventions.
4. Run a quality checklist against the Design Guide.
5. Write the persona source files to the appropriate directory.

### Step 4: Build and Deploy

After the Persona Curator creates the source files, build and deploy:

```bash
./menu.sh sync-personas
```

This compiles the persona and deploys it to your IDE's prompts directory. The new persona is immediately available for use.

### Step 5: Use, Observe, Refine

Use the new persona in real work. When you notice areas for improvement, return to the Persona Curator in **Maintain** mode:

> The Travel Research Analyst persona doesn't consider visa requirements. Can you add that to the constraints and workflow?

The Persona Curator modifies the source files, and you rebuild with `./menu.sh sync-personas`.

---

## What Makes a Good Persona

Regardless of which path you take, these principles produce the best results:

1. **Identity anchors behavior.** `**Identity: Senior Culinary Consultant.**` is not decoration — it shapes how the model approaches every decision.

2. **Values beat rules for the unexpected.** Rules handle known situations ("use metric units"). Values handle unknown ones ("prioritize novelty over familiarity"). Include an Operating Philosophy for complex roles.

3. **Domain knowledge is your edge.** The model knows general cooking. It does not know that *you* have a cast-iron wok, a clay roaster, and a herb garden. That context transforms generic output into personalized output.

4. **Constraints are load-bearing.** Weak constraints ("try to be concise") are ignored. Strong constraints ("Maximum 3 paragraphs per section. Never exceed 500 words.") are followed.

5. **Personas are living documents.** Every use reveals something to tighten. The best personas are the ones that have been refined through real-world use.

---

## Further Reading

- [Persona Design Guide](https://github.com/Mistralys/ai-insights/blob/main/personas/docs/persona-design-guide.md) — Full structural and stylistic reference
- [AI Insights Repository](https://github.com/Mistralys/ai-insights) — The complete toolkit
- [Persona Builder](https://github.com/Mistralys/persona-builder) — The template engine behind the persona build system
