import type { ReasoningNarrative } from '@/agents/explanation';

const OUTCOME_PATTERNS = [/^The evidence does not support a deterministic outcome/i, /^No monetary change is recommended/i, /^Deterministic refund amount:/i];
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[("“']?[A-Z0-9])/).map(sentence => sentence.trim()).filter(Boolean);
}
/** A bounded verbatim preview; the full assessment remains available separately. */
export function assessmentExcerpt(text: string, limit = 300): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  const boundary = normalized.lastIndexOf(' ', limit - 1);
  return `${normalized.slice(0, boundary > limit / 2 ? boundary : limit - 1)}…`;
}

/** Format prose without rewriting claims, amounts or source records. */
export function parseReasoningSummary(summary: string, unresolved: string[]): ReasoningNarrative {
  const marker = summary.search(/Unresolved:\s*/i);
  const body = (marker === -1 ? summary : summary.slice(0, marker)).trim();
  const sentences = body.split(/\n{2,}/).flatMap(block => splitSentences(block.trim())).filter(Boolean);
  const outcome = sentences.findIndex(sentence => OUTCOME_PATTERNS.some(pattern => pattern.test(sentence)));
  if (outcome > 0) sentences.unshift(...sentences.splice(outcome,1));
  const [lead,...findings] = sentences;
  const legacyUnknowns = marker === -1 ? [] : splitSentences(summary.slice(marker).replace(/^Unresolved:\s*/i,''));
  const alreadyShown = new Set(unresolved.flatMap(splitSentences));
  return { lead: lead ?? '', findings, unresolved: [...new Set([...unresolved,...legacyUnknowns.filter(sentence => !alreadyShown.has(sentence))])] };
}
