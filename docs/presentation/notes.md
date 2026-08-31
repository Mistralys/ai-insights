

- Model versions != linear progression
  - Example: Opus 5 & Sonnet 5 = stricter adherence to prompts (auditor refusal to adjust the plan, for ex)
  - When using a new model, always monitor results. 
  - Persona adjustments are expected and encouraged.


- Which models for what tasks? -> Opus for planning, Sonnet for the rest. GPT and Gemini for 

- Keep & archive past specs & plans (what are specs, what are plans in this context?), clearly document them as such.

- A slide about the persona design guide.
  - Detailed & versioned persona curation guide.
  - Made to be copied around, caters to projects with and without a persona build pipeline.
  - Audit personas for new guide releases.

- Tone (skills & personas): Reserve imperative voice for actual constraints.


- When a persona, when a skill?
  - Persona = What work, how
  - Skill = Custom specific tasks & project-specific workflows
  - Developer = How to programn, skill = how to do X in project Y
  - Examples: Multiple switchable for different audiences (Developer / Cooking chef / Gardener), so people can use the example that they relate to the most.
- Slim skills: Knowledge goes into separate reference docs.

- AX: Like DX but specifically for their environment (scripts for tasks, missing tools etc).

- Persona knows what to do with your input without even needing a prompt. Example: Give `plan.md` or `synthesis.md` to the planner, voilà. No comments needed.

- IDE for everyone: Having an IDE like VS Code to browse the project's structure, view files and chat is a great way to take control of your project and workflows - and not only for developers. Example: Im my company, our team's business engineer has set up an agent project to store and maintain institutional knowledge of our division. They have added relevant git clones into the workspace and connected it to the internal Jira and Confluence MCP servers. This. project is now a powerhouse in which specialized personas make it possible to meaningfully discuss projects and use it to learn about the division and its system landscape.

- You're still bringing the common sense to the LLM: It will happily build something that makes no sense in regards to your project.

- Treat the agent like a colleague whose code you're reviewing. Not a tool, not an oracle. A capable colleague who is fast, knows the language better than you do, has no idea about the meeting you had last week, and will never once tell you they're unsure.
  - Is mitigated in part by the project documentation and AI Insights can also help (Vision & Knowledge).

- Project documentation and knowledge: The foundation for any meaningful agentic work. An agent that gets a task in your project has to learn all about it again with every request. Make this easy:
  - Technical manifest (pre-fetched codebase knowledge > codebase search). Include a file tree.
  - Domain briefs.
  - Institutional knowledge.
  - Overarching system architecture ("you are here").
  - Project vision (short-, mid- and long-term).
  - A glossary to bring everything together.



