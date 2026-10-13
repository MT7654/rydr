import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {withStorageSession} from '../src/repositories/store';
import {submitRemedy,actOnRemedy} from '../src/repositories/journeys';
import {GET} from '../src/app/api/journeys/route';
const actor=vi.hoisted(()=>({role:'driver' as string|null}));
vi.mock('../src/lib/demoSession',()=>({getDemoRole:async()=>actor.role}));
it('returns an attachment receipt containing only the selected party account',async()=>withStorageSession(randomUUID(),async()=>{
  actor.role='driver';
  let remedy=await submitRemedy('driver',{caseId:'SYN-015',version:1,kind:'cleaning',amountCents:2500,note:'Synthetic receipt and trip linkage for receipt export.',evidenceIds:['SYN015-IMG-01','SYN015-RECEIPT']});
  remedy=await actOnRemedy('reviewer',remedy.id,remedy.revision,{action:'approve',verified:true,tier:'food',note:'Synthetic source receipt, timing and trip linkage verified for test.'});
  remedy=await actOnRemedy('reviewer',remedy.id,remedy.revision,{action:'post'});
  const response=await GET(new Request(`http://localhost/api/journeys?receipt=${remedy.id}`));
  expect(response.headers.get('Content-Disposition')).toContain('attachment;');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const data=await response.json();expect(data.netCreditCents).toBe(2500);expect(data.recovery).toBe('pending');expect(data.authorizationNote).toBeUndefined();expect(data.entries.every((e:{account:string})=>e.account==='driver')).toBe(true);
  const bundle=await GET(new Request('http://localhost/api/journeys?export=journeys'));const exported=await bundle.json();expect(exported.receipts[0]).toEqual(data);expect(exported.execution).toBe('test_ledger');
}));
it('rejects export without a role and does not resolve another visitor receipt',async()=>withStorageSession(randomUUID(),async()=>{
  actor.role=null;expect((await GET(new Request('http://localhost/api/journeys?export=journeys'))).status).toBe(403);
  actor.role='rider';expect((await GET(new Request('http://localhost/api/journeys?receipt=unknown'))).status).toBe(404);
}));
