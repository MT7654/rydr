/** Client review preview only; authoritative decisions still validate on the server. */
export function decisionPreview(input:{disposition:string;amount:string;reason:string;appealOutcome?:string;maxCents:number}) {
 const reason=input.reason.trim();
 if(!reason)return {ok:false as const,error:'Record why this outcome is supported.'};
 if(input.appealOutcome==='reject')return {ok:true as const,label:'Reject appeal and keep original decision',reason,cents:null};
 if(!['refund','partial_refund','uphold'].includes(input.disposition))return {ok:false as const,error:'Choose an outcome.'};
 let cents=0;
 if(input.disposition!=='uphold'){
  const raw=input.amount.trim();
  if(raw==='')cents=input.disposition==='refund'?input.maxCents:-1;
  else if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return {ok:false as const,error:'Use a non-negative SGD amount with at most two decimal places.'};
  else {const [whole,fraction='']=raw.split('.');cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));}
  if(!Number.isSafeInteger(cents)||cents<0||cents>input.maxCents)return {ok:false as const,error:'Enter a refund within the disputed amount.'};
 }
 const amount='SGD '+(cents/100).toFixed(2);
 return {ok:true as const,label:(input.appealOutcome==='accept'?'Accept appeal · ':'')+(input.disposition==='uphold'?'Record charge upheld':'Record '+amount+' refund'),reason,cents};
}
