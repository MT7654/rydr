import { describe, expect, it } from 'vitest';
import { parseReasoningSummary } from '@/domain/reading';
import { displayText } from '@/domain/displayText';

describe('assessment presentation preserves the evidence', () => {
  it('breaks long paragraphs into findings without splitting money or times', () => {
    const result=parseReasoningSummary('The charge is SGD 5.00. The timer began at 09:00:10.\n\nThe GPS accuracy is 8.5 m. A reviewer must verify it.',[]);
    expect([result.lead,...result.findings]).toEqual(['The charge is SGD 5.00.','The timer began at 09:00:10.','The GPS accuracy is 8.5 m.','A reviewer must verify it.']);
  });
  it('retains unknowns embedded in older narrative records', () => {
    expect(parseReasoningSummary('The charge is disputed. Unresolved: The delivery status is missing. No receipt was supplied.', ['The delivery status is missing.']).unresolved).toEqual(['The delivery status is missing.','No receipt was supplied.']);
  });
  it('moves the recommendation first without deleting other sentences', () => {
    const result=parseReasoningSummary('The driver waited. Deterministic refund amount: SGD 5.00. The pickup was outside the zone.',[]);
    expect(result.lead).toBe('Deterministic refund amount: SGD 5.00.');
    expect(result.findings).toEqual(['The driver waited.','The pickup was outside the zone.']);
  });
  it('replaces execution identifiers in display text while retaining policy and amounts', () => {
    expect(displayText('Rider appeal against dec_SYN-001_abc: NS-06 refund SGD 5.00.')).toBe('Rider appeal against the recorded decision: NS-06 refund SGD 5.00.');
  });
});

it('avoids repeating sentence fragments already present in a complete uncertainty', () => {
  const uncertainty='The delivery status is missing. A sent notification does not establish receipt.';
  const result=parseReasoningSummary('Review needed. Unresolved: '+uncertainty+' No rider response was recorded.',[uncertainty]);
  expect(result.unresolved).toEqual([uncertainty,'No rider response was recorded.']);
});
