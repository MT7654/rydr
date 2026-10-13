export function CaseProgress({ status, hasDecision, hasAppeal }: { status: string; hasDecision: boolean; hasAppeal: boolean }) {
  const steps = hasAppeal ? ['Case received','Decision recorded','Appeal in review'] : ['Case received','Evidence review','Decision recorded'];
  const current = hasAppeal ? 2 : hasDecision ? 2 : status === 'open' ? 0 : 1;
  return <ol className="case-progress" aria-label="Case progress">{steps.map((step,index) => <li key={step} className={index < current || (hasDecision && !hasAppeal) ? 'is-complete' : index === current ? 'is-current' : ''} aria-current={index === current ? 'step' : undefined}>
    <span className="case-progress__number" aria-hidden="true">{index < current || (hasDecision && !hasAppeal) ? '✓' : index+1}</span><span>{step}</span>
  </li>)}</ol>;
}

