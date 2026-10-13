import { createHash, createHmac } from 'node:crypto';
import sharp from 'sharp';
import { approvedAdpImageUrl } from '../repositories/visionSources';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
let application: { fingerprint: string; id: string } | undefined;
export function automaticAdpUploadConfigured() {
  return !!(process.env.ADP_SecretId && process.env.ADP_SecretKey && process.env.RYDR_ADP_VISION_APPKEY);
}
/** Cloud credentials remain server-side; each upload receives fresh, scoped credentials. */
async function request(action: string, body: Record<string, unknown>) {
  if (!automaticAdpUploadConfigured()) throw new Error('Automatic image upload credentials are unavailable.');
  const host = 'lke.ap-singapore.tencentcloudapi.com';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify(body);
  const scope = `${date}/lke/tc3_request`;
  const canonical = `POST\n/\n\ncontent-type:application/json\nhost:${host}\n\ncontent-type;host\n${digest(payload)}`;
  const key = hmac(hmac(hmac(`TC3${process.env.ADP_SecretKey}`, date), 'lke'), 'tc3_request');
  const signature = hmac(key, `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${digest(canonical)}`).toString('hex');
  const response = await fetch(`https://${host}`, {
    method: 'POST', signal: AbortSignal.timeout(20000), redirect: 'error',
    headers: { 'Content-Type': 'application/json', Host: host,
      Authorization: `TC3-HMAC-SHA256 Credential=${process.env.ADP_SecretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
      'X-TC-Action': action, 'X-TC-Timestamp': String(timestamp), 'X-TC-Version': '2023-11-30', 'X-TC-Region': 'ap-jakarta' },
    body: payload,
  });
  if (!response.ok) throw new Error('Cloud image authorization failed.');
  const result = (await response.json()).Response;
  if (!result || result.Error) throw new Error('Cloud image authorization failed. Check the server credential permissions.');
  return result;
}
export async function uploadAdpImage(original: Buffer, originalHash: string) {
  if (!original.length || original.length > 5 * 1024 * 1024 || digest(original) !== originalHash) throw new Error('Original image does not match the evidence hash.');
  // ADP accepts PNG/JPEG within 2000 pixels. Preserve original evidence locally;
  // send a metadata-stripped PNG derivative, without claiming capture metadata.
  const bytes = await sharp(original, { limitInputPixels: 20000000 }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Image derivative exceeds the cloud upload limit.');
  const fingerprint = digest(JSON.stringify([process.env.ADP_SecretId, process.env.ADP_SecretKey, process.env.RYDR_ADP_VISION_APPKEY]));
  if (application?.fingerprint !== fingerprint) {
    const result = await request('DescribeRobotBizIDByAppKey', { AppKey: process.env.RYDR_ADP_VISION_APPKEY });
    if (typeof result.BotBizId !== 'string' || !/^\d+$/.test(result.BotBizId)) throw new Error('Image agent application ID is unavailable.');
    application = { fingerprint, id: result.BotBizId };
  }
  const storage = await request('DescribeStorageCredential', { BotBizId: application.id, FileType: 'png', IsPublic: true, TypeKey: 'realtime' });
  if (!storage.UploadUrl || !storage.FileUrl || storage.ExpiredTime * 1000 < Date.now() + 60000) throw new Error('Image upload authorization is incomplete or expired.');
  const uploadUrl = approvedAdpImageUrl(storage.UploadUrl);
  const imageUrl = approvedAdpImageUrl(storage.FileUrl);
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(bytes), redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!put.ok) throw new Error('Cloud image upload failed.');
  const get = await fetch(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!get.ok || !get.body || Number(get.headers.get('content-length')) > 5 * 1024 * 1024) throw new Error('Uploaded image could not be verified.');
  const reader = get.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 5 * 1024 * 1024) throw new Error('Uploaded image exceeds the verification limit.'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const downloaded = Buffer.concat(chunks);
  if (downloaded.length > 5 * 1024 * 1024 || digest(downloaded) !== digest(bytes)) throw new Error('Uploaded image bytes differ from the prepared derivative.');
  return imageUrl;
}
