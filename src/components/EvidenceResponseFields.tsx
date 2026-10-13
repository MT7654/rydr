'use client';
import { useState } from 'react';
import { GpsSamplePicker, type GpsSample } from './GpsSamplePicker';
export function EvidenceResponseFields({samples}: {samples: GpsSample[]}) {
 const [kind,setKind]=useState('statement');
 return <><label className="field"><span className="field__label">What are you supplying?</span><select name="responseKind" className="input" value={kind} onChange={event=>setKind(event.target.value)}><option value="statement">A written statement only</option>{samples.length ? <option value="gps_accuracy">A corrected GPS accuracy radius</option>:null}<option value="fare_ledger">Fare ledger lines for this trip</option></select></label>
 {kind==='statement' ? <p className="small response-hint">Your statement will be available to the reviewer. It does not replace GPS measurements or create a new evidence version.</p>:null}
 {kind==='gps_accuracy' ? <><GpsSamplePicker samples={samples}/><label className="field"><span className="field__label">Proposed accuracy radius (metres)</span><input name="accuracyMeters" type="number" className="input" min={0} step="any" required placeholder="e.g. 8"/></label></>:null}
 {kind==='fare_ledger' ? <fieldset className="ledger-response"><legend>Fare ledger lines</legend>{[1,2,3].map(index=><div className="row" key={index}><input name={`ledgerComponent${index}`} className="input" placeholder={`Component ${index} (e.g. base fare)`} required={index===1}/><input name={`ledgerAmount${index}`} className="input" inputMode="decimal" placeholder="SGD" required={index===1}/></div>)}</fieldset>:null}</>;
}
