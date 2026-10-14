import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { storageNamespace } from './neon';
let client: S3Client | undefined;
function s3(): S3Client {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION;
  if (!endpoint || !accessKeyId || !secretAccessKey || !region) throw new Error('Neon object-storage environment variables are required.');
  if (!client) client = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 3 });
  return client;
}
function bucket(): string { return process.env.RYDR_STORAGE_BUCKET ?? 'assets'; }
function objectKey(key: string): string { return `${storageNamespace()}/${key}`; }
export async function putPrivateObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: objectKey(key), Body: bytes, ContentType: contentType, CacheControl: 'private, no-store' }));
}
export async function getPrivateObject(key: string): Promise<Buffer> {
  try {
    const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: objectKey(key) }));
    if (!result.Body) throw new Error('Stored object has no content.');
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    if (error instanceof Error && ['NoSuchKey', 'NotFound'].includes(error.name)) {
      throw Object.assign(new Error('Stored object is unavailable.'), { code: 'ENOENT' });
    }
    throw error;
  }
}
