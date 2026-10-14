import { NextResponse } from 'next/server';
import { storageBackend } from '@/repositories/neon';
import { healthSnapshot } from '@/lib/runtime';

export async function GET() {
  // Deliberately exposes no keys and no internal endpoints.
  return NextResponse.json({ ...healthSnapshot(), storage: { records: storageBackend(), uploads: storageBackend() === 'neon' ? 'neon-private-bucket' : 'local-files' } });
}

