---
title: Persona Quickstart — IDE
---

# Persona Quickstart — IDE

> Use personas directly inside VS Code, Claude Code, or Cursor.

← [Back to Persona Quickstart](persona-quickstart)

---

There are two paths depending on how much setup you want:

| Path | Best For | Requirements |
|------|----------|--------------|
| **Quick** | Get a persona into your IDE fast | Any AI assistant, no installation |
| **AI Insights** | Best results, structured workflow | Node.js ≥ 18, VS Code or Claude Code |

---

## Quick Path — Any Model, Any IDE

This path takes less than 10 minutes. You use any AI assistant to create the persona, then drop the result into your IDE.

### Step 1: Get the Persona Design Guide

Download the guide from the AI Insights repository:

**[personas/docs/persona-design-guide.md](https://github.com/Mistralys/ai-insights/blob/main/personas/docs/persona-design-guide.md)**

### Step 2: Create the Persona

Open a chat with your preferred model (in the browser or inside your IDE), provide the Design Guide as context, and describe what you need:

> I've attached the Persona Design Guide. Please use it as a reference for creating a new persona.
>
> I need a persona for a **[describe the role]**. Here's what it should do:
>
> - [Key responsibility 1]
> - [Key responsibility 2]
> - [Any specific constraints or preferences]

Review and iterate until the output is right. See [Tips for Better Results](#tips-for-better-results) below.

### Step 3: Save to Your IDE

Save the persona as a Markdown file (`.md`) and place it where your IDE looks for agent/prompt instructions:

| IDE | File Extension | Where to Place It |
|-----|---------------|-------------------|
| **VS Code (GitHub Copilot)** | `.prompt.md` or `.agent.md` | `.github/prompts/` in your workspace |
| **Claude Code** | `.md` | `~/.claude/agents/` (global) or `CLAUDE.md` (project-level) |
| **Cursor** | `.md` | `.cursor/rules/` in your workspace, or project's `.cursorrules` file |

The persona is immediately available once the file is in place — no build step required.

---

## AI Insights Path — Best Results

This path uses the **Persona Curator** agent, a purpose-built persona that creates other personas. It reads the Design Guide automatically, follows a structured creation workflow, and writes the output directly to the right location.

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

## Tips for Better Results

- **Be specific about your domain.** "I plan meals for a family of four, mostly Mediterranean diet, with a well-stocked herb garden" gives the model far more to work with than "I need a meal planning persona."
- **Include your environment and constraints.** If the persona needs to know about your tools, setup, or limitations, say so upfront. Domain knowledge that the model can't guess is exactly what makes a persona powerful.
- **Start with one workflow, then expand.** If the persona has multiple modes (Create / Update / Audit), build the primary mode first. Add the others once that works well.
- **Iterate after real use.** The best refinements come from actually using the persona and noticing where it falls short. Personas are living documents.

---

## What Makes a Good Persona

1. **Identity anchors behavior.** `**Identity: Senior Culinary Consultant.**` is not decoration — it shapes how the model approaches every decision.

2. **Values beat rules for the unexpected.** Rules handle known situations ("use metric units"). Values handle unknown ones ("prioritize novelty over familiarity"). Include an Operating Philosophy for complex roles.

3. **Domain knowledge is your edge.** The model knows general cooking. It does not know that *you* have a cast-iron wok, a clay roaster, and a herb garden. That context transforms generic output into personalized output.

4. **Constraints are load-bearing.** Weak constraints ("try to be concise") are ignored. Strong constraints ("Maximum 3 paragraphs per section. Never exceed 500 words.") are followed.

5. **Personas are living documents.** Every use reveals something to tighten. The best personas are the ones that have been refined through real-world use.

---

## Further Reading

- [Persona Design Guide](https://github.com/Mistralys/ai-insights/blob/main/personas/docs/persona-design-guide.md) — Full structural and stylistic reference
- [Persona Quickstart — Web](persona-quickstart-web) — Guide for Gemini, Claude, ChatGPT, and Grok
- [AI Insights Repository](https://github.com/Mistralys/ai-insights) — The complete toolkit
