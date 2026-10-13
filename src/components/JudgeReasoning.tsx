import type { ReasoningNarrative } from '@/agents/explanation';
import { displayText } from '@/domain/displayText';

/* ------------------------------------------------------------------ */
/*  JudgeReasoning                                                     */
/*                                                                     */
/*  Renders the judge's narrative as a lead statement followed by the  */
/*  evidence it rests on and the questions it could not settle.        */
/* ------------------------------------------------------------------ */

interface Props extends ReasoningNarrative {
  className?: string;
}

export function JudgeReasoning({ lead, findings, unresolved, className }: Props) {
  const classes = className ? `reasoning ${className}` : 'reasoning';

  return (
    <div className={classes}>
      {lead ? <p className="reasoning__lead">{displayText(lead)}</p> : null}

      {findings.length > 0 ? (
        <div className="reasoning__group">
          <p className="reasoning__heading">What the evidence shows</p>
          <ul className="reasoning__list">
            {findings.slice(0, 3).map((finding, index) => (
              <li key={index}>{displayText(finding)}</li>
            ))}
          </ul>
          {findings.length > 3 ? <details><summary>Read {findings.length - 3} more findings</summary><ul className="reasoning__list">{findings.slice(3).map((finding,index) => <li key={index}>{displayText(finding)}</li>)}</ul></details> : null}
        </div>
      ) : null}

      {unresolved.length > 0 ? (
        <div className="reasoning__group">
          <p className="reasoning__heading">Unresolved</p>
          <ul className="reasoning__list reasoning__list--unresolved">
            {unresolved.map((item, index) => (
              <li key={index}>{displayText(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}


export { parseReasoningSummary } from '@/domain/reading';

