# AGENTS.md Generation

## Overview

To generate an AGENTS.md file, add the template to the project and then
use the prompt to prime it.

## Template

```markdown
# Agents Guide - [Project Name]

## 📚 Project Manifest - Start Here!
**The Project Manifest is the authoritative source of truth.** If the manifest conflicts with the code, the code may be wrong.

### 🎯 Location
`/docs/manifest/` (or equivalent)

### 📖 Manifest Documents
1. **README.md** - Overview
2. **tech-stack.md** - Patterns & Libraries
3. **file-tree.md** - Structure
4. **public-api.md** - Signatures/Contracts
5. **constraints.md** - Critical Rules

### 🚀 Quick Start Workflow
1. Read README -> 2. Understand Tech Stack -> 3. Internalize Constraints -> 4. Reference Public API

### 📝 Manifest Maintenance Rules
| Change Made | Documents to Update |
|-------------|---------------------|
| [Example: New Service] | [Example: public-api.md, file-tree.md] |

### ⚡ Efficiency Rules - Search Smart
* **Finding files?** Check `file-tree.md` FIRST.
* **Understanding methods?** Check `public-api.md` FIRST.
* **Implementation?** Only then read source files.

### 🚨 Failure Protocol & Decision Matrix
| Scenario | Action | Priority |
|----------|--------|----------|
| Ambiguous Requirement | Use most restrictive interpretation | MUST |
| Manifest/Code Conflict | Trust manifest, flag code for fix | MUST |
| [Add project-specific edge cases here] | | |

### 📊 Project Stats
* **Language:** [Insert]
* **Architecture:** [Insert]
```

## Meta-Prompt

```markdown
# Role
You are a Senior Software Architect specializing in AI Collaboration Systems and Agentic Workflows.

# Task
Generate an `AGENTS.md` file that serves as a "Source of Truth" and "Operating System" for AI agents entering this codebase. This file must define how an agent interacts with the project to ensure architectural integrity and token efficiency.

# Project Context
[INSERT PROJECT NAME, DESCRIPTION, AND TECH STACK HERE]

# Core Philosophy
1. Manifest First: Agents must consult the Project Manifest (documentation) before reading implementation code.
2. Context Efficiency: Use the manifest and file-tree to minimize unnecessary file system searches and token waste.
3. High Integrity: The manifest is the source of truth. If code contradicts the manifest, the code is likely wrong.

# Required Sections
1. 📚 Project Manifest: Define the location and purpose of key documentation (README, tech-stack, file-tree, public-api, constraints).
2. 🚀 Quick Start Workflow: A step-by-step visual ingestion path for new agents.
3. 📝 Manifest Maintenance Rules: A table mapping code changes (e.g., adding a service) to the specific manifest files that must be updated.
4. ⚡ Efficiency Rules (Search Smart): Explicit instructions to search the `file-tree.md` or `public-api.md` before exploring source code.
5. 🚨 Failure Protocol & Decision Matrix: Specific actions for an agent to take when encountering ambiguity, missing documentation, or untested code.

# Output Format
Follow the structural hierarchy of the provided standard "Agent OS" template. Ensure the tone is authoritative yet helpful.
```
