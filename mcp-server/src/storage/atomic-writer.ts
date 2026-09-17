import { writeFile, rename, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';

/**
 * Writes text to a file atomically using the write-to-temp-then-rename pattern.
 *
 * The process:
 * 1. Write `contents` to {filePath}.tmp.{pid}
 * 2. Use fs.rename to atomically replace the target file (POSIX semantics)
 * 3. Clean up temp file on error
 *
 * This ensures that readers never see partial writes. This is the generic
 * core `atomicWriteJson()` delegates to — callers that need to write
 * pre-serialised text (e.g. a rendered Markdown mirror) should call this
 * directly rather than serialising through `atomicWriteJson()`.
 *
 * @param filePath - Absolute path to the target file
 * @param contents - Text to write, as-is (no serialisation is applied)
 * @throws Error if write or rename fails
 */
export async function atomicWriteText(
  filePath: string,
  contents: string
): Promise<void> {
  const pid = process.pid;
  const tempPath = `${filePath}.tmp.${pid}`;

  try {
    // Ensure the parent directory exists
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Write to temp file
    await writeFile(tempPath, contents, 'utf-8');

    // Atomically rename temp file to target (POSIX atomic)
    await rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors (temp file may not exist)
    }

    // Re-throw original error
    throw new Error(
      `Failed to write to ${filePath}: ${(error as Error).message}`
    );
  }
}

/**
 * Writes JSON data to a file atomically using the write-to-temp-then-rename pattern.
 *
 * Serialises `data` as pretty-printed JSON (2-space indentation, trailing
 * newline) and delegates the actual temp-then-rename write to
 * {@link atomicWriteText}.
 *
 * @param filePath - Absolute path to the target file
 * @param data - Data to serialize as JSON
 * @throws Error if write or rename fails
 */
export async function atomicWriteJson(
  filePath: string,
  data: unknown
): Promise<void> {
  // Pretty-print JSON with 2-space indentation and trailing newline
  const json = JSON.stringify(data, null, 2) + '\n';
  await atomicWriteText(filePath, json);
}
