import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '@/repositories/store';

/**
 * `writeJsonAtomic` normally renames a temp file into place, which is atomic.
 * When Windows refuses that rename (another handle holds the destination open)
 * it falls back to `fs.copyFile`, which is *not* atomic — a concurrent reader
 * can observe an empty or half-written file. `readJson` retries to absorb that
 * window. These tests pin both halves of that contract.
 */

const dir = path.join(process.cwd(), 'data', 'runtime-test', 'store-unit');

describe('store: tolerant reads without masking real corruption', () => {
  it('absorbs a transiently empty file instead of throwing', async () => {
    const file = path.join(dir, 'transient.json');
    await fs.mkdir(dir, { recursive: true });
    // Simulate the torn-read window: the file exists but the content has not
    // landed yet.
    await fs.writeFile(file, '', 'utf8');
    setTimeout(() => {
      void writeJsonAtomic(file, { n: 42, state: 'completed' });
    }, 25);

    const value = await readJson<{ n: number; state: string }>(file);
    expect(value).toEqual({ n: 42, state: 'completed' });
  });

  it('still throws when the content is genuinely malformed', async () => {
    const file = path.join(dir, 'corrupt.json');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, '{ this is not json', 'utf8');

    await expect(readJson(file)).rejects.toThrow();
  });

  it('returns null for a missing file', async () => {
    const file = path.join(dir, 'does-not-exist.json');
    await expect(readJson(file)).resolves.toBeNull();
  });

  it(
    'never surfaces a torn read while a writer rewrites the same file',
    async () => {
      const file = path.join(dir, 'concurrent.json');
      await writeJsonAtomic(file, { n: 0 });

      let writing = true;
      const writer = (async () => {
        for (let n = 1; n <= 40; n += 1) {
          await writeJsonAtomic(file, { n });
        }
        writing = false;
      })();

      const seen: number[] = [];
      while (writing) {
        // Any throw here fails the test: a reader must never see a partial file.
        const value = await readJson<{ n: number }>(file);
        expect(value).not.toBeNull();
        seen.push(value!.n);
      }
      await writer;

      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((n) => Number.isInteger(n))).toBe(true);
    },
    20000,
  );
});
