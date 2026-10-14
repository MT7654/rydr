import {describe,it,expect} from 'vitest';
import {decisionPreview} from '../src/domain/decisionPreview';
const base={disposition:'partial_refund',amount:'3.44',reason:'Records support the excess-distance refund.',maxCents:650};
describe('reviewing a monetary decision before submission',()=>{
 it('keeps exact cents in the effect preview',()=>expect(decisionPreview(base)).toMatchObject({ok:true,cents:344,label:'Record SGD 3.44 refund'}));
 it.each(['-1','3.444','Infinity','1e2','NaN'])('rejects an ambiguous or invalid amount %s',amount=>expect(decisionPreview({...base,amount})).toMatchObject({ok:false}));
 it('rejects an amount above the disputed charge',()=>expect(decisionPreview({...base,amount:'6.51'})).toMatchObject({ok:false}));
 it('requires a human reason',()=>expect(decisionPreview({...base,reason:'   '})).toMatchObject({ok:false}));
 it('requires an amount for a partial refund',()=>expect(decisionPreview({...base,amount:''})).toMatchObject({ok:false}));
 it('previews a blank full refund against the actual charge',()=>expect(decisionPreview({...base,disposition:'refund',amount:''})).toMatchObject({ok:true,cents:650}));
 it('rejects an appeal without forcing a replacement outcome or amount',()=>expect(decisionPreview({...base,disposition:'',amount:'',appealOutcome:'reject'})).toMatchObject({ok:true,cents:null,label:'Reject appeal and keep original decision'}));
 it('still requires a reason when rejecting an appeal',()=>expect(decisionPreview({...base,reason:'',appealOutcome:'reject'})).toMatchObject({ok:false}));
 it('upholding the charge does not use a stale refund amount',()=>expect(decisionPreview({...base,disposition:'uphold',amount:'3.44'})).toMatchObject({ok:true,cents:0}));
});
