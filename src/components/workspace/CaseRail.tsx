'use client';
import Link from 'next/link';
import { useEffect,useState } from 'react';
export function CaseRail({selected,options}:{selected:string;options:{id:string;label:string;amount:string;version:number}[]}) {
 const [open,setOpen]=useState(false);
 useEffect(()=>{const query=matchMedia('(min-width:1280px)');const update=()=>setOpen(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 return <aside className="desk-case-list"><button className="case-list-toggle btn btn--ghost btn--sm" aria-expanded={open} aria-controls="desk-cases" onClick={()=>{if(document.body.classList.contains('desk-inspector-open')){document.dispatchEvent(new Event('rydr:close-inspector'));setOpen(true);}else setOpen(!open);}}>Cases <span className="small muted">{options.length}</span></button><nav id="desk-cases" aria-label="Cases in this session" hidden={!open}>{options.map(c=><Link className="desk-case-row" href={'/cases/'+encodeURIComponent(c.id)} key={c.id} aria-current={c.id===selected?'page':undefined}><span className="desk-case-row__meta"><span>{c.id} · v{c.version}</span><span>{c.amount}</span></span><strong>{c.label}</strong></Link>)}</nav></aside>;
}
