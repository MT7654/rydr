'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DemoRole } from '@/domain/demoAccess';
import type { EvidenceRequest } from '@/domain/contracts';
import { GpsSamplePicker, type GpsSample } from './GpsSamplePicker';
export function RepairSupport({ caseId, version, role, requests, gpsSamples }: { caseId:string;version:number;role:DemoRole;requests:EvidenceRequest[];gpsSamples:GpsSample[] }) {
  const router = useRouter(); const key = useRef(''); const [message,setMessage] = useState(''); const [busy,setBusy] = useState(false); const [kind,setKind] = useState('statement');
  async function submit(form:FormData) {
    setBusy(true);setMessage(''); key.current ||= crypto.randomUUID(); form.set('key',key.current);form.set('version',String(version));
    if (kind === 'gps_accuracy') form.set('structured',JSON.stringify({ kind, sampleIds:form.getAll('sampleIds'),accuracyMeters:Number(form.get('accuracy')),provenanceNote:'Party-proposed correction, not independently verified.' }));
    try { const response = await fetch(`/api/cases/${caseId}/repair`,{method:'POST',body:form});const data = await response.json();if(!response.ok)throw new Error(data.message);key.current='';setMessage('Supporting record submitted. A reviewer must verify it before a finding changes.');router.refresh(); }
    catch(error){setMessage(error instanceof Error?error.message:'Submission failed.');}finally{setBusy(false);}
  }
  return <section id="supporting-record" className="card stack"><h2>{role === 'reviewer' ? 'Verify supporting records' : 'Supply your own record'}</h2>
    {role !== 'reviewer' ? <form action={submit} className="stack"><p className="small">A document or statement is a claim until reviewed. Irrelevant records do not change the ruling.</p><label>Record type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="statement">Statement or supporting PDF</option>{gpsSamples.length ? <option value="gps_accuracy">Proposed GPS accuracy correction</option>:null}</select></label>
      {kind === 'gps_accuracy' ? <><GpsSamplePicker samples={gpsSamples}/><label>Proposed accuracy radius (metres)<input name="accuracy" type="number" min="0" step="any" required/></label></>:null}
      <label>What does this record show?<textarea name="note" rows={3} required minLength={10} maxLength={3000}/></label><label>Supporting PDF (optional, maximum 5 MB)<input type="file" name="document" accept="application/pdf"/></label><button className="btn btn--secondary" disabled={busy}>Submit for verification</button></form>:<p className="small">Open the verification task to check a structured correction against its source. Documents alone do not become authoritative telemetry.</p>}
    {message?<p role="status" className="notice">{message}</p>:null}
    <ul>{requests.map(r=><li key={r.id}><strong>{r.status === 'accepted' ? r.responseVerification?.status === 'verified' ? 'Verified correction' : 'Accepted as a claim' : r.status === 'submitted' ? 'Awaiting reviewer verification' : r.status.replaceAll('_',' ')}</strong><p className="small">{r.question}</p>{r.responseNote?<details><summary>Your submitted account</summary><p>{r.responseNote}</p></details>:null}{r.acceptedIntoCaseVersion?<p className="small">Accepted into case v{r.acceptedIntoCaseVersion}. Reassess that version below.</p>:null}{r.responseEvidenceIds.filter(id=>id.startsWith('attachment-')).map(id=><p key={id}><a href={`/api/cases/${caseId}/repair?attachment=${id}`}>Download supporting document</a></p>)}{role === 'reviewer'?<Link href={`/reviews/${r.taskId}`}>Open verification task →</Link>:null}</li>)}</ul>
  </section>;
}
