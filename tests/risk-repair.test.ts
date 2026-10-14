import {expect,it,vi} from 'vitest';
import {validateRiskWithRepair} from '../src/agents/riskReasoner';
import {loadCase} from './helpers';
it('repairs an overlong risk citation list once while keeping strict evidence validation',async()=>{
 const record=await loadCase('DISP-002');
 const raw={signals:[{code:'statement_record_conflict',evidenceIds:record.evidence.slice(0,5).map(e=>e.id),reason:'Synthetic validation check',benignExplanation:'Ordinary record ambiguity'}],summary:'Synthetic inspection only'};
 const repair=vi.fn(async()=>({signals:[],summary:'No source-supported risk concern.'}));
 const result=await validateRiskWithRepair(raw,record,repair);expect(result.signals).toEqual([]);expect(repair).toHaveBeenCalledTimes(1);
});
it('does not accept invented sources after one risk repair',async()=>{
 const record=await loadCase('DISP-002');
 const invalid={signals:[{code:'statement_record_conflict',evidenceIds:['INVENTED'],reason:'Synthetic validation check',benignExplanation:'Ordinary record ambiguity'}],summary:'Synthetic inspection only'};
 const repair=vi.fn(async()=>invalid);
 await expect(validateRiskWithRepair(invalid,record,repair)).rejects.toThrow('unknown or history-only');expect(repair).toHaveBeenCalledTimes(1);
});
it('does not spend a repair call for valid risk output',async()=>{
 const repair=vi.fn();await validateRiskWithRepair({signals:[],summary:'No concern.'},await loadCase('SYN-001'),repair);expect(repair).not.toHaveBeenCalled();
});
