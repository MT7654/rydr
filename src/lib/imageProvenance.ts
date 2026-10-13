import { Reader, Context } from '@contentauth/c2pa-node';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const parseExif = require('exif-reader') as (bytes: Buffer) => { Photo?: Record<string, unknown>; Image?: Record<string, unknown> };
export interface PhotoChecks {
 credential: 'absent' | 'valid_untrusted' | 'trusted' | 'invalid' | 'unavailable';
 origin: 'declared_ai' | 'declared_capture' | 'unknown';
 captureAt: string | null; timeMatch: 'consistent' | 'outside_window' | 'unknown';
 generator: string | null; validationCodes: string[]; limits: string[];
}
export function interpretManifest(store: unknown): Pick<PhotoChecks,'credential'|'origin'|'generator'|'validationCodes'> {
 const data = store as {active_manifest?: string; manifests?:Record<string,{claim_generator?:string;assertions?:unknown[]}>;validation_state?:string;validation_status?:{code:string}[]};
 const manifest = data.manifests?.[data.active_manifest ?? ''];
 const state=data.validation_state;
 const credential = state==='Trusted'?'trusted':state==='Valid'?'valid_untrusted':'invalid';
 const assertions=JSON.stringify(manifest?.assertions??[]);
 const origin = /trainedAlgorithmicMedia|composit(?:e|ed|With).*TrainedAlgorithmicMedia/i.test(assertions)?'declared_ai':/digitalsourcetype\/(?:digital|computational)Capture/.test(assertions)?'declared_capture':'unknown';
 return {credential,origin,generator:manifest?.claim_generator?.slice(0,120)??null,validationCodes:(data.validation_status??[]).map(v=>v.code).slice(0,20)};
}
export function compareCaptureTime(captureAt:string|null,tripAt:string|null): PhotoChecks['timeMatch'] {
 if(!captureAt||!tripAt||!Number.isFinite(Date.parse(captureAt))||!Number.isFinite(Date.parse(tripAt)))return 'unknown';
 return Math.abs(Date.parse(captureAt)-Date.parse(tripAt))<=24*3600000?'consistent':'outside_window';
}
export async function inspectPhotoProvenance(bytes:Buffer,mimeType:string,tripAt:string|null):Promise<PhotoChecks>{
 let captureAt:string|null=null;
 const meta=await sharp(bytes,{limitInputPixels:20000000}).metadata();
 if(meta.exif)try{const exif=parseExif(meta.exif);const raw=exif.Photo?.DateTimeOriginal;const offset=exif.Photo?.OffsetTimeOriginal;
   // EXIF dates without an explicit offset are not trusted as a UTC timestamp.
   if(raw instanceof Date && typeof offset==='string' && /^[+-]\d{2}:\d{2}$/.test(offset))captureAt=new Date(Date.parse(raw.toISOString().slice(0,19)+offset)).toISOString();
 }catch{/* Broken metadata remains unknown. */}
 let check:Pick<PhotoChecks,'credential'|'origin'|'generator'|'validationCodes'>={credential:'absent',origin:'unknown',generator:null,validationCodes:[]};
 try{
   // Never follow embedded URLs or fetch revocation/trust material from an upload.
   const reader=await Reader.fromAsset({buffer:bytes,mimeType},new Context({verify:{verifyTrust:true,remoteManifestFetch:false,ocspFetch:false},trust:{trustAnchors:await readFile(path.join(process.cwd(),'fixtures/provenance/trust-anchors.pem'),'utf8')}}));
   if(reader)check=interpretManifest(reader.json());
 }catch{check={...check,credential:'unavailable'};}
 return {...check,captureAt,timeMatch:compareCaptureTime(captureAt,tripAt),limits:['Credentials attest provenance, not the truth of the depicted event.','Missing credentials cannot distinguish camera photos from AI images.','EXIF is editable; time consistency does not prove trip linkage.']};
}
