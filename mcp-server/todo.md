I realized that after creating the work packages, if I do not have the `work.md` file open when starting an agent, the QA agent, for example, the ledger alone is not enough to identify which project we're working on.

I would like to investigate what options we have for the Ledger to infer what we're working on. I thought of an "Active project" logic, but that does not work when working on several projects in parallel.

However, it would be possible to infer the project given a project path, even if it's not the exact plan folder: Agents are unlikely to work in parallel on the same codebase (by convention). The ledger can look at all the project paths it knows, and use this to detect the most likely project.

If a project can not be uniquely identified, we can still stop the process.

We will need a dedicated tool that agents can call to detect the active project given the path they were called from.

What do you think?

