import { readImage } from '@/repositories/imageAssets';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ hash: string }> }) {
  try {
    const { hash } = await params;
    return new Response(new Uint8Array(await readImage(hash)), { headers: { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
  } catch { return new Response('Image unavailable', { status: 404 }); }
}

