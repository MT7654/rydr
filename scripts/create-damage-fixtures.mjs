import sharp from 'sharp';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
await fs.mkdir('public/damage-demo', { recursive: true });
const base = JSON.parse(await fs.readFile('fixtures/cases/SYN-009.json', 'utf8'));
base.evidence = base.evidence.slice(0, 1);
for (const [index, view] of ['Context view', 'Close-up view', 'Side view'].entries()) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#ede9e0"/><text x="28" y="40" font-family="sans-serif" font-size="22">SYNTHETIC ILLUSTRATION - ${view}</text><rect x="${190-index*20}" y="85" width="240" height="245" rx="36" fill="#667f7b"/><path d="M210 210 Q300 ${140+index*30} 390 215" stroke="#e4bc71" stroke-width="9" fill="none"/><text x="28" y="374" font-family="sans-serif" font-size="18">Demonstration mark; no photograph or causation claim.</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const name = `seat-view-${index+1}.png`;
  await fs.writeFile(`public/damage-demo/${name}`, bytes);
  base.evidence.push({ id: `SYN009-IMG-0${index+1}`, kind: 'image', timestamp: base.trip.scheduledAt,
    source: { dataset: 'fixtures/cases/SYN-009.json', jsonPointer: `/evidence/${index+1}`, provenance: 'synthetic' },
    qualityIssues: ['Synthetic illustration. Submitted linkage and timestamps do not establish capture truth or causation.'],
    payload: { assetUrl: `/damage-demo/${name}`, mimeType: 'image/png', sizeBytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex'), captureAt: base.trip.scheduledAt,
      metadata: { tripId: base.trip.id, fixtureDescription: `${view}: drawn seat with a demonstration mark. Before/after comparison and responsibility remain unknown.` }, angles: [view], sufficiency: 'missing_context' } });
}
await fs.writeFile('fixtures/cases/SYN-009.json', JSON.stringify(base, null, 2)+'\n');
const reused = structuredClone(base);
reused.id = 'SYN-010'; reused.trip.id = 'TRIP-SYN-010';
reused.riderStatement = 'The supplied image shows ordinary wear and has been reused. I dispute responsibility.';
reused.driverStatement = 'Please review the image and the trip linkage before deciding the fee.';
reused.evidence = [base.evidence[0], base.evidence[1], structuredClone(base.evidence[1])].map((e, index) => ({ ...e, id: `SYN010-${index}`, source: { dataset: 'fixtures/cases/SYN-010.json', jsonPointer: `/evidence/${index}`, provenance: 'synthetic' } }));
for (const item of reused.evidence) if (item.kind === 'image') {
  item.payload.captureAt = '2026-09-01T12:00:00+08:00'; item.payload.metadata = { fixtureWear: 'true', fixtureDescription: 'Scripted ordinary-wear example; duplicate image with inconsistent capture time.' }; item.payload.angles = []; item.payload.sufficiency = 'inadequate_angles';
}
reused.changeLog = ['Synthetic reused-image, timestamp-conflict, ordinary-wear and inadequate-angle demonstration.'];
await fs.writeFile('fixtures/cases/SYN-010.json', JSON.stringify(reused, null, 2)+'\n');
