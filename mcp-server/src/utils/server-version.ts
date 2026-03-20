import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In src/utils/ → package.json is two levels up (../../package.json)
// In dist/utils/ → package.json is also two levels up (../../package.json)
const PACKAGE_JSON_PATH = join(__dirname, '..', '..', 'package.json');

/**
 * MCP server version captured at process startup (module-load time).
 * This is the "running" version — the code that is actually executing.
 */
export const SERVER_VERSION: string = JSON.parse(
  readFileSync(PACKAGE_JSON_PATH, 'utf-8')
).version;

/**
 * Re-reads the MCP server version from package.json on disk.
 * Use this to detect whether the running process is stale: if
 * `readPackageVersion() !== SERVER_VERSION`, the source has been
 * updated since this process started and a rebuild/restart is needed.
 */
export function readPackageVersion(): string {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')).version;
}
