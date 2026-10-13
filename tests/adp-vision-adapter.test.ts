import {it,expect,vi,afterEach} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {getCase} from '../src/repositories/cases';
import {registerAdpImageSource,resolveAdpImageSource,approvedAdpImageUrl} from '../src/repositories/visionSources';
import {visionProvider,visionMode} from '../src/providers/vision';
import {withStorageSession} from '../src/repositories/store';
import {storeImage} from '../src/repositories/imageAssets';
import {readFile} from 'node:fs/promises';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('inspects an authorized session upload and cannot read it from another session',async()=>{
  vi.stubEnv('RYDR_VISION_MODE','live');vi.stubEnv('RYDR_VISION_PROVIDER','adp');vi.stubEnv('RYDR_VISION_VERIFIED','true');vi.stubEnv('RYDR_ADP_ENDPOINT','https://example.test/adp');vi.stubEnv('RYDR_ADP_VISION_APPKEY','upload-agent');vi.stubEnv('ADP_SecretId','upload-id');vi.stubEnv('ADP_SecretKey','upload-secret');vi.stubEnv('RYDR_ADP_PUBLIC_IMAGE_UPLOADS_AUTHORIZED','true');
  const imageUrl='https://test.cos.ap-jakarta.myqcloud.com/upload.png';let uploaded:Uint8Array|undefined;
  const fetch=vi.fn(async(input:unknown,init?:RequestInit)=>{
    if(String(input).includes('tencentcloudapi.com')){
      const action=(init?.headers as Record<string,string>)['X-TC-Action'];
      return Response.json({Response:action==='DescribeRobotBizIDByAppKey'?{BotBizId:'67890'}:{UploadUrl:imageUrl,FileUrl:imageUrl,ExpiredTime:Math.floor(Date.now()/1000)+600}});
    }
    if(String(input)===imageUrl){if(init?.method==='PUT'){uploaded=init.body as Uint8Array;return new Response(null);}return new Response(uploaded?new Uint8Array(uploaded):null);}
    const body=JSON.parse(String(init?.body));expect(body.Contents).toContainEqual({Type:'image',Image:{Url:imageUrl}});
    const output={description:'A synthetic illustration; no real damage visible.',sufficiency:'missing_context',wearAndTear:null,linkedToTrip:null,metadataPresent:false,metadataConsistent:null};
    return new Response(`event: response.completed\ndata: ${JSON.stringify({Type:'response.completed',Response:{Status:'success',Messages:[{Type:'reply',Contents:[{Type:'text',Text:JSON.stringify(output)}]}]}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
  });vi.stubGlobal('fetch',fetch);
  const original=await readFile('public/damage-demo/seat-view-1.png');
  const image=await withStorageSession(randomUUID(),async()=>{
    const asset=await storeImage(original,'image/png');const item=(await getCase('SYN-015'))!.evidence.find(e=>e.kind==='image')!;if(item.kind!=='image')throw new Error('No image');item.payload={...item.payload,...asset};
    expect((await visionProvider()!.analyze(item)).description).toContain('synthetic');return item;
  });
  fetch.mockClear();
  await withStorageSession(randomUUID(),async()=>{await expect(visionProvider()!.analyze(image)).rejects.toThrow();});
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps uploaded photos out of public cloud storage until authorization is configured',async()=>{
  vi.stubEnv('RYDR_ADP_PUBLIC_IMAGE_UPLOADS_AUTHORIZED','false');
  vi.stubEnv('RYDR_VISION_MODE','live');vi.stubEnv('RYDR_VISION_PROVIDER','adp');vi.stubEnv('RYDR_VISION_VERIFIED','true');vi.stubEnv('RYDR_ADP_ENDPOINT','https://example.test/adp');vi.stubEnv('RYDR_ADP_VISION_APPKEY','mock-key');vi.stubEnv('ADP_SecretId','mock-id');vi.stubEnv('ADP_SecretKey','mock-secret');
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const image=(await getCase('SYN-015'))!.evidence.find(e=>e.kind==='image')!;if(image.kind!=='image')throw new Error('No image');
  image.payload.assetUrl=`/api/images/${image.payload.hash}`;
  await expect(visionProvider()!.analyze(image)).rejects.toThrow(/manually/);expect(fetch).not.toHaveBeenCalled();
});
it('keeps ADP vision inactive until key, live mode and verification are explicit',()=>{
  vi.stubEnv('RYDR_VISION_MODE','live');vi.stubEnv('RYDR_VISION_PROVIDER','adp');vi.stubEnv('RYDR_ADP_VISION_APPKEY','');vi.stubEnv('RYDR_VISION_VERIFIED','true');expect(visionMode()).toBe('blocked');
});
it('rejects localhost, redirects to arbitrary hosts and foreign image sources',()=>{
  expect(()=>approvedAdpImageUrl('http://127.0.0.1:3013/a.png')).toThrow();
  expect(()=>approvedAdpImageUrl('https://evil.test/a.png')).toThrow();
  expect(()=>approvedAdpImageUrl('https://user:secret@bucket.cos.ap-singapore.myqcloud.com/a')).toThrow();
});
it('verifies bytes before sending native ADP image content and leaves unobservable claims unknown',async()=>withStorageSession(randomUUID(),async()=>{
  const bytes=Buffer.from('Synthetic original bytes for mock transport.');const hash=createHash('sha256').update(bytes).digest('hex');const url='https://test.cos.ap-singapore.myqcloud.com/image.png';await registerAdpImageSource(hash,url);
  vi.stubEnv('RYDR_VISION_MODE','live');vi.stubEnv('RYDR_VISION_PROVIDER','adp');vi.stubEnv('RYDR_VISION_VERIFIED','true');vi.stubEnv('RYDR_ADP_VISION_APPKEY','mock-vision-key');vi.stubEnv('RYDR_ADP_ENDPOINT','https://example.test/adp');
  let body:Record<string,unknown>={};
  vi.stubGlobal('fetch',vi.fn(async(input:unknown,init?:RequestInit)=>{
    if(String(input)===url)return new Response(bytes);
    body=JSON.parse(String(init?.body));const output={description:'Visible residue on a seat; authorship unknown.',sufficiency:'missing_context',wearAndTear:null,linkedToTrip:true,metadataPresent:false,metadataConsistent:true};
    return new Response(`event: response.completed\ndata: ${JSON.stringify({Type:'response.completed',Response:{Status:'success',Messages:[{Type:'reply',Contents:[{Type:'text',Text:JSON.stringify(output)}]}]}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
  }));
  const image=(await getCase('SYN-015'))!.evidence.find(e=>e.kind==='image')!;if(image.kind!=='image')throw new Error('No image');image.payload.hash=hash;
  const result=await visionProvider()!.analyze(image);expect(result.linkedToTrip).toBeNull();expect(result.metadataConsistent).toBeNull();expect(body.AppKey).toBe('mock-vision-key');expect(body.Contents).toContainEqual({Type:'image',Image:{Url:url}});
}));
it('rejects a different cloud image before a model request',async()=>withStorageSession(randomUUID(),async()=>{
  const hash='a'.repeat(64);await registerAdpImageSource(hash,'https://test.cos.ap-singapore.myqcloud.com/a.png');const fetch=vi.fn(async()=>new Response('different bytes'));vi.stubGlobal('fetch',fetch);
  await expect(resolveAdpImageSource(hash)).rejects.toThrow(/differs/);expect(fetch).toHaveBeenCalledTimes(1);
}));
