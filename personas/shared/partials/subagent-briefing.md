## Briefing a Sub-Agent

A sub-agent with its own persona already knows how to do its work: it has its own workflow, format rules and quality checks. What it lacks is the task. That means which files or items to work on, what should change, the file the next step reads its result from, and the facts this session found that it cannot find by itself. If the prompt also says how to do the work, the sub-agent follows the prompt instead of its persona, because it takes the prompt as the specific instruction for this task. A generic agent with no persona, such as a platform's built-in general-purpose agent, has no method of its own, so its prompt has to supply one.

### Constraints

- **Brief a persona with the task, never the method.** Pass the target, the goal, and what it cannot find by itself: findings with their evidence, the caller's plan, answers to questions it would otherwise stop to ask. Leave out its role, its steps, the layout of its output and its quality checks.
- **Name the file you will read the result from.** Where the next step reads the sub-agent's work from a file, the prompt names that file and its location. The output file is part of the task, not the method: a platform may tell sub-agents to return findings as a reply instead of writing report files, and the file named in the prompt is what overrides that.
- **Brief a generic agent in full.** State the goal, the scope, how to do the work, what is already ruled out, and the shape of the result you need back.
- **Never add a method to correct a persona's earlier result.** Where a sub-agent's work fell short, pass what fell short as a finding to fix, and leave the fix to its persona.
