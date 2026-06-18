---
title: Persona Quickstart — Web
---

# Persona Quickstart — Web

> Create a persona using any AI chat interface. No installation required.

← [Back to Persona Quickstart](persona-quickstart)

---

This guide walks you through creating a persona using a web-based AI assistant — Gemini Gems, Claude Projects, ChatGPT, Grok, or any other capable model — and saving it to your chosen platform.

---

## Step 1: Get the Persona Design Guide

Download the guide from the AI Insights repository:

**[personas/docs/persona-design-guide.md](https://github.com/Mistralys/ai-insights/blob/main/personas/docs/persona-design-guide.md)**

This document teaches the model the structure, principles, and quality standards for persona creation. It's the foundation for everything that follows — the model needs it to produce good output.

---

## Step 2: Provide the Guide as Context

Open a chat with your preferred model and give it the Design Guide. How you do this depends on the platform:

| Platform | How to Provide the Guide |
|----------|--------------------------|
| **Claude** | Upload the file as an attachment, or add it to a Claude Project's instructions |
| **Gemini** | Upload the file as an attachment, or add it to a Gem's instructions |
| **ChatGPT** | Upload the file as an attachment, or add it to a GPT's system prompt |
| **Grok** | Paste the content directly into the chat |
| **Any other** | Paste the content directly if file uploads are not available |

For platforms that support persistent project instructions (Claude Projects, Gemini Gems, ChatGPT custom GPTs), adding the guide there means it's available for every future persona you create — you won't need to re-upload it.

---

## Step 3: Describe Your Persona

Once the guide is in context, tell the model what you need. Be as specific as possible about the role, domain, and how you'll use the persona.

**Example prompt:**

> I've attached the Persona Design Guide. Please use it as a reference for creating a new persona.
>
> I need a persona for a **Travel Research Analyst**. Here's what it should do:
>
> - Research destinations based on my travel preferences and constraints
> - Produce structured itinerary recommendations with alternatives
> - Consider budget, season, dietary needs, and accessibility
> - Always include off-the-beaten-path options alongside popular choices
>
> Context about me: I travel solo, mostly Europe and Southeast Asia, budget is mid-range, and I prefer trains over flights when the journey is under 6 hours.

The model will produce a complete persona following the guide's structure:

- **Mission** with an identity anchor
- **Inputs** and **Outputs**
- **Rules & Constraints**
- **Workflow** with numbered steps

---

## Step 4: Review and Refine

Read the output carefully. Ask the model to revise specific sections until you're satisfied.

| What to Check | Why It Matters |
|---------------|----------------|
| Is the identity specific? | "Travel Analyst" is generic. "Senior Independent Travel Research Specialist" shapes behavior differently. |
| Are constraints concrete? | "Be concise" is ignored. "Maximum 3 recommendations per destination. No filler paragraphs." is followed. |
| Does the workflow match how you'll use it? | If you'll ask one-off questions, a conversational workflow fits better than a formal 5-step report format. |
| Is there an Operating Philosophy? | For judgment-heavy roles, a short list of guiding values dramatically improves output quality. |

---

## Step 5: Save to Your Platform

Once you're happy with the persona, save it so it's ready for future use.

### Claude Projects

1. Open or create a **Project** in Claude.
2. Go to **Project Instructions**.
3. Paste the full persona text as the system prompt.
4. The persona is now active for all conversations in that project.

### Gemini Gems

1. Open **Gemini Gems** and click **Create a Gem**.
2. Paste the persona text into the **Instructions** field.
3. Give the Gem a name and save.
4. Start conversations from the Gem to use the persona.

### ChatGPT (Custom GPT)

1. Open **Explore GPTs** → **Create**.
2. In the **Configure** tab, paste the persona text into the **Instructions** field.
3. Publish the GPT (privately, for personal use).
4. Access it from **My GPTs** whenever you need it.

### Grok (Custom Agents)

1. Open Grok and start a new conversation.
2. Use the persona text as a system prompt or paste it at the start of a conversation with instructions to follow it.

### Any Other Platform

Most AI interfaces accept a **system prompt** or **custom instructions** field. Paste the persona text there. If no such field exists, paste the persona at the very beginning of your first message.

---

## Tips for Better Results

- **Be specific about your domain.** "I plan meals for a family of four, mostly Mediterranean diet, with a well-stocked herb garden" gives the model far more to work with than "I need a meal planning persona."
- **Include your constraints.** If the persona needs to know about your tools, environment, or limitations, say so upfront. Domain knowledge that the model can't guess is what makes a persona powerful.
- **Start with one workflow, then expand.** If the persona has multiple modes (Create / Update / Audit), build the primary mode first. Add the others once that works well.
- **Iterate after real use.** The best refinements come from actually using the persona and noticing where it falls short. Return to the model, share what didn't work, and ask for targeted improvements. Personas are living documents.

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
- [Persona Quickstart — IDE](persona-quickstart-ide) — Guide for VS Code, Claude Code, and Cursor
- [AI Insights Repository](https://github.com/Mistralys/ai-insights) — The complete toolkit
