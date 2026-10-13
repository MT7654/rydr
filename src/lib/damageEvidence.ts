import { randomUUID } from 'node:crypto';
import { appendCaseVersion, getCase } from '@/repositories/cases';
import { storeImage, readImage, MAX_IMAGE_BYTES } from '@/repositories/imageAssets';
import { visionProvider } from '@/providers/vision';
import { RUNTIME_DIR, readJson, writeJsonAtomic, withLock } from '@/repositories/store';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { IMAGE_ANALYST_PROMPT } from '@/providers/vision';

export async function attachDamageImage(caseId: string, file: File, expectedVersion: number) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Maximum image size is 5 MB.');
  const record = await getCase(caseId);
  if (!record || record.category !== 'damage') throw new Error('A damage case is required.');
  if (record.evidence.filter(e => e.kind === 'image').length >= 4) throw new Error('At most four images per damage packet.');
  const asset = await storeImage(Buffer.from(await file.arrayBuffer()), file.type);
  const id = `IMG-${randomUUID()}`;
  return appendCaseVersion(caseId, current => {
    if (current.version !== expectedVersion) throw new Error('Case changed. Refresh before adding an image.');
    if (current.evidence.filter(e => e.kind === 'image').length >= 4) throw new Error('Four-image limit reached.');
    return { ...current, evidence: [...current.evidence, {
      id, kind: 'image', timestamp: new Date().toISOString(),
      source: { dataset: `upload:${caseId}`, jsonPointer: `/evidence/${current.evidence.length}`, provenance: 'synthetic' },
      qualityIssues: ['User-submitted demo image. Capture time, trip linkage and causation are unverified.'],
      payload: { ...asset, captureAt: null, angles: [], sufficiency: 'missing_context' },
    }] };
  }, `Added image ${id}; SHA-256 ${asset.hash}.`);
}
export function visionReceiptFile(caseId: string, version: number, mode: string) {
  const fingerprint=createHash('sha256').update(JSON.stringify([IMAGE_ANALYST_PROMPT,visionProvider()?.id,process.env.RYDR_VISION_MODEL,process.env.RYDR_ADP_VISION_APPKEY,process.env.RYDR_ADP_PUBLIC_IMAGE_UPLOADS_AUTHORIZED])).digest('hex').slice(0,12);
  return path.join(RUNTIME_DIR, 'vision', `${caseId.replace(/[^a-zA-Z0-9_-]/g, '_')}-v${version}-${mode}-${fingerprint}.json`);
}
/** Bounded explicit requests, cached per version/mode. No retries or fallback. */
export async function analyzeDamageImages(caseId: string, expectedVersion: number, retry = false) {
  const record = await getCase(caseId);
  if (!record || record.category !== 'damage' || record.version !== expectedVersion) throw new Error('Refresh the current damage case before analysis.');
  const provider = visionProvider();
  if (!provider) throw new Error('Vision blocked: no verified image-capable service configured.');
  const images = record.evidence.filter(e => e.kind === 'image');
  if (!images.length || images.length > 4) throw new Error('Analysis requires one to four images.');
  const file = visionReceiptFile(caseId, record.version, provider.mode);
  return withLock(`vision:${file}`, async () => {
    const existing = await readJson<{status:string;attempt?:number;startedAt:string}>(file);
    if (existing && (!retry || existing.status === 'completed')) return existing;
    if(existing && retry && (existing.attempt ?? 1)>=2)throw new Error('Two image-analysis attempts already recorded. Review the images manually.');
    if(existing?.status === 'started' && Date.now()-Date.parse(existing.startedAt)<10*60*1000)throw new Error('Image analysis is still in progress.');
    const receipt = { caseId, caseVersion: record.version, mode: provider.mode, providerId: provider.id, attempt:(existing?.attempt ?? 0)+1, model: provider.mode === 'live' ? process.env.RYDR_VISION_MODEL ?? 'agent-configured' : 'scripted', promptVersion: 'vision-v2', startedAt: new Date().toISOString(), status: 'started', observations: [] as unknown[] };
    // Persist before calling: a refresh cannot repeat a paid failed attempt.
    await writeJsonAtomic(file, receipt);
    try {
      for (const image of images) {
        const bytes = provider.mode === 'live' && provider.id !== 'adp-image-understanding' ? await readImage(image.payload.hash, true) : undefined;
        receipt.observations.push({ evidenceId: image.id, hash: image.payload.hash, observation: await provider.analyze(image, bytes) });
      }
      receipt.status = 'completed';
    } catch {
      receipt.status = 'failed'; await writeJsonAtomic(file, receipt);
      throw new Error('Image analysis failed. Attempt recorded; no automatic retry or fixture fallback.');
    }
    await writeJsonAtomic(file, receipt);
    return receipt;
  });
}
