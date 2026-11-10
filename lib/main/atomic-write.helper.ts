import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Two writes of one file that overlap must not share a temporary file.
let sequence = 0;

/**
 * Replaces a file in one step: the content is written and flushed to a sibling file, which is
 * then renamed over the target. A crash or a power cut leaves either the old file or the new
 * one, never a half-written one. Files are private to the user (0600).
 */
const writeFileAtomic = async (
  path: string,
  content: string | Uint8Array
): Promise<void> => {
  sequence += 1;
  const temporary = `${path}.${process.pid}.${sequence}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, content, { mode: 0o600, flush: true });
    await rename(temporary, path);
  } catch (error) {
    // A cleanup that fails must not hide why the write failed.
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

export default writeFileAtomic;
