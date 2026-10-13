import { parseReasoningSummary } from './JudgeReasoning';
import { displayText } from '@/domain/displayText';

/** Formatting only: never invents or paraphrases assessment claims. */
export function ReadableText({ text, expanded = false }: { text: string; expanded?: boolean }) {
  const { lead, findings, unresolved } = parseReasoningSummary(text, []);
  return <div className="readable-text">
    <p>{displayText(lead)}</p>
    {findings.length > 0 ? <ul>{(expanded ? findings : findings.slice(0,2)).map((sentence,i) => <li key={i}>{displayText(sentence)}</li>)}</ul> : null}
    {!expanded && findings.length > 2 ? <details><summary>Read full assessment</summary><ul>{findings.slice(2).map((sentence,i) => <li key={i}>{displayText(sentence)}</li>)}</ul></details> : null}
    {unresolved.length > 0 ? <details open={expanded}><summary>What remains uncertain</summary><ul>{unresolved.map((sentence,i) => <li key={i}>{displayText(sentence)}</li>)}</ul></details> : null}
  </div>;
}

