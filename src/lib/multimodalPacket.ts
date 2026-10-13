import { readJson } from '@/repositories/store';
import { visionReceiptFile } from './damageEvidence';
import type { CatalogEntry } from '@/agents/evidenceService';
interface Receipt { status:string;mode:string;observations:{evidenceId:string;observation:{description:string;sufficiency:string};checks?:{credential:string;origin:string;timeMatch:string}}[]; }
export async function enrichImageCatalog(caseId:string,version:number,catalog:CatalogEntry[]):Promise<CatalogEntry[]>{
 const live=await readJson<Receipt>(visionReceiptFile(caseId,version,'live'));
 const sample=await readJson<Receipt>(visionReceiptFile(caseId,version,'fixture'));
 const receipt=live?.status==='completed'?live:sample?.status==='completed'?sample:null;
 if(!receipt)return catalog;
 return catalog.map(item=>{const entry=receipt.observations.find(o=>o.evidenceId===item.id);return entry?{...item,summary:item.summary+' '+(receipt.mode==='live'?'Live pixel observation: ':'Scripted observation: ')+entry.observation.description+' Visual coverage: '+entry.observation.sufficiency+'. Provenance: '+(entry.checks?JSON.stringify(entry.checks):'not inspected')+'. These observations do not establish authenticity or responsibility.'}:item;});
}
