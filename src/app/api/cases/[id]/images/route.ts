import { attachDamageImage, analyzeDamageImages, visionReceiptFile } from '@/lib/damageEvidence';
import { readJson } from '@/repositories/store';
import { visionMode } from '@/providers/vision';
import { registerAdpImageSource } from '@/repositories/visionSources';
import { getCase } from '@/repositories/cases';
import { mutationRole } from '@/lib/journeyApi';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const version = Number(new URL(request.url).searchParams.get('version'));
  if (!Number.isSafeInteger(version) || version < 1) return Response.json({ error: 'Valid case version required.' }, { status: 400 });
  return Response.json({ receipt: await readJson(visionReceiptFile(id, version, visionMode())) }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if(await mutationRole(request)!=='reviewer')throw new Error('Only a reviewer may manage image analysis.');
    const origin = request.headers.get('origin');
    // Next may construct request.url with an internal hostname; Host names the
    // browser-facing authority. Compare that authority rather than localhost.
    const publicHost = request.headers.get('host') ?? new URL(request.url).host;
    if (origin && new URL(origin).host !== publicHost) throw new Error('Image actions must originate from this app.');
    if (Number(request.headers.get('content-length') ?? 0) > 6 * 1024 * 1024) throw new Error('Upload exceeds the bounded request size.');
    const { id } = await params;
    const data = await request.formData();
    const version = Number(data.get('version'));
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Valid case version required.');
    if(data.get('action') === 'link_adp_image') {
      const record=await getCase(id);const image=record?.evidence.find(e=>e.kind === 'image' && e.id === String(data.get('imageId')));
      if(!record || record.version!==version || !image || image.kind!=='image')throw new Error('Reload the current image packet.');
      await registerAdpImageSource(image.payload.hash,String(data.get('url')));return Response.json({linked:true});
    }
    if (data.get('action') === 'analyze') return Response.json(await analyzeDamageImages(id, version,data.get('retry') === 'true'));
    const file = data.get('image');
    if (!(file instanceof File)) throw new Error('Select an image.');
    return Response.json(await attachDamageImage(id, file, version));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Image operation failed.' }, { status: 400 }); }
}

