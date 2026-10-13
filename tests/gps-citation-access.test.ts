import { expect, it, vi } from 'vitest';
let workspace: 'rider'|'driver'|'reviewer'|null='driver';
vi.mock('../src/lib/demoSession',()=>({getDemoRole: async()=>workspace}));
import { GET } from '../src/app/api/cases/[id]/citations/route';
it.each(['rider','driver'] as const)('limits %s inspection to permitted sources and rules',async role=>{
 workspace=role;
 const response=await GET(new Request('http://localhost/api/cases/DISP-002/citations?run=foreign-run'),{params:Promise.resolve({id:'DISP-002'})});
 expect(response.status).toBe(200);
 const index=await response.json();
 expect(index.evidence.filter((item:{kind:string})=>item.kind==='gps')).toHaveLength(8);
 expect(index.evidence.every((item:{kind:string;payload:{sender?:string}})=>item.kind!=='history' && (!['chat','call'].includes(item.kind)||item.payload.sender===role||item.payload.sender==='system'))).toBe(true);
 expect(index.policy.length).toBeGreaterThan(0);
 expect(JSON.stringify(index)).not.toContain('DISP002-HIST');
});
it('retains full source inspection for reviewers and requires a selected workspace',async()=>{
 workspace='reviewer';
 const response=await GET(new Request('http://localhost/api/cases/DISP-002/citations'),{params:Promise.resolve({id:'DISP-002'})});
 const index=await response.json();expect(index.evidence.length).toBeGreaterThan(8);expect(index.policy.length).toBeGreaterThan(0);
 workspace=null;
 expect((await GET(new Request('http://localhost/api/cases/DISP-002/citations'),{params:Promise.resolve({id:'DISP-002'})})).status).toBe(403);
});
