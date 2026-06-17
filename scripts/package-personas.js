import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execSync } from 'child_process';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args             = process.argv.slice(2);
const SKIP_BUILD       = args.includes('--skip-build');
const versionArgIdx    = args.indexOf('--version');
const VERSION_OVERRIDE = versionArgIdx !== -1 ? args[versionArgIdx + 1] : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function die(msg) {
  process.stderr.write(`package-personas: ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// Parse version from changelog.md (mirrors extract-changelog-entry.js logic)
// ---------------------------------------------------------------------------
function parseVersion() {
  if (VERSION_OVERRIDE) return VERSION_OVERRIDE;

  const changelogPath = path.join(WORKSPACE_ROOT, 'changelog.md');
  let raw;
  try {
    raw = fs.readFileSync(changelogPath, 'utf8');
  } catch (err) {
    die(`Cannot read changelog.md: ${err.message}`);
  }

  // Matches: ## v1.2.3 — Title  or  ## v1.2.3 - Title
  const HEADER_RE = /^## (v[\d.]+(?:-\w+)?)\s+[-\u2014]\s+/m;
  const m = HEADER_RE.exec(raw);
  if (!m) die('No parseable ## v* entry found in changelog.md');
  return m[1];
}

// ---------------------------------------------------------------------------
// CRC-32 (required by ZIP spec)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP builder — pure Node.js, no external dependencies
//
// Spec references:
//   https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
//   DEFLATE (method 8) via Node's built-in zlib.deflateRawSync
// ---------------------------------------------------------------------------

/**
 * Build a complete ZIP file buffer from an array of file entries.
 * Each entry: { name: string, data: Buffer }
 * Stores only the filename (no directory prefix), mirroring `zip -j`.
 */
function buildZip(entries) {
  const localParts  = [];  // interleaved [headerBuf, dataBuf, ...]
  const centralDirs = [];
  const offsets     = [];
  let   offset      = 0;

  // Fixed DOS date/time: 2000-01-01 00:00:00 — deterministic, no TZ issues
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x2821;

  for (const entry of entries) {
    const nameBytes  = Buffer.from(entry.name, 'utf8');
    const rawData    = entry.data;
    const crc        = crc32(rawData);
    const deflated   = zlib.deflateRawSync(rawData, { level: 6 });
    const useDeflate = deflated.length < rawData.length;
    const compData   = useDeflate ? deflated : rawData;
    const method     = useDeflate ? 8 : 0;   // 8 = DEFLATE, 0 = STORE

    // ---- Local file header (30 bytes + filename) ----
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);          // PK\x03\x04
    local.writeUInt16LE(20, 4);                  // version needed (2.0)
    local.writeUInt16LE(0, 6);                   // flags
    local.writeUInt16LE(method, 8);              // compression method
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compData.length, 18);    // compressed size
    local.writeUInt32LE(rawData.length, 22);     // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);                  // extra field length
    nameBytes.copy(local, 30);

    offsets.push(offset);
    localParts.push(local, compData);
    offset += local.length + compData.length;

    // ---- Central directory entry (46 bytes + filename) ----
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);             // PK\x01\x02
    cd.writeUInt16LE(20, 4);                     // version made by
    cd.writeUInt16LE(20, 6);                     // version needed
    cd.writeUInt16LE(0, 8);                      // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compData.length, 20);
    cd.writeUInt32LE(rawData.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);                     // extra field length
    cd.writeUInt16LE(0, 32);                     // comment length
    cd.writeUInt16LE(0, 34);                     // disk number start
    cd.writeUInt16LE(0, 36);                     // internal attributes
    cd.writeUInt32LE(0, 38);                     // external attributes
    cd.writeUInt32LE(offsets[offsets.length - 1], 42); // local header offset
    nameBytes.copy(cd, 46);

    centralDirs.push(cd);
  }

  const cdOffset = offset;
  const cdSize   = centralDirs.reduce((s, b) => s + b.length, 0);

  // ---- End of central directory record (22 bytes) ----
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);             // PK\x05\x06
  eocd.writeUInt16LE(0, 4);                      // disk number
  eocd.writeUInt16LE(0, 6);                      // disk with start of CD
  eocd.writeUInt16LE(entries.length, 8);         // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);        // total entries
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);                     // comment length

  return Buffer.concat([...localParts, ...centralDirs, eocd]);
}

// ---------------------------------------------------------------------------
// Collect .md files from a directory (sorted, filenames only — mirrors zip -j)
// ---------------------------------------------------------------------------
function collectMdFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    die(`Cannot read directory ${dir}: ${err.message}`);
  }
  return names
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => ({
      name: f,
      data: fs.readFileSync(path.join(dir, f)),
    }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const version = parseVersion();
log(`Version: ${version}`);

if (!SKIP_BUILD) {
  log('\nBuilding standalone personas...');
  try {
    execSync('node scripts/build-personas.js --suite standalone --target all --strict', {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
    });
  } catch {
    die('build-personas.js failed — aborting packaging.');
  }
} else {
  log('Skipping build (--skip-build).');
}

const distDir = path.join(WORKSPACE_ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
log(`\nOutput directory: dist/`);

const TARGETS = [
  { dir: 'personas/standalone/vs-code',          label: 'VS Code',                   slug: 'vscode'                    },
  { dir: 'personas/standalone/claude-code',       label: 'Claude Code',               slug: 'claudecode'                },
];

for (const target of TARGETS) {
  const srcDir  = path.join(WORKSPACE_ROOT, target.dir);
  const zipName = `ai-insights-personas-${target.slug}-${version}.zip`;
  const zipPath = path.join(distDir, zipName);

  log(`\nPackaging ${target.label} personas → dist/${zipName}`);

  const files = collectMdFiles(srcDir);
  if (files.length === 0) die(`No .md files found in ${target.dir}`);
  log(`  ${files.length} file(s): ${files.map(f => f.name).join(', ')}`);

  const zipBuf = buildZip(files);
  fs.writeFileSync(zipPath, zipBuf);
  log(`  Written: ${zipBuf.length.toLocaleString()} bytes`);
}

log('\nDone.');
