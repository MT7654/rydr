import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { withStorageSession } from '../src/repositories/store';
import { analyzeDamageImages } from '../src/lib/damageEvidence';
it.skipIf(process.env.RYDR_RUN_VISION_UPLOAD_LIVE_TEST !== 'true')('uploads and inspects the complete synthetic packet through ADP', async () => {
  process.env.RYDR_VISION_MODE='live'; process.env.RYDR_VISION_PROVIDER='adp'; process.env.RYDR_VISION_VERIFIED='true';
  await withStorageSession(randomUUID(), async () => {
    const receipt = await analyzeDamageImages('SYN-015', 1);
    expect(receipt.status).toBe('completed');
    const result = receipt as unknown as { observations: { observation: { description: string; linkedToTrip: unknown; metadataConsistent: unknown } }[] };
    expect(result.observations).toHaveLength(3);
    for(const entry of result.observations) {
      expect(entry.observation.linkedToTrip).toBeNull(); expect(entry.observation.metadataConsistent).toBeNull();
      expect(entry.observation.description).not.toMatch(/cannot (view|inspect|access)|unable to (view|inspect|access)/i);
    }
    await writeFile('docs/vision-upload-live-report.json', JSON.stringify({ generatedAt:new Date().toISOString(), transport:'Automatic ADP credentials and verified PNG derivative upload', receipt }, null, 2));
    console.log(JSON.stringify({status:receipt.status,images:result.observations.length}));
  });
},180000);
