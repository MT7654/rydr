'use client';
import { useEffect,useRef,useState } from 'react';
import { formatSgd } from '@/domain/money';
export function RefundAmountField({initial,maxCents,disposition}:{initial:number|null;maxCents:number;disposition:string|null}){
 const root=useRef<HTMLDivElement>(null);const [kind,setKind]=useState(disposition??'');
 useEffect(()=>{const form=root.current?.closest('form');if(!form)return;const update=()=>{const select=form.querySelector<HTMLSelectElement>('[name="disposition"]');setKind(select?.value??'');};form.addEventListener('change',update);update();return()=>form.removeEventListener('change',update);},[]);
 return <div ref={root} hidden={kind==='uphold'}><label className="field"><span className="field__label">Refund amount (SGD)</span><span className="small muted">Up to {formatSgd(maxCents)}. Leave blank for a full refund; partial refunds need an amount.</span><input type="text" name="targetRefund" defaultValue={initial==null?'':(initial/100).toFixed(2)} className="input" placeholder="e.g. 5.00" inputMode="decimal" disabled={kind==='uphold'} required={kind==='partial_refund'}/></label></div>;
}
