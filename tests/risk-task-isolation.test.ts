import {it,expect,vi,afterEach} from 'vitest';
import {createAdpProvider} from '../src/providers/adp';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('uses one deployment with isolated risk and adjudication conversations',async()=>{
 vi.stubEnv('RYDR_ADP_JUDGE_APPKEY','unit-risk-role');const bodies:Record<string,unknown>[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return new Response('event: response.completed\ndata: '+JSON.stringify({Type:'response.completed',Response:{Status:'success',Messages:[{Type:'reply',Contents:[{Type:'text',Text:'{}'}]}]}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});}));
 const p=createAdpProvider('https://example.test/adp');const common={role:'judge' as const,runId:'ISOLATION',systemInstruction:'Return {}',input:{},allowedEvidenceIds:[],timeoutMs:1000,maxOutputTokens:100};
 await p.invoke({...common,stage:'assess_risk'});await p.invoke({...common,stage:'judge'});
 expect(bodies[0]!.AppKey).toBe(bodies[1]!.AppKey);expect(bodies[0]!.ConversationId).not.toBe(bodies[1]!.ConversationId);
});
