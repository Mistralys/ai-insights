/**
 * scripts/lib/persona-model-resolution.js
 *
 * Model resolution helpers for the personas name-mapping build pass.
 *
 * Provides:
 *   loadModelRegistry(registryDir)  — reads local.json / default.json + assignments.json
 *   resolveModel(...)               — resolves model fields using the priority chain
 *
 * Both functions are pure (no side-effects beyond the file reads performed by
 * loadModelRegistry), making them straightforwardly unit-testable.
 *
 * Priority chain for resolveModel:
 *   1. assignments.json persona_models[personaId]  (skip when resolved slug === "inherit")
 *   2. per-persona YAML model_slug                 (skip when value === "inherit")
 *   3. assignments.json default_model_uuid          (skip when resolved slug === "inherit")
 *   4. _shared.yaml default_model_slug
 *   5. "inherit" sentinel fallback
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// loadModelRegistry
// ---------------------------------------------------------------------------

/**
 * Load the model registry files from `registryDir`.
 *
 * Reads `local.json` (falling back to `default.json`) to build the UUID → slug
 * map, and reads `assignments.json` when present.
 *
 * @param {string} registryDir  Absolute path to the model-registry directory.
 * @param {{ warn?: (msg: string) => void }} [opts]
 *   Optional overrides — `warn` defaults to `console.warn`.
 * @returns {{ uuidToSlug: Map<string,string>, registryEntries: object[], assignments: object|null }}
 */
export function loadModelRegistry(registryDir, opts = {}) {
  const warn = opts.warn ?? ((msg) => console.warn(msg));

  const localJsonPath   = path.join(registryDir, 'local.json');
  const defaultJsonPath = path.join(registryDir, 'default.json');
  const assignmentsPath = path.join(registryDir, 'assignments.json');

  // Build UUID → slug map from local.json (seed from default.json if absent)
  const uuidToSlug     = new Map();
  let   registryEntries = [];

  const regPath = fs.existsSync(localJsonPath) ? localJsonPath : defaultJsonPath;
  if (fs.existsSync(regPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      if (Array.isArray(parsed)) {
        registryEntries = parsed;
        for (const entry of parsed) {
          if (entry && typeof entry.id === 'string' && typeof entry.slug === 'string') {
            uuidToSlug.set(entry.id, entry.slug);
          }
        }
      }
    } catch (e) {
      warn(`[WARN] build-personas: failed to parse model registry at ${regPath}: ${e.message}`);
    }
  }

  // Load assignments.json (optional — absent in clean installs)
  let assignments = null;
  if (fs.existsSync(assignmentsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(assignmentsPath, 'utf8'));
      if (raw && typeof raw === 'object') {
        assignments = raw;
      }
    } catch (e) {
      warn(`[WARN] build-personas: failed to parse assignments.json: ${e.message}`);
    }
  }

  return { uuidToSlug, registryEntries, assignments };
}

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

/**
 * Resolve display name, slug, and cc_model for a persona.
 *
 * Priority chain (mirrors the build plugin + orchestrator):
 *   1. assignments.json persona_models[personaId]  (skip if resolved slug === "inherit")
 *   2. yamlModelSlug                               (skip if value === "inherit")
 *   3. assignments.json default_model_uuid          (skip if resolved slug === "inherit")
 *   4. sharedModelSlug / sharedModelName
 *   5. "inherit" sentinel — { model: "Inherit / Auto", model_slug: "inherit", cc_model: "inherit" }
 *
 * @param {string|undefined}       personaId       Persona ID (used as assignments key).
 * @param {string|undefined}       yamlModelSlug   Per-persona model_slug from YAML.
 * @param {string|undefined}       sharedModelSlug Shared default model slug (_shared.yaml).
 * @param {string|undefined}       sharedModelName Shared default model name (_shared.yaml).
 * @param {Map<string,string>}     uuidToSlug      UUID → slug from registry.
 * @param {object|null}            assignments     Parsed assignments.json (or null).
 * @param {object[]}               registryEntries Array of { id, name, slug, cc_model } registry entries.
 * @returns {{ model: string, model_slug: string, cc_model: string }}
 */
export function resolveModel(
  personaId,
  yamlModelSlug,
  sharedModelSlug,
  sharedModelName,
  uuidToSlug,
  assignments,
  registryEntries,
) {
  // Build slug → entry map for name / cc_model lookups
  const slugToEntry = new Map();
  for (const entry of registryEntries) {
    if (entry && typeof entry.slug === 'string') {
      slugToEntry.set(entry.slug, entry);
    }
  }

  function entryForSlug(slug) {
    return slugToEntry.get(slug) || null;
  }

  // 1. Per-persona assignment
  if (assignments && assignments.persona_models && personaId) {
    const uuid = assignments.persona_models[personaId];
    if (uuid) {
      const slug = uuidToSlug.get(uuid);
      if (slug && slug !== 'inherit') {
        const entry = entryForSlug(slug);
        return {
          model:      entry ? entry.slug : slug,
          model_slug: slug,
          cc_model:   entry ? entry.cc_model : 'inherit',
        };
      }
      // slug === 'inherit' → skip, fall through
    }
  }

  // 2. Per-persona YAML model_slug
  if (yamlModelSlug && yamlModelSlug !== 'inherit') {
    const entry = entryForSlug(yamlModelSlug);
    return {
      model:      entry ? entry.slug : yamlModelSlug,
      model_slug: yamlModelSlug,
      cc_model:   entry ? entry.cc_model : 'inherit',
    };
  }

  // 3. Default assignment from assignments.json
  if (assignments && assignments.default_model_uuid) {
    const slug = uuidToSlug.get(assignments.default_model_uuid);
    if (slug && slug !== 'inherit') {
      const entry = entryForSlug(slug);
      return {
        model:      entry ? entry.slug : slug,
        model_slug: slug,
        cc_model:   entry ? entry.cc_model : 'inherit',
      };
    }
    // slug === 'inherit' → skip, fall through
  }

  // 4. _shared.yaml default
  if (sharedModelSlug && sharedModelSlug !== 'inherit') {
    const entry = entryForSlug(sharedModelSlug);
    return {
      model:      entry ? entry.slug : sharedModelSlug,
      model_slug: sharedModelSlug,
      cc_model:   entry ? entry.cc_model : 'inherit',
    };
  }

  // 5. Ultimate fallback — inherit sentinel
  return { model: 'Inherit / Auto', model_slug: 'inherit', cc_model: 'inherit' };
}
