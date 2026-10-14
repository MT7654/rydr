import Link from 'next/link';
export function CaseViewTabs({ role, section, href }: { role:'reviewer'|'rider'|'driver';section:string;href:(section:string)=>string }) {
 const entries=role==='reviewer'?[['assessment','Review'],['outcome','Outcome'],['history','Record']]:[['brief','Your ride'],['history','Record']];
 return <nav className="desk-tabs" aria-label="Case views">{entries.map(([key,label])=><Link key={key} href={href(key)} aria-current={(key==='assessment'?!['outcome','history'].includes(section):role!=='reviewer'&&key==='brief'?section!=='history':section===key)?'page':undefined}>{label}</Link>)}</nav>;
}
