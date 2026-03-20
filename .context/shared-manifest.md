# AI Insights - Shared Manifest
_SOURCE: Workflow manifest (single source of truth for roles, pipelines, statuses)_
# Workflow manifest (single source of truth for roles, pipelines, statuses)
```
// Structure of documents
└── shared/
    └── workflow-manifest.json
    └── workflow-manifest.schema.json

```
###  Path: `\shared/workflow-manifest.json`

```json
{
  "$schema": "./workflow-manifest.schema.json",
  "spec_version": "2.4.1",

  "roles": [
    {
      "id": "planner",
      "name": "Planner",
      "number": 1,
      "orchestrating": true,
      "pipeline": null,
      "persona_file": "personas/ledger/vs-code/1-planner.md"
    },
    {
      "id": "pm",
      "name": "Project Manager",
      "number": 2,
      "orchestrating": false,
      "pipeline": null,
      "persona_file": "personas/ledger/vs-code/2-project-manager.md"
    },
    {
      "id": "developer",
      "name": "Developer",
      "number": 3,
      "orchestrating": false,
      "pipeline": "implementation",
      "persona_file": "personas/ledger/vs-code/3-developer.md"
    },
    {
      "id": "qa",
      "name": "QA",
      "number": 4,
      "orchestrating": false,
      "pipeline": "qa",
      "persona_file": "personas/ledger/vs-code/4-qa.md"
    },
    {
      "id": "security_auditor",
      "name": "Security Auditor",
      "number": 5,
      "orchestrating": false,
      "pipeline": "security-audit",
      "persona_file": "personas/ledger/vs-code/5-security-auditor.md"
    },
    {
      "id": "reviewer",
      "name": "Reviewer",
      "number": 6,
      "orchestrating": false,
      "pipeline": "code-review",
      "persona_file": "personas/ledger/vs-code/6-reviewer.md"
    },
    {
      "id": "release_engineer",
      "name": "Release Engineer",
      "number": 7,
      "orchestrating": false,
      "pipeline": "release-engineering",
      "persona_file": "personas/ledger/vs-code/7-release-engineer.md"
    },
    {
      "id": "docs",
      "name": "Documentation",
      "number": 8,
      "orchestrating": false,
      "pipeline": "documentation",
      "persona_file": "personas/ledger/vs-code/8-documentation.md"
    },
    {
      "id": "synthesis",
      "name": "Synthesis",
      "number": 9,
      "orchestrating": true,
      "pipeline": null,
      "persona_file": "personas/ledger/vs-code/9-synthesis.md"
    }
  ],

  "pipelines": {
    "canonical_order": [
      "implementation",
      "qa",
      "security-audit",
      "code-review",
      "release-engineering",
      "documentation"
    ],
    "default_stages": [
      "implementation",
      "qa",
      "code-review",
      "documentation"
    ],
    "prerequisites": {
      "implementation": null,
      "qa": "implementation",
      "security-audit": "qa",
      "code-review": "security-audit",
      "release-engineering": "code-review",
      "documentation": "release-engineering"
    },
    "fail_routing": {
      "implementation": "developer",
      "qa": "developer",
      "security-audit": "developer",
      "code-review": "developer",
      "release-engineering": "release_engineer",
      "documentation": "docs"
    }
  },

  "statuses": {
    "project":               ["READY", "IN_PROGRESS", "COMPLETE", "BLOCKED"],
    "work_package":          ["READY", "IN_PROGRESS", "COMPLETE", "BLOCKED", "CANCELLED"],
    "terminal_work_package": ["COMPLETE", "CANCELLED"],
    "pipeline":              ["IN_PROGRESS", "PASS", "FAIL"],
    "blocker_type":          ["dependency", "decision", "external", "technical"]
  },

  "constants": {
    "max_rework_count": 5,
    "stale_pipeline_hours": 24,
    "max_handoff_depth": 50,
    "handoff_depth_multiplier": 30
  }
}

```
###  Path: `\shared/workflow-manifest.schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "workflow-manifest.schema.json",
  "title": "Workflow Manifest",
  "description": "Schema for shared/workflow-manifest.json — single source of truth for specification-derived workflow constructs. Structural constraints are validated here; semantic cross-reference checks (unique role IDs, fail_routing references valid role IDs, default_stages is a subset of canonical_order) are enforced by scripts/validate-workflow-manifest.js.",
  "type": "object",
  "required": ["$schema", "spec_version", "roles", "pipelines", "statuses", "constants"],
  "additionalProperties": false,
  "properties": {
    "$schema": {
      "type": "string",
      "description": "JSON Schema reference URI"
    },
    "spec_version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Workflow specification version this manifest encodes (semver)"
    },
    "roles": {
      "type": "array",
      "description": "All workflow agent roles. Each role must have a unique id, name, and number (enforced by validate-workflow-manifest.js).",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "type": "object",
        "required": ["id", "name", "number", "orchestrating", "pipeline", "persona_file"],
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9_]*$",
            "description": "Machine-friendly role identifier. Stable once assigned. Used as graph stage name and config key."
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "description": "Display name for the role (matches AGENT_ROLES in constants.ts)"
          },
          "number": {
            "type": "integer",
            "minimum": 1,
            "description": "1-based ordinal role number. Reflects position in the workflow sequence."
          },
          "orchestrating": {
            "type": "boolean",
            "description": "True if this role orchestrates the workflow (e.g. Planner, Synthesis). Orchestrating roles have pipeline: null."
          },
          "pipeline": {
            "oneOf": [
              { "type": "string", "minLength": 1 },
              { "type": "null" }
            ],
            "description": "Pipeline type this role owns (e.g. 'implementation'), or null for orchestrating roles or roles that do not own a pipeline (e.g. Project Manager). Must reference a value in pipelines.canonical_order when non-null (enforced by validate-workflow-manifest.js)."
          },
          "persona_file": {
            "type": "string",
            "minLength": 1,
            "description": "Relative path from the workspace root to the role's VS Code persona file"
          }
        }
      }
    },
    "pipelines": {
      "type": "object",
      "description": "Pipeline type definitions: ordering, default subset, prerequisites, and fail routing.",
      "required": ["canonical_order", "default_stages", "prerequisites", "fail_routing"],
      "additionalProperties": false,
      "properties": {
        "canonical_order": {
          "type": "array",
          "description": "All pipeline types in canonical execution order. Must be a superset of default_stages (enforced by validate-workflow-manifest.js).",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "default_stages": {
          "type": "array",
          "description": "Default pipeline subset (the 4-stage legacy default per spec §3.2). Must be a subset of canonical_order (enforced by validate-workflow-manifest.js).",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "prerequisites": {
          "type": "object",
          "description": "For each pipeline type in canonical_order, the pipeline that must PASS before it can start. null means no prerequisite. Keys must cover all canonical_order types (enforced by validate-workflow-manifest.js).",
          "minProperties": 1,
          "additionalProperties": {
            "oneOf": [
              { "type": "string", "minLength": 1 },
              { "type": "null" }
            ]
          }
        },
        "fail_routing": {
          "type": "object",
          "description": "For each pipeline type, the role ID of the agent who fixes FAIL outcomes. Values must reference valid role IDs (enforced by validate-workflow-manifest.js).",
          "minProperties": 1,
          "additionalProperties": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    },
    "statuses": {
      "type": "object",
      "description": "Status vocabularies for each entity type. Consumers apply their own type treatment (Zod enums in TS, frozensets in Python).",
      "required": ["project", "work_package", "terminal_work_package", "pipeline", "blocker_type"],
      "additionalProperties": false,
      "properties": {
        "project": {
          "type": "array",
          "description": "Valid project-level status values",
          "minItems": 1,
          "uniqueItems": true,
          "items": { "type": "string", "minLength": 1 }
        },
        "work_package": {
          "type": "array",
          "description": "Valid work package status values",
          "minItems": 1,
          "uniqueItems": true,
          "items": { "type": "string", "minLength": 1 }
        },
        "terminal_work_package": {
          "type": "array",
          "description": "Subset of work_package statuses that are terminal — no further agent action is required. Must be a non-empty subset of work_package (enforced by validate-workflow-manifest.js).",
          "minItems": 1,
          "uniqueItems": true,
          "items": { "type": "string", "minLength": 1 }
        },
        "pipeline": {
          "type": "array",
          "description": "Valid pipeline status values",
          "minItems": 1,
          "uniqueItems": true,
          "items": { "type": "string", "minLength": 1 }
        },
        "blocker_type": {
          "type": "array",
          "description": "Valid blocker type values",
          "minItems": 1,
          "uniqueItems": true,
          "items": { "type": "string", "minLength": 1 }
        }
      }
    },
    "constants": {
      "type": "object",
      "description": "Specification-defined workflow tuning constants (§7, §8, §18). Changing a constant requires editing this file only.",
      "required": ["max_rework_count", "stale_pipeline_hours", "max_handoff_depth", "handoff_depth_multiplier"],
      "additionalProperties": false,
      "properties": {
        "max_rework_count": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "description": "Maximum number of rework cycles allowed per pipeline type per work package"
        },
        "stale_pipeline_hours": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "Hours after which an IN_PROGRESS pipeline is considered stale"
        },
        "max_handoff_depth": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "description": "Default maximum auto-handoff depth before the workflow terminates"
        },
        "handoff_depth_multiplier": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "Multiplier applied to work package count to compute effective max handoff depth"
        }
      }
    }
  }
}

```
---
**File Statistics**
- **Size**: 11.49 KB
- **Lines**: 330
File: `shared-manifest.md`
