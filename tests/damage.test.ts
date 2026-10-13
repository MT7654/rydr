import { describe, it, expect, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { storeImage, readImage, MAX_IMAGE_BYTES } from '../src/repositories/imageAssets';
import { attachDamageImage, analyzeDamageImages } from '../src/lib/damageEvidence';
import { createFixtureVisionProvider, visionMode, visionProvider } from '../src/providers/vision';
import { createRuntimeCase, getCaseVersion } from '../src/repositories/cases';
import { startRun, DEFAULT_CONFIG } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { assessImageIntegrity } from '../src/domain/imageEvidence';
import { loadCase } from './helpers';
import { evaluateCase } from '../src/domain/policy';
import { loadDemoPack } from './helpers';
import { POST } from '../src/app/api/cases/[id]/images/route';
vi.mock('../src/lib/demoSession',()=>({ getDemoRole:async()=> 'reviewer' }));
async function png() { return sharp({ create: { width: 12, height: 12, channels: 3, background: '#777777' } }).png().toBuffer(); }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('damage evidence trust boundaries', () => {
  it('accepts the browser-facing authority and rejects a different origin', async () => {
    const form = new FormData(); form.set('version', '1');
    const context = { params: Promise.resolve({ id: 'SYN-009' }) };
    const valid = await POST(new Request('http://localhost:3013/api/cases/SYN-009/images', { method: 'POST', headers: { host: '127.0.0.1:3013', origin: 'http://127.0.0.1:3013' }, body: form }), context);
    expect((await valid.json()).error).toBe('Select an image.');
    const invalid = await POST(new Request('http://localhost:3013/api/cases/SYN-009/images', { method: 'POST', headers: { host: '127.0.0.1:3013', origin: 'https://different.example' }, body: form }), context);
      expect((await invalid.json()).error).toMatch(/Cross-origin|originate/);
  });
  it('decodes uploads, hashes original bytes and supplies a stripped preview', async () => {
    const bytes = await png(); const asset = await storeImage(bytes, 'image/png');
    expect(asset.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await readImage(asset.hash, true)).toEqual(bytes);
    expect((await sharp(await readImage(asset.hash)).metadata()).format).toBe('png');
    await expect(storeImage(bytes, 'image/jpeg')).rejects.toThrow('declared type');
    await expect(storeImage(Buffer.from('<svg/>'), 'image/png')).rejects.toThrow();
    await expect(storeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png')).rejects.toThrow('5 MB');
    await expect(readImage('../secret')).rejects.toThrow('Invalid');
  });
  it('blocks unverified live vision instead of substituting a fixture', () => {
    vi.stubEnv('RYDR_VISION_MODE', 'live'); vi.stubEnv('RYDR_VISION_VERIFIED', 'false');
    expect(visionMode()).toBe('blocked'); expect(visionProvider()).toBeNull();
  });
  it('reports reused synthetic images and metadata conflicts without an automatic accusation', async () => {
    const record = await loadCase('SYN-010');
    const findings = evaluateCase(record, await loadDemoPack()).findings;
    expect(new Set(findings.map(f => f.id)).size).toBe(findings.length);
    const report = assessImageIntegrity({ evidence: record.evidence, tripScheduledAt: record.trip.scheduledAt });
    expect(report.signals.map(s => s.code)).toEqual(expect.arrayContaining(['duplicate_image', 'mismatched_timestamp', 'unlinked_image', 'wear_and_tear', 'inadequate_angles']));
    const image = record.evidence.find(e => e.kind === 'image')!;
    if (image.kind !== 'image') throw new Error('Missing image');
    const similar = { ...image, id: 'SIMILAR', payload: { ...image.payload, hash: 'different', metadata: { visualFingerprint: '1'.repeat(64) } } };
    const first = { ...image, payload: { ...image.payload, metadata: { visualFingerprint: '1'.repeat(64) } } };
    expect(assessImageIntegrity({ evidence: [first, similar], tripScheduledAt: null }).signals.some(s => s.code === 'near_duplicate_image')).toBe(true);
  });
  it('appends immutable evidence, identifies duplicates and keeps damage under human review', async () => {
    vi.stubEnv('RYDR_VISION_MODE', 'fixture');
    const base = await loadCase('SYN-009');
    await createRuntimeCase({ ...base, id: 'DAMAGE-TEST', evidence: base.evidence.slice(0, 1) });
    const bytes = await png(); const file = new File([new Uint8Array(bytes)], 'demo.png', { type: 'image/png' });
    const v2 = await attachDamageImage('DAMAGE-TEST', file, 1);
    expect((await getCaseVersion('DAMAGE-TEST', 1))?.evidence).toHaveLength(1);
    await expect(attachDamageImage('DAMAGE-TEST', file, 1)).rejects.toThrow('Case changed');
    const v3 = await attachDamageImage('DAMAGE-TEST', file, 2);
    expect(assessImageIntegrity({ evidence: v3.evidence, tripScheduledAt: v3.trip.scheduledAt }).signals.some(s => s.code === 'duplicate_image')).toBe(true);
    const image = v2.evidence.find(e => e.kind === 'image')!;
    if (image.kind !== 'image') throw new Error('Missing image');
    const observation = await createFixtureVisionProvider().analyze(image);
    expect(observation.wearAndTear).toBeNull(); expect(observation.linkedToTrip).toBeNull();
    const receipt = await analyzeDamageImages('DAMAGE-TEST', 3);
    expect(await analyzeDamageImages('DAMAGE-TEST', 3)).toEqual(receipt);
    const run = await startRun('DAMAGE-TEST', 'fixture', { ...DEFAULT_CONFIG, provider: createFixtureProvider() }, 'damage-test-run');
    expect(run.state).toBe('escalated'); expect(run.resolution?.disposition).toBe('human_review');
    expect(run.resolution?.recommendedRefundCents).toBeNull(); expect(run.resolution?.requiresHumanReview).toBe(true);
    expect(run.integrityAssessment?.signals.some(s => s.code === 'duplicate_image')).toBe(true);
    await attachDamageImage('DAMAGE-TEST', file, 3);
    await attachDamageImage('DAMAGE-TEST', file, 4);
    await expect(attachDamageImage('DAMAGE-TEST', file, 5)).rejects.toThrow('four images');
  });
  it('validates live responses and forces unobservable trip linkage to unknown', async () => {
    vi.stubEnv('RYDR_VISION_MODE', 'live'); vi.stubEnv('RYDR_VISION_VERIFIED', 'true');
    vi.stubEnv('RYDR_VISION_ENDPOINT', 'https://vision.example.test/analyze'); vi.stubEnv('RYDR_VISION_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ description: 'A visible mark.', sufficiency: 'missing_context', wearAndTear: false, linkedToTrip: true, metadataPresent: false, metadataConsistent: true })));
    const item = { id: 'image', kind: 'image' as const, timestamp: null, source: { dataset: 'test', jsonPointer: '/0', provenance: 'synthetic' as const }, qualityIssues: [], payload: { assetUrl: '/image', mimeType: 'image/png', sizeBytes: 1, hash: 'hash', captureAt: null, metadata: {}, angles: [], sufficiency: 'missing_context' as const } };
    expect((await visionProvider()!.analyze(item, Buffer.from('test'))).linkedToTrip).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
