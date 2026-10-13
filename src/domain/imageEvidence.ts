import type { EvidenceItem } from './contracts';
import { evidenceOfKind } from './evidence';

/**
 * Image evidence integrity: bounded deterministic checks.
 *
 * A content hash detects file identity, not capture truth. Missing EXIF is not
 * fraud. EXIF is editable. These checks are support and counter-evidence for a
 * reviewer, not proof of guilt.
 */

export interface ImageDuplicateSignal {
  code: 'duplicate_image' | 'near_duplicate_image';
  evidenceIds: string[];
  explanation: string;
}

export interface MetadataSignal {
  code: 'missing_metadata' | 'mismatched_timestamp' | 'unlinked_image';
  evidenceIds: string[];
  explanation: string;
}

export interface SufficiencySignal {
  code: 'inadequate_angles' | 'missing_context' | 'wear_and_tear';
  evidenceIds: string[];
  explanation: string;
}

export interface ImageIntegrityReport {
  signals: (ImageDuplicateSignal | MetadataSignal | SufficiencySignal)[];
  overallSeverity: 'none' | 'low' | 'medium' | 'high';
}

function detectDuplicates(images: Extract<EvidenceItem, { kind: 'image' }>[]): ImageDuplicateSignal[] {
  const signals: ImageDuplicateSignal[] = [];
  const byHash = new Map<string, string[]>();
  for (const img of images) {
    const list = byHash.get(img.payload.hash) ?? [];
    list.push(img.id);
    byHash.set(img.payload.hash, list);
  }
  for (const [, ids] of byHash) {
    if (ids.length > 1) {
      signals.push({
        code: 'duplicate_image',
        evidenceIds: ids,
        explanation: `Identical content hash across ${ids.length} image(s). This may be the same file uploaded multiple times.`,
      });
    }
  }
  return signals;
}

function checkMetadata(
  images: Extract<EvidenceItem, { kind: 'image' }>[],
  tripScheduledAt: string | null,
): MetadataSignal[] {
  const signals: MetadataSignal[] = [];
  for (const img of images) {
    const ids = [img.id];
    if (Object.keys(img.payload.metadata).length === 0) {
      signals.push({
        code: 'missing_metadata',
        evidenceIds: ids,
        explanation: `${img.id} carries no readable metadata. Missing metadata is not proof of manipulation, but it limits what can be verified.`,
      });
    }
    if (img.payload.captureAt && tripScheduledAt) {
      const capture = Date.parse(img.payload.captureAt);
      const trip = Date.parse(tripScheduledAt);
      const windowMs = 24 * 60 * 60 * 1000;
      if (Math.abs(capture - trip) > windowMs) {
        signals.push({
          code: 'mismatched_timestamp',
          evidenceIds: ids,
          explanation: `${img.id} capture time (${img.payload.captureAt}) is outside the trip window. Timestamp metadata is editable and not proof of fraud.`,
        });
      }
    }
  }
  return signals;
}

function checkSufficiency(
  images: Extract<EvidenceItem, { kind: 'image' }>[],
): SufficiencySignal[] {
  const signals: SufficiencySignal[] = [];
  const inadequate = images.filter((i) => i.payload.sufficiency === 'inadequate_angles');
  if (inadequate.length > 0) {
    signals.push({
      code: 'inadequate_angles',
      evidenceIds: inadequate.map((i) => i.id),
      explanation: `${inadequate.length} image(s) lack the angles needed to assess the damage area.`,
    });
  }
  const missingContext = images.filter((i) => i.payload.sufficiency === 'missing_context');
  if (missingContext.length > 0) {
    signals.push({
      code: 'missing_context',
      evidenceIds: missingContext.map((i) => i.id),
      explanation: `${missingContext.length} image(s) do not show enough surrounding context to link the damage to this trip.`,
    });
  }
  return signals;
}

export function assessImageIntegrity(args: {
  evidence: EvidenceItem[];
  tripScheduledAt: string | null;
}): ImageIntegrityReport {
  const images = evidenceOfKind(args.evidence, 'image');
  if (images.length === 0) {
    return { signals: [], overallSeverity: 'none' };
  }

  const signals: ImageIntegrityReport['signals'] = [
    ...detectDuplicates(images),
    ...checkMetadata(images, args.tripScheduledAt),
    ...checkSufficiency(images),
  ];
  for (let i = 0; i < images.length; i++) for (let j = i + 1; j < images.length; j++) {
    const a = images[i], b = images[j];
    const fa = a.payload.metadata.visualFingerprint, fb = b.payload.metadata.visualFingerprint;
    if (a.payload.hash !== b.payload.hash && /^[01]{64}$/.test(fa ?? '') && /^[01]{64}$/.test(fb ?? '')) {
      const distance = [...fa].filter((bit, k) => bit !== fb[k]).length;
      if (distance <= 3) signals.push({ code: 'near_duplicate_image', evidenceIds: [a.id, b.id], explanation: 'A coarse visual fingerprint is similar. Simple or unrelated scenes can also match; inspect both images. This is not proof of reuse or manipulation.' });
    }
  }
  for (const image of images) {
    if (!image.payload.metadata.tripId) signals.push({ code: 'unlinked_image', evidenceIds: [image.id], explanation: 'No verified trip linkage is recorded. A submitted trip ID or visible damage alone cannot establish causation.' });
    if (image.payload.metadata.fixtureWear === 'true') signals.push({ code: 'wear_and_tear', evidenceIds: [image.id], explanation: 'This synthetic fixture is annotated as ordinary wear. No visual inference or liability determination was made.' });
  }

  let overallSeverity: ImageIntegrityReport['overallSeverity'] = 'none';
  for (const s of signals) {
    if (s.code === 'duplicate_image' || s.code === 'mismatched_timestamp') {
      overallSeverity = 'medium';
    } else if (overallSeverity === 'none') {
      overallSeverity = 'low';
    }
  }

  return { signals, overallSeverity };
}
