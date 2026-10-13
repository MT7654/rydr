import { afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Each test run gets its own scratch runtime directory, so runs never reuse
 * persisted results and never touch the app's own `data/runtime/` state.
 */
const scratch = path.join(
  'data',
  'runtime-test',
  `run-${process.pid}-${Date.now().toString(36)}`,
);

process.env.RYDR_RUNTIME_DIR = scratch;

afterAll(async () => {
  try {
    await rm(path.join(process.cwd(), scratch), { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort; the directory is gitignored either way.
  }
});
