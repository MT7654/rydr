import { it, expect, vi, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { uploadAdpImage } from '../src/providers/adpStorage';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('renews upload authorization for every image and verifies the prepared pixels', async () => {
  vi.stubEnv('ADP_SecretId', 'test-cloud-id'); vi.stubEnv('ADP_SecretKey', 'test-cloud-secret'); vi.stubEnv('RYDR_ADP_VISION_APPKEY', 'test-storage-agent');
  const original = await readFile('public/damage-demo/seat-view-1.png');
  const hash = createHash('sha256').update(original).digest('hex');
  let uploaded: Uint8Array | undefined; let renewals = 0;
  const imageUrl = 'https://test.cos.ap-jakarta.myqcloud.com/image.png';
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    if (String(input).includes('tencentcloudapi.com')) {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toContain('TC3-HMAC-SHA256 Credential=test-cloud-id/');
      if (headers['X-TC-Action'] === 'DescribeRobotBizIDByAppKey') return Response.json({ Response: { BotBizId: '12345' } });
      expect(JSON.parse(String(init?.body))).toEqual({ BotBizId: '12345', FileType: 'png', IsPublic: true, TypeKey: 'realtime' });
      renewals++; return Response.json({ Response: { UploadUrl: imageUrl, FileUrl: imageUrl, ExpiredTime: Math.floor(Date.now()/1000)+600 } });
    }
    if (init?.method === 'PUT') { uploaded = init.body as Uint8Array; return new Response(null); }
    return new Response(uploaded ? new Uint8Array(uploaded) : null);
  }));
  expect(await uploadAdpImage(original, hash)).toBe(imageUrl);
  const metadata = await sharp(uploaded).metadata(); expect(metadata.format).toBe('png'); expect(metadata.width).toBeLessThanOrEqual(2000);
  await uploadAdpImage(original, hash); expect(renewals).toBe(2);
});
it('rejects altered originals before requesting credentials', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(uploadAdpImage(Buffer.from('altered'), 'a'.repeat(64))).rejects.toThrow(/hash/);
  expect(fetch).not.toHaveBeenCalled();
});
it('does not expose provider errors or secrets when authorization fails', async () => {
  vi.stubEnv('ADP_SecretId', 'different-id'); vi.stubEnv('ADP_SecretKey', 'private-value'); vi.stubEnv('RYDR_ADP_VISION_APPKEY', 'different-agent');
  const original = await readFile('public/damage-demo/seat-view-1.png');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ Response: { Error: { Message: 'private-value', Code: 'AuthFailure' } } })));
  await expect(uploadAdpImage(original, createHash('sha256').update(original).digest('hex'))).rejects.toThrow('Check the server credential permissions');
});
