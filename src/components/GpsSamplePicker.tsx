import type { EvidenceItem } from '@/domain/contracts';
import { Cite } from './Cite';
export type GpsSample = Extract<EvidenceItem, {kind: 'gps'}>;
/** Selecting a record and inspecting its source are separate controls. */
export function GpsSamplePicker({samples}: {samples: GpsSample[]}) {
  return <fieldset className="gps-picker"><legend>Choose the GPS records to correct</legend><p className="small muted">Inspect a record before selecting it. A proposed radius stays a claim until a reviewer verifies its source.</p><div className="gps-picker__list">{samples.map(sample => {
    const time = sample.timestamp ? new Date(sample.timestamp).toLocaleTimeString('en-SG', {timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : 'Time unavailable';
    const accuracy = sample.payload.accuracyMeters === null ? 'Accuracy not reported' : `Accuracy ±${sample.payload.accuracyMeters} m`;
    return <div className="gps-picker__record" key={sample.id}><label><input type="checkbox" name="sampleIds" value={sample.id}/><span><strong>{time} SGT · {sample.payload.status.replaceAll('_',' ')}</strong><span>{accuracy} · {sample.payload.speedKmh === null ? 'Speed not reported' : `${sample.payload.speedKmh} km/h`}</span><span className="gps-picker__id">{sample.id}</span></span></label><Cite id={sample.id} kind="evidence">Inspect record</Cite></div>;
  })}</div></fieldset>;
}
