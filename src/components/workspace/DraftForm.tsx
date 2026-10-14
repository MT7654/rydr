'use client';
import { createContext,useContext,useEffect,useRef,useState,type ReactNode,type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { decisionPreview } from '@/domain/decisionPreview';
export const DraftScope = createContext('');
export function DraftSessionProvider({scope,children}:{scope:string;children:ReactNode}) {return <DraftScope.Provider value={scope}>{children}</DraftScope.Provider>;}
export function DraftForm({draftId,children,reviewBeforeSubmit,...props}:ComponentProps<'form'> & {draftId?:string;reviewBeforeSubmit?:{maxRefundCents:number}}) {
 const [preview,setPreview]=useState<{label:string;reason:string}|null>(null);const [error,setError]=useState('');const confirmed=useRef(false);const submitter=useRef<HTMLButtonElement|null>(null);
 const scope=useContext(DraftScope); const search=useSearchParams(); const ref=useRef<HTMLFormElement>(null);const restoring=useRef(false);
 const key=scope&&draftId ? 'rydr-draft:'+scope+':'+draftId : '';
 useEffect(()=>{if(!key||!ref.current)return;
  if(search.has('notice')&&!search.has('error')){sessionStorage.removeItem(key);return;}
  try {const data=JSON.parse(sessionStorage.getItem(key)||'null') as Record<string,string[]>|null;
   if(!data)return;const applied=new WeakSet<Element>();
   const restore=()=>{if(!ref.current)return;restoring.current=true;try{for(const el of Array.from(ref.current.elements))if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement){
    if(el.type==='hidden'||!el.name||!data[el.name]||applied.has(el))continue;applied.add(el);
    if(el instanceof HTMLInputElement&&(el.type==='checkbox'||el.type==='radio'))el.checked=data[el.name].includes(el.value);else el.value=data[el.name][0];
    if(el instanceof HTMLSelectElement)el.dispatchEvent(new Event('change',{bubbles:true}));
   }}finally{restoring.current=false;}};
   const observer=new MutationObserver(restore);observer.observe(ref.current,{childList:true,subtree:true});restore();return()=>observer.disconnect();
  }catch{sessionStorage.removeItem(key);}
 },[key,search]);
 function save(){if(restoring.current||!key||!ref.current)return;const data:Record<string,string[]>={};
  for(const el of Array.from(ref.current.elements))if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement){if(el.type==='hidden'||!el.name)continue;if(el instanceof HTMLInputElement&&(el.type==='checkbox'||el.type==='radio')&&!el.checked)continue;(data[el.name]??=[]).push(el.value);}
  sessionStorage.setItem(key,JSON.stringify(data));}
 return <form {...props} ref={ref} data-draft-id={draftId} onSubmit={e=>{
  save();
  if(reviewBeforeSubmit&&!confirmed.current){e.preventDefault();const button=(e.nativeEvent as SubmitEvent).submitter;submitter.current=button instanceof HTMLButtonElement?button:null;const values=new FormData(e.currentTarget);const result=decisionPreview({disposition:String(values.get('disposition')??''),amount:String(values.get('targetRefund')??''),reason:String(values.get('reason')??''),appealOutcome:submitter.current?.name==='appealOutcome'?submitter.current.value:undefined,maxCents:reviewBeforeSubmit.maxRefundCents});if(!result.ok){setError(result.error);setPreview(null);return;}setError('');setPreview({label:result.label,reason:result.reason});return;}
  confirmed.current=false;props.onSubmit?.(e);
 }} onChange={e=>{save();setPreview(null);setError('');props.onChange?.(e);}}>
  <FormContents>{children}{error?<p role="alert" className="notice notice--danger">{error}</p>:null}{preview?<section className="decision-preview" aria-label="Review decision draft"><h3>Check this decision</h3><strong>{preview.label}</strong><p className="original-text">{preview.reason}</p><p className="small muted">The server checks the task revision and evidence before recording the decision and any simulated settlement.</p><div className="row"><button className="btn btn--primary" type="button" onClick={()=>{confirmed.current=true;if(ref.current)ref.current.requestSubmit(submitter.current??undefined);}}>{preview.label}</button><button type="button" className="btn btn--ghost" onClick={()=>setPreview(null)}>Back to edit</button></div></section>:null}</FormContents>
 </form>;
}
function FormContents({children}:{children:ReactNode}){const {pending}=useFormStatus();return <fieldset className="draft-contents" disabled={pending}>{children}{pending?<p className="small muted" role="status">Saving the recorded action…</p>:null}</fieldset>;}
