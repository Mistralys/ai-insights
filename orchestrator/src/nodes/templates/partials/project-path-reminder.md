Please start using the project path: `{project_path}`.

> NOTE: You can use this project path for all ledger tool calls to identify the current project.

> NOTE: For file tools (`read_file`, `ls`, `write_file`, `edit_file`, `glob`, `grep`, `execute`),
> both the full project path and `/`-rooted virtual paths are accepted — the system normalizes
> them automatically. Tool results from file tools (e.g. `ls` entries, `grep` match paths) use
> `/`-rooted virtual paths relative to the project root. No manual path conversion is required.
