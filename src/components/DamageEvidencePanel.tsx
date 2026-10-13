'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseRecord } from '@/domain/contracts';
export function DamageEvidencePanel({ record, frozen, mode }: { record: CaseRecord; frozen: boolean; mode: 'fixture' | 'live' | 'blocked' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState<unknown>(null);
  useEffect(() => {
    if (frozen || record.category !== 'damage' || mode === 'blocked') return;
    let active = true;
    void fetch(`/api/cases/${encodeURIComponent(record.id)}/images?version=${record.version}`).then(r => r.json()).then(result => { if (active) setAnalysis(result.receipt ?? null); }).catch(() => {});
    return () => { active = false; };
  }, [record.id, record.version, record.category, frozen, mode]);
  if (record.category !== 'damage') return null;
  const images = record.evidence.filter(e => e.kind === 'image');
  const observations = analysis && typeof analysis === 'object' && 'observations' in analysis && Array.isArray(analysis.observations) ? analysis.observations as { evidenceId: string; observation: { description: string; sufficiency: string } }[] : [];
  async function submit(data: FormData) {
    setBusy(true); setMessage(''); data.set('version', String(record.version));
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(record.id)}/images`, { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (data.get('action') === 'analyze') setAnalysis(result);
      else if(data.get('action') === 'link_adp_image')setMessage('Cloud image linked. Its bytes will be checked before analysis; no case version or pixel result was created.');
      else { setAnalysis(null); setMessage('Image recorded in a new case version. Start a new review to consider it.'); router.refresh(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Image operation failed.'); }
    finally { setBusy(false); }
  }
  return <section className="case-section">
    <div className="section-label">Damage evidence / human approval required</div>
    <h2 className="section-title">Inspect the damage packet</h2>
    <p><strong>{mode === 'fixture' ? 'Sample image assessment' : mode === 'live' ? 'Live image assessment' : 'Image assessment unavailable'}</strong> · A reviewer approves all damage decisions.</p>
    <p>Images can show visible conditions. They cannot establish who caused damage or when it happened. Hashes identify files; metadata is editable. Supported uploads: JPEG, PNG or WebP, up to 5 MB each and four images per case.</p>
    {images.map(image => <figure key={image.id}>
      <img src={image.payload.assetUrl} alt={`Submitted damage evidence ${image.id}`} style={{ maxWidth: '100%', width: 360 }} />
      <figcaption><details><summary>Photo source details</summary>{image.id} · {image.payload.sizeBytes} bytes · capture time {image.payload.captureAt ?? 'unknown'}<br /><code style={{ overflowWrap: 'anywhere' }}>{image.payload.hash}</code></details></figcaption>
    </figure>)}
    {!frozen && <>
      <form action={submit}><label>Add supporting image <input name="image" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy || images.length >= 4} /></label><button disabled={busy || images.length >= 4}>Record image</button></form>
      {mode !== 'live' && <details><summary>Link an ADP-uploaded image</summary><p className="small">Upload the same original image to ADP/COS, then paste its Tencent image URL. Rydr checks that the bytes match the case hash before a paid model call. No image is published by this action.</p><form action={submit} className="stack"><input type="hidden" name="action" value="link_adp_image"/><label>Case image<select name="imageId">{images.map(e=><option key={e.id} value={e.id}>{e.id}</option>)}</select></label><label>Tencent image URL<input name="url" type="url" required/></label><button disabled={busy || !images.length}>Link cloud image</button></form></details>}
      <button disabled={busy || !images.length || mode === 'blocked'} onClick={() => { const data = new FormData(); data.set('action', 'analyze'); void submit(data); }}>{busy ? 'Uploading and inspecting images…' : 'Inspect images'}</button>
      {analysis && typeof analysis === 'object' && 'status' in analysis && analysis.status === 'failed' ? <button disabled={busy || mode === 'blocked'} onClick={()=>{const data=new FormData();data.set('action','analyze');data.set('retry','true');void submit(data);}}>Retry failed image analysis once</button>:null}
      <p>{mode === 'live' ? 'Inspect images sends metadata-stripped copies to Tencent’s publicly accessible image storage for AI analysis. Originals stay in the case record. Results are saved for this case version; refreshing does not repeat AI calls.' : 'Sample mode provides scripted annotations. A reviewer must inspect the original images.'}</p>
    </>}
    {message && <p role="status">{message}</p>}
    {observations.map(entry => <article key={entry.evidenceId} className="surface"><h3>Visible observations</h3><p>{entry.observation.description}</p><p className="small">Visual coverage: {entry.observation.sufficiency.replaceAll('_', ' ')}. Trip linkage and responsibility remain unverified.</p></article>)}
    {analysis != null && <details className="audit-disclosure"><summary>Image analysis receipt & audit</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(analysis, null, 2)}</pre></details>}
  </section>;
}

