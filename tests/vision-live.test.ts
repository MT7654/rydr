import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {getCase} from '../src/repositories/cases';
import {withStorageSession} from '../src/repositories/store';
import {registerAdpImageSource} from '../src/repositories/visionSources';
import {visionProvider,VisionObservationSchema} from '../src/providers/vision';
import {createAdpProvider} from '../src/providers/adp';
import {IMAGE_ANALYST_PROMPT} from '../src/providers/vision';
it.skipIf(process.env.RYDR_RUN_VISION_LIVE_TEST !== 'true' || !process.env.RYDR_VISION_TEST_IMAGE_URL)('inspects a cloud test image through the published image agent',async()=>{
  const url=process.env.RYDR_VISION_TEST_IMAGE_URL!;
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Public example image unavailable (${response.status}); no model call made.`);
  const bytes=Buffer.from(await response.arrayBuffer());expect(bytes.length).toBeLessThan(5*1024*1024);const hash=createHash('sha256').update(bytes).digest('hex');
  await writeFile('D:/Rydr/tmp/vision-public-test.png',bytes);
  process.env.RYDR_VISION_MODE='live';process.env.RYDR_VISION_PROVIDER='adp';process.env.RYDR_VISION_VERIFIED='true';
  await withStorageSession(randomUUID(),async()=>{
    await registerAdpImageSource(hash,url);const item=(await getCase('SYN-015'))!.evidence.find(e=>e.kind==='image')!;if(item.kind!=='image')throw new Error('No image');
    item.payload.hash=hash;item.payload.metadata={};const started=Date.now();const observation=VisionObservationSchema.parse(await visionProvider()!.analyze(item));
    expect(observation.linkedToTrip).toBeNull();expect(observation.metadataConsistent).toBeNull();expect(observation.description).not.toMatch(/cannot (?:view|inspect|access)|unable to (?:view|inspect|access)/i);
    const report={generatedAt:new Date().toISOString(),mode:'live',provider:'adp-image-understanding',configuredModel:'User selected GPT-5.6 Luna in ADP; deployment model not independently introspected.',source:'Authorized cloud test image; not an adjudication.',imageHash:hash,latencyMs:Date.now()-started,observation};
    await mkdir(path.join(process.cwd(),'docs'),{recursive:true});await writeFile(path.join(process.cwd(),'docs','vision-live-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  });
},90000);
it.skipIf(process.env.RYDR_RUN_VISION_KEY_TEST !== 'true')('checks publication and structured output without claiming pixel verification',async()=>withStorageSession(randomUUID(),async()=>{
  const reply=await createAdpProvider(process.env.RYDR_ADP_ENDPOINT!).invoke({role:'vision',stage:'analyze_image',runId:randomUUID(),systemInstruction:IMAGE_ANALYST_PROMPT,input:{concern:'No image is attached in this configuration check. Describe the limitation. Do not invent visible content.',metadataPresent:false},allowedEvidenceIds:[],timeoutMs:45000,maxOutputTokens:1000});
  const observation=VisionObservationSchema.parse(reply.output);expect(observation.sufficiency).toBe('missing_context');expect(observation.linkedToTrip).toBeNull();
  const report={generatedAt:new Date().toISOString(),keyAndPublishedEndpointVerified:true,pixelInspectionVerified:false,observation};await mkdir(path.join(process.cwd(),'docs'),{recursive:true});await writeFile(path.join(process.cwd(),'docs','vision-key-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}),60000);
