# Question: Agent-generated project manifest

> This sounds like something I should be able to let my agent create and maintain. What about using a prompt dedicated to creating / updating the project skeleton with all relevant information? This would enable me to re-run the prompt whenever I want to update the document.

----

This is a brilliant idea. You are essentially creating a **"Project Manifest"**—a condensed, high-density file that acts as the "save state" for your application's architecture.

By having the agent generate this manifest, you stop being the "technical writer" and start being the "editor." You simply run the prompt, copy the output into a file called `Project_Manifest.md`, and then feed that file to any new agent session.

----

## Copy & Paste version: Create manifest

```markdown
Please generate a comprehensive **Project Manifest** for our current application. These documents are intended to be the 'Source of Truth' for future AI agent sessions to understand the codebase without reading every line.

**The Manifest must include:**

1. **Tech Stack & Patterns:** Runtime, Libraries and architectural patterns.
2. **File Tree:** A visual directory structure of the current project.
3. **The 'Public API' (Signatures Only):** For every Service, Model, etc, list only the public properties, methods (signatures only), and constructors. **Do not include the implementation logic.**
4. **Key Data Flows:** Briefly describe how the UI interacts with the Services.
5. **Current Constraints:** List established rules like 'All file I/O must be async'.
 
Save the files in Markdown format into the folder

`/docs/agents/project-manifest/`

1. A README.md file with links to the documents
2. Individual documents by topics (not numbered, use logical file names)
```

## Copy & Paste version: Update manifest

```markdown
Please update the Project Manifest for our current application in the file /Docs/Agents/project-manifest with the current state of the application. It is outdated because of features that were added recently.

This document is intended to be the 'Source of Truth' for future AI agent sessions to understand the codebase without reading every line.

**The Manifest must include:**

1. **Tech Stack & Patterns:** Runtime (.NET 9/WPF), Libraries (CommunityToolkit.Mvvm), and architectural patterns (Static Services, MVVM, etc.).
2. **File Tree:** A visual directory structure of the current project.
3. **The 'Public API' (Signatures Only):** For every Service, Model, and ViewModel, list only the public properties, methods (signatures only), and constructors. **Do not include the implementation logic.**
4. **Key Data Flows:** Briefly describe how the UI interacts with the Services (e.g., 'MainViewModel calls FileService.ApplyLoadOrderAsync').
5. **Current Constraints:** List established rules like 'All file I/O must be async' or 'Case restoration requires checking the /Data folder'.
```
