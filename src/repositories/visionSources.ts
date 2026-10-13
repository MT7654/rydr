import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJson,writeJsonAtomic,RUNTIME_DIR,withLock } from './store';
export function approvedAdpImageUrl(value:string) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.port || !(url.hostname.endsWith('.myqcloud.com') || url.hostname.endsWith('.tencentcos.cn'))) throw new Error('Use an HTTPS Tencent ADP/COS image link. Localhost and arbitrary hosts are unavailable.');
  return url.toString();
}
const sourceFile=path.join(RUNTIME_DIR,'vision','adp-image-sources.json');
export async function registerAdpImageSource(hash:string,url:string) {
  if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid image hash.');
  const approved=approvedAdpImageUrl(url);
  return withLock('adp-image-sources',async()=>{const sources=await readJson<Record<string,string>>(sourceFile) ?? {};sources[hash]=approved;await writeJsonAtomic(sourceFile,sources);});
}
export async function resolveAdpImageSource(hash:string) {
  const url=(await readJson<Record<string,string>>(sourceFile))?.[hash];
  if(!url)throw new Error('Upload the original image through ADP/COS, then link its Tencent URL to this image.');
  const response=await fetch(approvedAdpImageUrl(url),{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok || !response.body)throw new Error('Linked image is unavailable or expired.');
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024*1024)throw new Error('Linked image exceeds 5 MB.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks);
  if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Linked cloud image differs from the original case image.');
  return url;
}
