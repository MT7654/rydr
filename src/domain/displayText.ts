/** Presentation aliases only. Original values remain in stored records and audit exports. */
export function displayText(text: string): string {
  return text
    .replace(/\b(?:set_dec_|dec_)[A-Za-z0-9_-]+/g, 'the recorded decision')
    .replace(/\btask_[A-Za-z0-9_-]+/g, 'the review task')
    .replace(/\brun_[A-Za-z0-9_-]+/g, 'the assessment')
    .replace(/Deterministic refund amount:/g, 'Recommended refund:')
    .replace(/The deterministic bundle confirms this outcome and the refund amount\./g, 'The policy checks support this outcome and refund amount.');
}
