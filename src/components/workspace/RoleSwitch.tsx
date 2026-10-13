'use client';
import { usePathname,useSearchParams } from 'next/navigation';
import { leaveDemo } from '@/app/demoActions';
export function RoleSwitch(){const path=usePathname();const params=useSearchParams();const id=path.match(/^\/cases\/([^/]+)/)?.[1]??params.get('case')??'';
return <form action={leaveDemo}><input type="hidden" name="caseId" value={id}/><button className="btn btn--ghost btn--sm">Change role</button></form>;}
