import { NextResponse } from 'next/server';
import { healthSnapshot } from '@/lib/runtime';

export async function GET() {
  // Deliberately exposes no keys and no internal endpoints.
  return NextResponse.json(healthSnapshot());
}

