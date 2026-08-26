/**
 * scripts/lib/package-version.js
 *
 * Shared read/write helpers for module version fields, used by the two
 * changelog-driven version writers (mcp-server/scripts/sync-version.js and the
 * post-build step in scripts/build-personas.js) and by the drift check in
 * scripts/check-version-sync.js.
 *
 * A module's version lives in three places once a lock file exists:
 *   package.json           → version
 *   package-lock.json      → version
 *   package-lock.json      → packages[""].version
 *
 * npm keeps the latter two in step with package.json on every install. Writing
 * only package.json therefore leaves a latent diff that the next unrelated
 * `npm install` silently materialises in someone else's commit.
 *
 * Only these version fields are touched — never the dependency tree — so no
 * registry access or resolution is involved.
 *
 * Dependency direction: this file MUST NOT import from scripts/cli.js or any
 * other file in scripts/ outside of scripts/lib/.
 */

import fs from 'fs';

/**
 * Extract the first released semver from a changelog's `## v{X.Y.Z}` heading.
 * Returns 'UNRELEASED' when the topmost heading is an UNRELEASED entry.
 * @param {string} filePath Absolute path to the changelog.
 * @returns {string|'UNRELEASED'|null}
 */
export function readChangelogVersion(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const firstHeading = content.match(/^##\s+(.+)/m);
  if (firstHeading && /unreleased/i.test(firstHeading[1])) return 'UNRELEASED';
  const m = content.match(/^##\s+v(\d+\.\d+\.\d+)/m);
  return m ? m[1] : null;
}

/**
 * @param {string} filePath Absolute path to a package.json.
 * @returns {string|null}
 */
export function readPackageJsonVersion(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')).version ?? null;
}

/**
 * Read both version fields from a lock file.
 * Returns null when the lock file does not exist — a module without a lock is
 * a valid state, not a mismatch.
 * @param {string} filePath Absolute path to a package-lock.json.
 * @returns {{ root: string|null, pkg: string|null }|null}
 */
export function readLockVersions(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lock = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    root: lock.version ?? null,
    pkg:  lock.packages?.['']?.version ?? null,
  };
}

/**
 * Write `version` into a package.json, preserving 2-space formatting.
 * @param {string} filePath
 * @param {string} version
 * @returns {{ changed: boolean, oldVersion: string|null }}
 */
export function writePackageJsonVersion(filePath, version) {
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const oldVersion = pkg.version ?? null;
  if (oldVersion === version) return { changed: false, oldVersion };
  pkg.version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return { changed: true, oldVersion };
}

/**
 * Write both version fields into a package-lock.json. No-ops when the lock file
 * is absent. `packages[""]` is only written when that entry already exists —
 * its absence means a lock format that does not carry a root package record.
 * @param {string} filePath
 * @param {string} version
 * @returns {{ changed: boolean, oldVersions: { root: string|null, pkg: string|null }|null }}
 */
export function writeLockVersion(filePath, version) {
  const current = readLockVersions(filePath);
  if (!current) return { changed: false, oldVersions: null };
  if (current.root === version && current.pkg === version) {
    return { changed: false, oldVersions: current };
  }

  const lock = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return { changed: true, oldVersions: current };
}

/**
 * Sync a module's package.json and package-lock.json to `version`.
 * @param {object} opts
 * @param {string} opts.packageJson Absolute path to package.json.
 * @param {string} [opts.lockFile]  Absolute path to package-lock.json.
 * @param {string} opts.version     Target version.
 * @param {(msg: string) => void} [opts.log]
 * @returns {{ pkgChanged: boolean, lockChanged: boolean }}
 */
export function syncModuleVersion({ packageJson, lockFile, version, log = () => {} }) {
  const pkgResult = writePackageJsonVersion(packageJson, version);
  if (pkgResult.changed) {
    log(`  package.json: ${pkgResult.oldVersion} → ${version}`);
  }

  let lockChanged = false;
  if (lockFile) {
    const lockResult = writeLockVersion(lockFile, version);
    lockChanged = lockResult.changed;
    if (lockChanged) {
      log(`  package-lock.json: ${lockResult.oldVersions?.root} → ${version}`);
    }
  }

  if (!pkgResult.changed && !lockChanged) {
    log(`  already at v${version} — no change needed`);
  }

  return { pkgChanged: pkgResult.changed, lockChanged };
}
