# Create a Project Manifest

## Prerequisites

- A README or any kind of document with a high-level description of the 
  project explaining the project's role and dependencies between data
  types. 
- For larger repositories, an overview of the folder structure and main
  classes / module folders can help a lot.

## Prompt: Create Manifest

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

## Prompt: Update manifest

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
