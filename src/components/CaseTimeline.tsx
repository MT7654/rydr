'use client';
import { useState } from 'react';
import type { EvidenceItem } from '@/domain/contracts';
import { Cite } from './Cite';

const labels: Record<string,string> = { gps:'Location', chat:'Message', call:'Call', trip_event:'Trip event', payment:'Payment', route:'Route', fare:'Fare comparison', history:'Account history', image:'Photo' };
function description(item: EvidenceItem): string {
  switch(item.kind) {
    case 'gps': return `${item.payload.status?.replace(/_/g,' ') ?? 'Location sample'} · accuracy ${item.payload.accuracyMeters == null ? 'unknown' : `±${item.payload.accuracyMeters} m`}`;
    case 'chat': return item.payload.content;
    case 'call': return `${item.payload.direction} call · ${item.payload.answered === true ? 'answered' : item.payload.answered === false ? 'unanswered' : 'answer status unknown'}`;
    case 'trip_event': return item.payload.details;
    case 'payment': return `${item.payload.component.replace(/_/g,' ')} · SGD ${(item.payload.amountCents/100).toFixed(2)}`;
    case 'route': return `Planned ${item.payload.plannedDistanceM ?? 'unknown'} m · travelled ${item.payload.actualDistanceM ?? 'unknown'} m`;
    case 'fare': return `Quote S$${(item.payload.quotedCents/100).toFixed(2)} → charged S$${(item.payload.chargedCents/100).toFixed(2)} · surge ${item.payload.quoteMultiplier}× → ${item.payload.startMultiplier}×`;
    case 'image': return 'Photo supplied for the damage assessment';
    case 'history': return 'Context record; past behaviour does not prove this incident';
  }
}

export function CaseTimeline({ items }: { items: EvidenceItem[] }) {
  const [filter,setFilter] = useState('all');
  const [selectedMinute,setSelectedMinute] = useState<string|null>(null);
  const shown=items.filter(i => filter === 'all' || (filter === 'contact' ? ['chat','call'].includes(i.kind) : filter === 'events' ? ['trip_event','payment'].includes(i.kind) : i.kind === 'gps' || i.kind === 'route'));
  const groups = new Map<string,EvidenceItem[]>();
  for(const item of shown.filter(item=>item.timestamp).sort((a,b)=>Date.parse(a.timestamp!)-Date.parse(b.timestamp!))) {
    const key=new Date(item.timestamp!).toISOString().slice(0,16);groups.set(key,[...(groups.get(key)??[]),item]);
  }
  const selected=selectedMinute ? groups.get(selectedMinute) : null;
  return <div className="timeline-view">
    {groups.size>0 ? <section className="ride-chronology" aria-label="Chronology overview"><p className="small muted">Select a moment to inspect its records.</p><div className="chronology-scroll"><div className="chronology-axis">{Array.from(groups).map(([key,records])=><button type="button" key={key} className="chronology-point" aria-pressed={key===selectedMinute} aria-label={`${new Date(records[0]!.timestamp!).toLocaleString('en-SG',{timeZone:'Asia/Singapore'})}: ${records.length} records`} onClick={()=>setSelectedMinute(key)}>{new Date(records[0]!.timestamp!).toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Singapore'})}<span>{records.length}</span><small>records</small></button>)}</div></div><p className="small muted">Chronological order · spacing does not represent elapsed time.</p>{selected?<div className="chronology-selected">{selected.map(item=><article key={item.id}><span className="fact-kind">{labels[item.kind]}</span><p>{description(item)}</p><Cite kind="evidence" id={item.id}>Inspect original source</Cite></article>)}</div>:null}</section>:null}

    <div className="timeline-toolbar"><div className="filters" role="group" aria-label="Timeline filter">
      {[['all','All events'],['events','Trip & payment'],['contact','Messages & calls'],['location','Location']].map(([key,label]) => <button className="filter" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
    </div><span className="small muted">{shown.length} events · Singapore time</span></div>
    <div className="timeline-scroll" tabIndex={0} role="region" aria-label="Ride evidence timeline">
      {shown.length === 0 ? <p className="small muted">No events in this category.</p> : <ol className="timeline-list">{shown.map((item,index) => <li key={item.id}>
        <details className="timeline-event"><summary><time>{item.timestamp ? new Date(item.timestamp).toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Singapore'}) : '—'}</time><span><span className="timeline-kind">{labels[item.kind]}</span><span className="timeline-preview">{description(item)}</span></span><span aria-hidden="true">＋</span></summary>
          <div className="timeline-event__body"><p>{description(item)}</p>{item.qualityIssues.length > 0 ? <p className="notice">{item.qualityIssues.join(' · ')}</p> : null}<Cite kind="evidence" id={item.id}>View source {index+1}</Cite><span className="small muted"> · {item.timestamp ? new Date(item.timestamp).toLocaleDateString('en-SG',{timeZone:'Asia/Singapore'}) : 'Time not recorded'}</span></div>
        </details>
      </li>)}</ol>}
    </div>
    <p className="small muted timeline-hint">Scroll inside the timeline. Expand an event to inspect its source.</p>
  </div>;
}

