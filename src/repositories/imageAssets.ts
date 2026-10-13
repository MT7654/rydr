import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { RUNTIME_DIR, ensureDir, scopeRuntimePath } from './store';
const DIR = path.join(RUNTIME_DIR, 'images');
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export async function storeImage(bytes: Buffer, claimedType: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Images must be between 1 byte and 5 MB.');
  const metadata = await sharp(bytes, { limitInputPixels: 20000000 }).metadata();
  const types: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const mime = types[metadata.format ?? ''];
  if (!mime || mime !== claimedType || (metadata.pages ?? 1) > 1) throw new Error('Use a single JPEG, PNG or WebP matching its declared type.');
  const preview = await sharp(bytes, { limitInputPixels: 20000000 }).rotate().resize({ width: 1600, withoutEnlargement: true }).png().toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const pixels = await sharp(bytes).rotate().resize(8, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  const visualFingerprint = [...pixels].map(value => value >= mean ? '1' : '0').join('');
  await ensureDir(DIR);
  for (const [extension, content] of [['original', bytes], ['png', preview]] as const) {
    await fs.writeFile(await scopeRuntimePath(path.join(DIR, `${hash}.${extension}`)), content, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
  }
  return { hash, mimeType: mime, sizeBytes: bytes.length, assetUrl: `/api/images/${hash}`, metadata: { width: String(metadata.width), height: String(metadata.height), visualFingerprint } };
}
export async function readImage(hash: string, original = false): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid image reference.');
  const bytes = await fs.readFile(await scopeRuntimePath(path.join(DIR, `${hash}.${original ? 'original' : 'png'}`)));
  if (original && createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Image content differs from its recorded hash.');
  return bytes;
}
