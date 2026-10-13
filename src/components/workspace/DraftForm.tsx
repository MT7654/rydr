'use client';
import { createContext,useContext,useEffect,useRef,type ReactNode,type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
export const DraftScope = createContext('');
export function DraftSessionProvider({scope,children}:{scope:string;children:ReactNode}) {return <DraftScope.Provider value={scope}>{children}</DraftScope.Provider>;}
export function DraftForm({draftId,children,...props}:ComponentProps<'form'> & {draftId?:string}) {
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
 return <form {...props} ref={ref} data-draft-id={draftId} onSubmit={e=>{save();props.onSubmit?.(e);}} onChange={e=>{save();props.onChange?.(e);}}>{children}</form>;
}
