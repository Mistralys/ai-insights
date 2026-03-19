/**
 * Zod schema for the shared workflow manifest.
 *
 * Purpose: runtime validation at module-load time (fail fast with a clear error)
 * + narrow TypeScript type inference (e.g. AgentRole derived via z.infer,
 * eliminating manually maintained union type declarations in consumers).
 *
 * Distinct from shared/workflow-manifest.schema.json, which is a JSON Schema
 * used for structural validation only.  The Zod schema serves the additional
 * purpose of producing narrow TypeScript types and validating field semantics
 * (e.g. positive integers, non-empty arrays) at startup.
 */

import { createRequire } from 'module';
import { z } from 'zod';

const _require = createRequire(import.meta.url);

// ── Agent role names ────────────────────────────────────────────────────────

/**
 * Zod enum of all valid agent role names, in manifest order.
 * `AgentRole` is inferred from this — no manual union type annotation needed
 * in consumers.
 */
export const AgentRoleEnum = z.enum([
  'Planner',
  'Project Manager',
  'Developer',
  'QA',
  'Security Auditor',
  'Reviewer',
  'Release Engineer',
  'Documentation',
  'Synthesis',
]);

/** Union of all valid agent role name strings. Inferred from AgentRoleEnum. */
export type AgentRole = z.infer<typeof AgentRoleEnum>;

// ── Manifest schema ─────────────────────────────────────────────────────────

const RoleSchema = z.object({
  id: z.string(),
  name: AgentRoleEnum,
  number: z.number().int().positive(),
  orchestrating: z.boolean(),
  pipeline: z.string().nullable(),
  persona_file: z.string(),
});

const PipelinesSchema = z.object({
  canonical_order: z.array(z.string()).nonempty(),
  default_stages: z.array(z.string()).nonempty(),
  prerequisites: z.record(z.string().nullable()),
  fail_routing: z.record(z.string()),
});

const StatusesSchema = z.object({
  project: z.array(z.string()).nonempty(),
  work_package: z.array(z.string()).nonempty(),
  terminal_work_package: z.array(z.string()).nonempty(),
  pipeline: z.array(z.string()).nonempty(),
  blocker_type: z.array(z.string()).nonempty(),
});

const ConstantsSchema = z.object({
  max_rework_count: z.number().int().positive(),
  stale_pipeline_hours: z.number().positive(),
  max_handoff_depth: z.number().int().positive(),
  handoff_depth_multiplier: z.number().int().positive(),
});

export const ManifestSchema = z.object({
  spec_version: z.string(),
  roles: z.array(RoleSchema).nonempty(),
  pipelines: PipelinesSchema,
  statuses: StatusesSchema,
  constants: ConstantsSchema,
});

/** Full manifest type inferred from ManifestSchema. */
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Parsed and validated workflow manifest singleton.
 *
 * Fails fast at module load time with a descriptive Zod validation error if
 * the manifest is malformed or missing required fields.  All consumers of the
 * manifest should import this constant rather than calling createRequire
 * themselves, keeping the parsing + validation logic in one place.
 */
export const workflowManifest: Manifest = ManifestSchema.parse(
  _require('../../../shared/workflow-manifest.json'),
);
