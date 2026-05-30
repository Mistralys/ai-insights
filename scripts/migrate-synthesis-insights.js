#!/usr/bin/env node

/**
 * scripts/migrate-synthesis-insights.js
 *
 * Scans existing synthesis documents across all project ledger directories,
 * feeds each through an LLM extraction prompt, validates the resulting
 * candidates, deduplicates against already-committed insights, and commits
 * them to the knowledge store via direct JSON writes.
 *
 * ─── USAGE ─────────────────────────────────────────────────────────────────
 *
 *   node scripts/migrate-synthesis-insights.js [options]
 *
 * ─── OPTIONS ───────────────────────────────────────────────────────────────
 *
 *   --dry-run              Print extracted candidates as JSON without writing
 *   --project <slug>       Process only the named project's synthesis document
 *   --limit <N>            Process at most N projects per run
 *   --resume               Skip projects with ≥1 committed insight already
 *   --verbose              Enable verbose logging
 *   --help                 Print this help message and exit
 *
 * ─── PREREQUISITES ─────────────────────────────────────────────────────────
 *
 *   ANTHROPIC_API_KEY must be set in the environment.
 *
 *   LEDGER ROOT: This script uses a hardcoded ledger root path:
 *     mcp-server/storage/ledger
 *   If you have configured a custom --ledger-path when starting the MCP
 *   server, update the LEDGER_ROOT constant near the top of this script to
 *   match your configuration. Running against the wrong ledger root will
 *   silently scan an empty directory and commit no insights.
 *
 * ─── COST WARNING ──────────────────────────────────────────────────────────
 *
 *   This script submits one LLM request per synthesis document. With 250+
 *   projects the token cost is non-trivial. Use --project + --dry-run first
 *   to verify prompt quality before running the full batch. Use --resume to
 *   safely resume an interrupted run without re-processing completed projects.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { KnowledgeStoreManager } from '../mcp-server/dist/storage/knowledge-store.js';

// ─── Path resolution ───────────────────────────────────────────────────────

const WORKSPACE_ROOT  = path.resolve(import.meta.dirname, '..');
const MCP_SERVER_DIR  = path.join(WORKSPACE_ROOT, 'mcp-server');
const LEDGER_ROOT     = path.join(MCP_SERVER_DIR, 'storage', 'ledger');

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Parse CLI flags from process.argv.
 * @returns {{ dryRun: boolean, project: string|null, limit: number|null, resume: boolean, verbose: boolean, help: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, project: null, limit: null, resume: false, verbose: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--resume') opts.resume = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--help') opts.help = true;
    else if (a === '--project') { opts.project = args[++i] ?? null; }
    else if (a === '--limit') {
      const n = parseInt(args[++i] ?? '', 10);
      opts.limit = isNaN(n) ? null : n;
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
migrate-synthesis-insights.js

Extracts reusable insights from synthesis documents using an LLM and
commits them to the centralized knowledge store.

USAGE:
  node scripts/migrate-synthesis-insights.js [options]

OPTIONS:
  --dry-run              Print extracted candidates as JSON without writing
  --project <slug>       Process only the named project's synthesis document
  --limit <N>            Process at most N projects per run
  --resume               Skip projects with >=1 committed insight already
  --verbose              Enable verbose logging
  --help                 Print this help message and exit

PREREQUISITES:
  ANTHROPIC_API_KEY must be set in the environment.

COST WARNING:
  One LLM call per synthesis document. Use --project --dry-run to validate
  prompt output before running the full batch. Use --resume to safely restart
  an interrupted batch run.

EXAMPLE:
  # Test against a single project in dry-run mode
  ANTHROPIC_API_KEY=sk-... node scripts/migrate-synthesis-insights.js \\
    --project 2026-01-01-my-feature --dry-run

  # Run incremental batch (first 10 projects, skip already-processed)
  ANTHROPIC_API_KEY=sk-... node scripts/migrate-synthesis-insights.js \\
    --limit 10 --resume
`);
}

function logVerbose(verbose, ...args) {
  if (verbose) console.error('[verbose]', ...args);
}

// ─── Knowledge store (via KnowledgeStoreManager) ──────────────────────────

const manager = new KnowledgeStoreManager(LEDGER_ROOT);

// ─── Deduplication ─────────────────────────────────────────────────────────

/**
 * Normalizes a title for deduplication comparison.
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Loads all existing insight titles from the knowledge store.
 * Returns a Set of normalized titles.
 * @returns {Promise<Set<string>>}
 */
async function loadExistingTitles() {
  const insights = await manager.listInsights({});
  const titles = new Set();
  for (const insight of insights) {
    titles.add(normalizeTitle(insight.title));
  }
  return titles;
}

/**
 * Returns true when the project has at least one committed insight.
 * Used by --resume to skip already-processed projects.
 * @param {string} slug
 * @returns {Promise<boolean>}
 */
async function projectHasInsights(slug) {
  const insights = await manager.listInsights({ project_slug: slug });
  return insights.length > 0;
}

/**
 * Commits a single validated insight to the appropriate store via KnowledgeStoreManager.
 * @param {{ scope: string, title: string, content: string, category: string, tags: string[], source: string, confidence: number }} insight
 * @param {string} projectSlug  — the slug of the originating project (used for project scope)
 * @param {boolean} [dryRun]
 * @returns {Promise<{ committed: boolean, id?: number }>}
 */
async function commitInsight(insight, projectSlug, dryRun) {
  if (dryRun) return { committed: false };

  const scope = insight.scope === 'project' ? 'project' : 'global';
  const created = await manager.addInsight({
    scope,
    ...(scope === 'project' ? { project_slug: projectSlug } : {}),
    title:      insight.title,
    content:    insight.content,
    category:   insight.category || 'general',
    tags:       Array.isArray(insight.tags) ? insight.tags : [],
    source:     insight.source,
    created_at: new Date().toISOString(),
    confidence: typeof insight.confidence === 'number' ? insight.confidence : 0.5,
  });
  return { committed: true, id: created.id };
}

// ─── Project discovery ─────────────────────────────────────────────────────

/**
 * Enumerates all project slugs that have a synthesis.md in the ledger root.
 * @returns {string[]}
 */
function findProjectsWithSynthesis() {
  if (!fs.existsSync(LEDGER_ROOT)) return [];
  const slugs = [];
  const entries = fs.readdirSync(LEDGER_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Exclude the hidden .knowledge directory itself
    if (entry.name.startsWith('.')) continue;
    const synthPath = path.join(LEDGER_ROOT, entry.name, 'synthesis.md');
    if (fs.existsSync(synthPath)) {
      slugs.push(entry.name);
    }
  }
  return slugs.sort();
}

// ─── LLM extraction ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a knowledge curator. Your task is to extract reusable insights from a project synthesis document.

An "insight" is a principle, pattern, pitfall, architectural decision, or lesson learned that is broadly applicable beyond the specific project context. Good insights are actionable, concise, and permanently relevant.

DO extract:
- Architectural patterns and anti-patterns
- Reusable engineering principles (e.g., "always validate slugs at the schema boundary")
- Common pitfalls to avoid
- Cross-cutting design decisions and their rationale
- Testing strategies and conventions
- Workflow improvements that generalize across projects

DO NOT extract:
- Project-specific status updates or milestones
- Metrics or timeline summaries
- One-off implementation details that don't generalize
- Observations that are only relevant to this specific codebase

For each insight, determine:
- scope: "global" if it applies broadly to any software project, "project" if it is specific to this codebase
- category: one of "architecture", "testing", "workflow", "security", "patterns", "pitfalls", "decisions", "conventions"
- confidence: a float 0.0–1.0 (use 0.5 for insights that need human review; lower for uncertain ones)

Output a JSON array only — no prose, no markdown fences, no explanation. Each element must have:
  title (string, ≤ 80 chars), content (string), scope (string), category (string), tags (string[]), confidence (number)

Example output:
[
  {
    "title": "Atomic writes prevent partial-file corruption",
    "content": "Write to a temporary file in the same directory, then rename atomically. This guarantees readers never see a partially-written file.",
    "scope": "global",
    "category": "architecture",
    "tags": ["storage", "reliability", "atomic"],
    "confidence": 0.95
  }
]

If the document contains no generalizable insights, output an empty array: []`;

/**
 * Calls the Anthropic Messages API with the synthesis document content.
 * Returns the raw text response from the assistant.
 * @param {string} apiKey
 * @param {string} synthesisContent
 * @returns {Promise<string>}
 */
/**
 * NOTE — Prompt injection awareness: synthesisContent is inserted verbatim into
 * the LLM prompt. A malicious synthesis document could attempt to override the
 * extraction instructions. This risk is mitigated downstream by parseInsightCandidates(),
 * which validates structure (JSON array, required fields, scope enum) and rejects
 * non-conforming output. The attack surface is minimal for a developer tool that
 * only processes the project's own synthesis files.
 */
function callAnthropicAPI(apiKey, synthesisContent) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\n---\n\nSYNTHESIS DOCUMENT:\n\n${synthesisContent}`,
        },
      ],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 400) {
          return reject(new Error(`Anthropic API error ${res.statusCode}: ${raw}`));
        }
        try {
          const parsed = JSON.parse(raw);
          const text = parsed?.content?.[0]?.text ?? '';
          resolve(text);
        } catch {
          reject(new Error(`Failed to parse Anthropic API response: ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Parses and validates an array of insight candidates from the LLM response text.
 * Returns only candidates with required fields present.
 * @param {string} text - Raw LLM response text expected to be a JSON array
 * @returns {Array<{ title: string, content: string, scope: string, category: string, tags: string[], confidence: number }>}
 */
function parseInsightCandidates(text) {
  // Strip markdown code fences if the LLM wrapped the output
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  let candidates;
  try {
    candidates = JSON.parse(stripped);
  } catch (err) {
    throw new Error(`LLM output is not valid JSON: ${err.message}\nOutput snippet: ${stripped.slice(0, 300)}`);
  }

  if (!Array.isArray(candidates)) {
    throw new Error(`LLM output is not a JSON array. Got: ${typeof candidates}`);
  }

  return candidates.filter((c) => {
    if (typeof c !== 'object' || c === null) return false;
    if (!c.title || typeof c.title !== 'string') return false;
    if (!c.content || typeof c.content !== 'string') return false;
    if (!c.scope || !['global', 'project'].includes(c.scope)) return false;
    return true;
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    console.error('Set it before running: ANTHROPIC_API_KEY=sk-... node scripts/migrate-synthesis-insights.js');
    process.exit(1);
  }

  if (!fs.existsSync(LEDGER_ROOT)) {
    console.error(`Error: Ledger root not found at ${LEDGER_ROOT}`);
    console.error('Build the MCP server and initialize at least one project first.');
    process.exit(1);
  }

  // Discover projects
  let slugs = findProjectsWithSynthesis();

  if (opts.project) {
    if (!slugs.includes(opts.project)) {
      console.error(`Error: project "${opts.project}" not found or has no synthesis.md`);
      console.error(`Available projects: ${slugs.join(', ') || '(none)'}`);
      process.exit(1);
    }
    slugs = [opts.project];
  }

  if (opts.limit !== null) {
    // NOTE: --limit is applied to the *candidate* list, not to the number of
    // projects actually committed. When combined with --resume, projects that are
    // already processed count against the limit. Use a higher --limit value if
    // you need to guarantee N new projects are processed in a single run.
    slugs = slugs.slice(0, opts.limit);
  }

  // Summary counters
  const summary = {
    projectsProcessed: 0,
    projectsSkipped:   0,
    errors:            0,
    insightsExtracted: 0,
    duplicatesSkipped: 0,
  };

  // Snapshot of existing titles for deduplication (refreshed after each commit batch)
  let existingTitles = await loadExistingTitles();

  console.error(`[migrate] Ledger root: ${LEDGER_ROOT}`);
  console.error(`[migrate] Projects to process: ${slugs.length}`);
  if (opts.dryRun)  console.error('[migrate] DRY RUN — no writes will occur');
  if (opts.resume)  console.error('[migrate] RESUME mode — skipping projects with existing insights');
  if (opts.verbose) console.error('[migrate] Verbose logging enabled');
  console.error('');

  for (const slug of slugs) {
    // --resume: skip projects already processed
    if (opts.resume && await projectHasInsights(slug)) {
      logVerbose(opts.verbose, `Skipping ${slug} (already has insights)`);
      summary.projectsSkipped++;
      continue;
    }

    const synthPath = path.join(LEDGER_ROOT, slug, 'synthesis.md');
    const sourceRef = path.join(slug, 'synthesis.md');

    console.error(`[migrate] Processing: ${slug}`);

    try {
      const synthesisContent = fs.readFileSync(synthPath, 'utf-8');
      logVerbose(opts.verbose, `  Read synthesis.md (${synthesisContent.length} chars)`);

      // Call LLM
      const rawResponse = await callAnthropicAPI(apiKey, synthesisContent);
      logVerbose(opts.verbose, `  LLM response: ${rawResponse.length} chars`);

      // Parse candidates
      const candidates = parseInsightCandidates(rawResponse);
      logVerbose(opts.verbose, `  Extracted ${candidates.length} candidate(s)`);

      // In dry-run mode, print candidates as JSON and continue
      if (opts.dryRun) {
        const dryRunOutput = candidates.map((c) => ({
          ...c,
          source: sourceRef,
          confidence: typeof c.confidence === 'number' ? c.confidence : 0.5,
          tags: Array.isArray(c.tags) ? c.tags : [],
        }));
        console.log(JSON.stringify(dryRunOutput, null, 2));
        summary.insightsExtracted += candidates.length;
        summary.projectsProcessed++;
        continue;
      }

      // Commit (non-dry-run)
      let committedCount = 0;
      for (const candidate of candidates) {
        const normalTitle = normalizeTitle(candidate.title);

        // Deduplication
        if (existingTitles.has(normalTitle)) {
          logVerbose(opts.verbose, `  Skipping duplicate: "${candidate.title}"`);
          summary.duplicatesSkipped++;
          continue;
        }

        const insightWithSource = {
          ...candidate,
          source: sourceRef,
          confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.5,
          tags: Array.isArray(candidate.tags) ? candidate.tags : [],
        };

        const result = await commitInsight(insightWithSource, slug, false);
        if (result.committed) {
          existingTitles.add(normalTitle);
          committedCount++;
          summary.insightsExtracted++;
          logVerbose(opts.verbose, `  Committed KN-${String(result.id).padStart(4, '0')}: "${candidate.title}"`);
        }
      }

      console.error(`  → ${committedCount} committed, ${candidates.length - committedCount} skipped`);
      summary.projectsProcessed++;

    } catch (err) {
      console.error(`  [ERROR] ${slug}: ${err.message}`);
      summary.errors++;
      // Per-project error does not abort the batch — continue to next project
    }
  }

  // ── Summary report ──────────────────────────────────────────────────────
  console.error('');
  console.error('─────────────────────────────────────────');
  console.error('[migrate] Summary');
  console.error('─────────────────────────────────────────');
  console.error(`  Projects processed : ${summary.projectsProcessed}`);
  console.error(`  Projects skipped   : ${summary.projectsSkipped}`);
  console.error(`  Insights extracted : ${summary.insightsExtracted}`);
  console.error(`  Duplicates skipped : ${summary.duplicatesSkipped}`);
  console.error(`  Errors             : ${summary.errors}`);
  console.error('─────────────────────────────────────────');

  if (summary.errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err.message);
  process.exit(1);
});
