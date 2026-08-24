'use strict';

/**
 * personas/plugins/ledger/index.js
 *
 * Factory function for the ledger persona build plugin.
 *
 * Ported from src/plugins/ledger/index.ts in persona-builder.
 *
 * ledgerPlugin(options) assembles the core modules from the ledger plugin
 * package into a PersonaBuildPlugin-conformant object and returns it.
 *
 * Hooks implemented:
 *   - onBuildContext  — injects roster_rendered and mcp_tools_table into
 *                       the build context so templates can reference them.
 *                       Also applies model assignment overrides from the
 *                       model registry (assignments.json / local.json).
 *   - onPostRender    — captures the rendered output per-persona so the
 *                       onValidate hook can run the note_only guard against
 *                       the real generated content.
 *   - onValidate      — invokes validateRole (role against workflow manifest)
 *                       and validateNoteOnlyGuard (ensures note_only tools
 *                       are not present in the rendered output).
 *   - frontmatterTemplates — registers the ledger-specific frontmatter templates
 *                             for the vscode and claude-code targets.
 *
 * @example
 * const { ledgerPlugin } = require('./plugins/ledger');
 * const manifest = require('./shared/workflow-manifest.json');
 *
 * const plugin = ledgerPlugin({
 *   manifestRoles: manifest.roles.map(r => r.name),
 * });
 */

const fs   = require('fs');
const path = require('path');

const { renderRoster }              = require('./roster-renderer');
const { renderMcpToolsTable }       = require('./mcp-tools-renderer');
const { validateRole, validateNoteOnlyGuard } = require('./role-validator');
const { FRONTMATTER_LEDGER_VSCODE, FRONTMATTER_LEDGER_CC } = require('./frontmatter-templates');

// ---------------------------------------------------------------------------
// Model registry loader (loaded once per process, shared across plugin calls)
// ---------------------------------------------------------------------------

/**
 * Absolute path to the model-registry directory.
 * Resolved relative to this plugin file: personas/plugins/ledger/ → personas/model-registry/
 */
const MODEL_REGISTRY_DIR = path.join(__dirname, '..', '..', 'model-registry');

/**
 * Load the model registry from the model-registry directory.
 *
 * Reads `local.json` (falling back to `default.json`) to build two lookup maps,
 * and reads `assignments.json` when present.
 *
 * **Return value shape:**
 * - `uuidToSlug`  — Map<UUID string, slug string> for resolving assignment UUIDs.
 * - `slugToEntry` — Map<slug string, full registry entry object { id, name, slug, cc_model }>
 *                   used to look up `cc_model` once a slug is resolved.
 * - `assignments` — Parsed `assignments.json` object (or `null` if absent/malformed).
 *
 * **Error handling (intentionally silent):**
 * Missing files and malformed JSON both produce empty maps / null assignments and
 * are silently ignored — no warnings are emitted. This is by design for production
 * build resilience: a missing or corrupt registry should never abort a build; the
 * system degrades gracefully to YAML-only model resolution instead.
 * (The ESM counterpart in `scripts/lib/persona-model-resolution.js` emits
 * `console.warn` on malformed JSON — preserve that difference if ever unifying.)
 *
 * @param {string} registryDir  Absolute path to the model-registry directory.
 * @returns {{ uuidToSlug: Map<string,string>, slugToEntry: Map<string,{id:string,name:string,slug:string,cc_model:string}>, assignments: object|null }}
 */
function loadModelRegistry(registryDir) {
  const uuidToSlug  = new Map();
  const slugToEntry = new Map();

  // Prefer local.json; fall back to default.json
  const localPath   = path.join(registryDir, 'local.json');
  const defaultPath = path.join(registryDir, 'default.json');
  const regPath     = fs.existsSync(localPath) ? localPath : defaultPath;

  if (fs.existsSync(regPath)) {
    try {
      const entries = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry && typeof entry.id === 'string' && typeof entry.slug === 'string') {
            uuidToSlug.set(entry.id, entry.slug);
            slugToEntry.set(entry.slug, entry);
          }
        }
      }
    } catch (_e) {
      // Malformed registry — fall back to YAML-only behavior silently
    }
  }

  let assignments = null;
  const assignmentsPath = path.join(registryDir, 'assignments.json');
  if (fs.existsSync(assignmentsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(assignmentsPath, 'utf8'));
      if (raw && typeof raw === 'object') {
        assignments = raw;
      }
    } catch (_e) {
      // Malformed assignments — fall back to YAML-only behavior silently
    }
  }

  return { uuidToSlug, slugToEntry, assignments };
}

// Load registry once at module-load time (cached for the process lifetime).
// Tests may inject an alternate registry via the `registryDir` option in ledgerPlugin().
const _defaultRegistry = loadModelRegistry(MODEL_REGISTRY_DIR);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ledger persona build plugin.
 *
 * The returned object satisfies the PersonaBuildPlugin interface and can be
 * passed directly to the plugins array in a BuildConfig.
 *
 * @param {{ manifestRoles?: string[], warnOnUnknownRole?: boolean, registryDir?: string }} [options]
 *   Configuration options for the plugin.
 *
 *   - manifestRoles     List of canonical role names from the workflow manifest.
 *                       When omitted (or empty), role validation is skipped.
 *   - warnOnUnknownRole When true (default), unknown role → warning severity.
 *                       When false, unknown role → error severity.
 *   - registryDir       Absolute path to an alternate model-registry directory.
 *                       When provided, overrides the default registry loaded at
 *                       module-load time.  Intended for tests only.
 *
 * @returns {object} A fully configured PersonaBuildPlugin for the ledger suite
 */
function ledgerPlugin(options) {
  const { manifestRoles = [], warnOnUnknownRole = true, registryDir } = options || {};

  // Use the injected registry when provided (test overrides); otherwise use the
  // module-level cached registry loaded from MODEL_REGISTRY_DIR.
  const { uuidToSlug: _uuidToSlug, slugToEntry: _slugToEntry, assignments: _assignments } =
    registryDir ? loadModelRegistry(registryDir) : _defaultRegistry;

  /**
   * Per-persona rendered output cache.
   *
   * Populated by onPostRender and consumed by onValidate.
   * Keyed by composite key `${persona.name}:${target}` so that multi-target
   * builds correctly cache and validate per-target output independently.
   * onValidate immediately follows onPostRender in the per-persona pipeline.
   */
  const renderedOutputCache = new Map();

  const plugin = {
    name: 'ledger',

    // -------------------------------------------------------------------------
    // onSuiteInit — scope frontmatter templates to the ledger suite only
    // -------------------------------------------------------------------------

    onSuiteInit(suite, _sharedMeta) {
      // Only apply ledger frontmatter when building the numbered (ledger) suite.
      // For other suites (e.g. standalone), remove the templates so the config-
      // level or library-default templates take effect instead.
      if (suite.personaMode === 'numbered') {
        plugin.frontmatterTemplates = {
          vscode: FRONTMATTER_LEDGER_VSCODE,
          'claude-code': FRONTMATTER_LEDGER_CC,
        };
      } else {
        delete plugin.frontmatterTemplates;
      }
    },

    // -------------------------------------------------------------------------
    // onBuildContext — inject computed variables for template rendering
    // -------------------------------------------------------------------------

    onBuildContext(context, persona, _suite) {
      const updated = Object.assign({}, context);

      // --- model assignment override (assignments.json > YAML > _shared.yaml) --
      //
      // Priority chain (mirrors the name-mapping pass in build-personas.js):
      //   1. assignments.json persona_models[persona_id] → UUID → slug
      //      Skip when resolved slug === "inherit" (fall through to next level)
      //   2. per-persona YAML model / model_slug (already in context from YAML merge)
      //      Skip when model_slug === "inherit"
      //   3. assignments.json default_model_uuid → UUID → slug
      //      Skip when resolved slug === "inherit"
      //   4. _shared.yaml default_model / default_model_slug (already in context)
      //   5. "inherit" sentinel (model left falsy, cc_model set to "inherit")
      //
      // When a non-inherit slug is resolved:
      //   - updated['model']      ← entry.name (human-readable) or slug
      //   - updated['model_slug'] ← resolved slug
      //   - updated['cc_model']   ← entry.cc_model (from registry) or 'inherit'
      //
      // When the inherit sentinel applies, `model` is set to '' (falsy) so the
      // {{#if model}} conditional in the VS Code frontmatter template omits the
      // field entirely.  cc_model is set to 'inherit'.

      const personaId = persona['id'] || updated['id'];

      /**
       * Resolve model fields from a slug.
       * @param {string} slug
       * @returns {{ model: string, model_slug: string, cc_model: string }}
       */
      function resolveFromSlug(slug) {
        const entry = _slugToEntry.get(slug) || null;
        return {
          model:      entry ? entry.name : slug,
          model_slug: slug,
          cc_model:   (entry && entry.cc_model) ? entry.cc_model : 'inherit',
        };
      }

      let resolved = null;

      // Step 1: per-persona assignment
      if (_assignments && _assignments.persona_models && personaId) {
        const uuid = _assignments.persona_models[personaId];
        if (uuid) {
          const slug = _uuidToSlug.get(uuid);
          if (slug && slug !== 'inherit') {
            resolved = resolveFromSlug(slug);
          }
          // slug undefined (unknown UUID) or 'inherit' → skip, fall through
        }
      }

      // Step 2: per-persona YAML model_slug (already merged into context)
      if (!resolved) {
        const yamlSlug = updated['model_slug'];
        if (yamlSlug && yamlSlug !== 'inherit') {
          resolved = resolveFromSlug(yamlSlug);
        }
      }

      // Step 3: assignments default_model_uuid
      if (!resolved && _assignments && _assignments.default_model_uuid) {
        const slug = _uuidToSlug.get(_assignments.default_model_uuid);
        if (slug && slug !== 'inherit') {
          resolved = resolveFromSlug(slug);
        }
        // slug undefined (unknown UUID) or 'inherit' → skip, fall through
      }

      // Step 4: _shared.yaml default_model_slug (already merged into context as default_model_slug)
      if (!resolved) {
        const sharedSlug = updated['default_model_slug'];
        if (sharedSlug && sharedSlug !== 'inherit') {
          // Use the slug as the VS Code model identifier
          const entry     = _slugToEntry.get(sharedSlug) || null;
          const modelName = entry
            ? entry.name
            : (updated['default_model'] || sharedSlug);
          resolved = {
            model:      modelName,
            model_slug: sharedSlug,
            cc_model:   (entry && entry.cc_model) ? entry.cc_model : (updated['cc_model'] || 'inherit'),
          };
        }
      }

      // Step 5: inherit sentinel fallback
      if (!resolved) {
        resolved = { model: '', model_slug: 'inherit', cc_model: 'inherit' };
      }

      // Apply resolved values — only override when the registry/assignment
      // chain produced a result (resolved is always set at this point).
      updated['model']      = resolved.model;       // falsy ('') → {{#if model}} omits VS Code field
      updated['model_slug'] = resolved.model_slug;
      updated['cc_model']   = resolved.cc_model;

      // --- roster_rendered ---------------------------------------------------
      // Roster lives in _shared.yaml → merged context (not per-persona YAML).
      const roster = updated['roster'];
      const personaNumber = updated['number'];

      if (Array.isArray(roster) && personaNumber !== undefined) {
        updated['roster_rendered'] = renderRoster(roster, personaNumber);
      } else {
        updated['roster_rendered'] = '';
      }

      // --- total (persona count in the suite) --------------------------------
      if (Array.isArray(roster) && !updated['total']) {
        updated['total'] = roster.length;
      }

      // --- cc_name (Claude Code identifier) — alias for cc_file_name_stem ----
      if (!updated['cc_name'] && updated['cc_file_name_stem']) {
        updated['cc_name'] = updated['cc_file_name_stem'];
      }

      // --- cc_description (Claude Code description) --------------------------
      // For ledger personas: derive from roster entry matching persona's number.
      // For standalone: fall back to the persona's description field.
      if (!updated['cc_description']) {
        if (Array.isArray(roster) && personaNumber !== undefined) {
          const entry = roster.find(r => r.number === personaNumber);
          if (entry) {
            updated['cc_description'] = entry.title + ' \u2014 ' + entry.short;
          }
        }
        // Fall back to the persona's description field (works for standalone)
        if (!updated['cc_description'] && updated['description']) {
          updated['cc_description'] = updated['description'];
        }
      }

      // --- mcp_tools_table ---------------------------------------------------
      const mcpTools = persona['mcp_tools'];

      if (Array.isArray(mcpTools)) {
        updated['mcp_tools_table'] = renderMcpToolsTable(mcpTools);
      } else {
        updated['mcp_tools_table'] = '';
      }

      return updated;
    },

    // -------------------------------------------------------------------------
    // onPostRender — capture rendered output for note_only guard in onValidate
    // -------------------------------------------------------------------------

    onPostRender(output, persona, target) {
      // Cache the rendered output so onValidate can run the note_only guard.
      // Use a composite key so per-target outputs are cached independently.
      renderedOutputCache.set(`${persona.name}:${target}`, output);
      return output;
    },

    // -------------------------------------------------------------------------
    // onValidate — role validation + note_only guard
    // -------------------------------------------------------------------------

    onValidate(persona, _suite, target) {
      const results = [];

      // 1. Role validation against the workflow manifest
      const role = persona['role'];
      const roleResults = validateRole(role, manifestRoles).map((r) => ({
        ...r,
        // When warnOnUnknownRole is false, escalate warning → error so that
        // unknown roles are treated as hard failures rather than advisories.
        severity: (r.severity === 'warning' && !warnOnUnknownRole)
          ? 'error'
          : r.severity,
      }));
      results.push(...roleResults);

      // 2. note_only guard — verify internal-only MCP tools are not in the output.
      // Use the composite key matching the one written by onPostRender; fall back
      // to 'unknown' when target is absent (e.g. in unit-test contexts).
      const mcpTools = persona['mcp_tools'];
      const cacheKey = `${persona.name}:${target !== undefined ? target : 'unknown'}`;
      const renderedOutput = renderedOutputCache.get(cacheKey) || '';
      results.push(...validateNoteOnlyGuard(renderedOutput, mcpTools));

      return results;
    },

    // -------------------------------------------------------------------------
    // frontmatterTemplates — set dynamically by onSuiteInit (not static)
    // -------------------------------------------------------------------------
    // The frontmatterTemplates property is set/removed by onSuiteInit so that
    // ledger templates only apply when building the ledger (numbered) suite.
    // For standalone builds, the property is deleted so that config-level or
    // library-default templates take effect instead.
  };

  return plugin;
}

module.exports = { ledgerPlugin };
