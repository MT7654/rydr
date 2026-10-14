import fs from 'node:fs';import cp from 'node:child_process';import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';import nextEnv from '@next/env';import sharp from 'sharp';
nextEnv.loadEnvConfig(process.cwd());
fs.mkdirSync('.verify',{recursive:true});
const namespace='http-verification-'+Date.now().toString(36),session=randomUUID();
const cookie=`rydr-demo-session=${session}; rydr-demo-role=reviewer`;
const env={...process.env,RYDR_STORAGE_BACKEND:'neon',RYDR_STORAGE_NAMESPACE:namespace,RYDR_AGENT_MODE:'fixture',RYDR_VISION_MODE:'fixture',RYDR_MAX_PROVIDER_CALLS_PER_DAY:'0',RYDR_BUILD_DIR:'.next-production'};
const children=[],ports=[3015,3016],results=[];
const record=(name,details)=>{results.push({name,status:'passed',...details});console.log('PASS '+name+' '+JSON.stringify(details));};
async function call(port,path,options={}) {
 const response=await fetch(`http://localhost:${port}${path}`,{...options,headers:{Cookie:cookie,...options.headers},signal:AbortSignal.timeout(180000)});
 return response;
}
async function ready(port){for(let i=0;i<90;i++){try{const r=await fetch(`http://localhost:${port}/api/health`,{signal:AbortSignal.timeout(2000)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw new Error('Server startup timed out');}
try {
 for(const port of ports){
  const log=fs.openSync(`.verify/neon-server-${port}.log`,'w');
  const child=cp.spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port',String(port)],{env,stdio:['ignore',log,log]});children.push(child);fs.closeSync(log);
 }
 await Promise.all(ports.map(ready));
 const health=await (await call(3015,'/api/health')).json();assert.equal(health.storage.records,'neon');assert.equal(health.storage.uploads,'neon-private-bucket');record('production servers use Neon records and private uploads',{ports});
 for(const [id,expected,cents] of [['SYN-001','refund',500],['SYN-005','uphold',0]]) {
  const key=randomUUID(),body=JSON.stringify({mode:'fixture',idempotencyKey:key});
  const started=Date.now();
  const starts=await Promise.all(ports.map(port=>call(port,`/api/cases/${id}/runs`,{method:'POST',headers:{'Content-Type':'application/json'},body})));
  assert(starts.every(r=>r.status===201),'Run start should return 201');
  const runs=await Promise.all(starts.map(r=>r.json()));assert.equal(runs[0].run.id,runs[1].run.id,'Cross-instance duplicate starts must share one run');
  const runId=runs[0].run.id;
  let run;
  for(let i=0;i<240;i++){
   const r=await call(3016,`/api/runs/${runId}`);assert.equal(r.status,200);run=(await r.json()).run;
   if(['completed','failed','escalated'].includes(run.state))break;
   await new Promise(r=>setTimeout(r,500));
  }
  assert.equal(run.state,'completed');assert.equal(run.mode,'fixture');assert.equal(run.resolution.disposition,expected);assert.equal(run.resolution.recommendedRefundCents,cents);
  const html=await call(3016,`/cases/${id}?section=outcome&mode=fixture`);assert.equal(html.status,200);assert((await html.text()).includes('Posted to test ledger'));
  record('cross-instance '+id+' automatic outcome',{runId,disposition:expected,refundCents:cents,elapsedMs:Date.now()-started,provider:'fixture (no paid AI calls)'});
 }
 const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#cf385f'}}).png().toBuffer();
 const form=new FormData();form.set('version','1');form.set('image',new Blob([bytes],{type:'image/png'}),'synthetic-storage-check.png');
 const response=await call(3015,'/api/cases/SYN-015/images',{method:'POST',body:form});assert.equal(response.status,200);
 const uploaded=await response.json();assert.equal(uploaded.version,2);
 const hash=createHash('sha256').update(bytes).digest('hex');assert(uploaded.evidence.some(item=>item.kind==='image'&&item.payload.hash===hash));
 const image=await call(3016,`/api/images/${hash}`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
 assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width,32);
 const packet=await (await call(3016,'/api/cases/SYN-015')).json();assert.equal(packet.case.version,2);
 record('image upload and immutable version survive across processes',{caseId:'SYN-015',version:2,hash});
 const otherCookie=`rydr-demo-session=${randomUUID()}; rydr-demo-role=reviewer`;
 assert.equal((await call(3016,`/api/images/${hash}`,{headers:{Cookie:otherCookie}})).status,404);
 const otherPacket=await (await call(3016,'/api/cases/SYN-015',{headers:{Cookie:otherCookie}})).json();assert.equal(otherPacket.case.version,1);
 record('other visitors cannot read the uploaded image or case mutation',{imageStatus:404,otherCaseVersion:1});
 const report={status:'passed',namespace,generatedAt:new Date().toISOString(),databaseBranch:process.env.NEON_BRANCH,results,limitations:'Actual Neon production-branch services through two local production app instances. Scripted AI provider; no Vercel deployment or live ADP availability test. Isolated verification namespace, no existing user records changed.'};
 fs.writeFileSync('.verify/neon-http-report.json',JSON.stringify(report,null,2));console.log('NEON HTTP E2E PASSED');
} catch(error) { console.error('HTTP E2E FAILED: '+error.message);process.exitCode=1; }
finally {for(const child of children)child.kill('SIGTERM');}
