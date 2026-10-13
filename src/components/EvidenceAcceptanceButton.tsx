/** Mirrors the server guard; written statements remain in the review record. */
export function EvidenceAcceptanceButton({structured, current, open}: {structured: boolean; current: boolean; open: boolean}) {
 const allowed=structured && current && open;
 const reason=!structured ? 'A written statement is already recorded. Supply structured GPS or fare values to create a new evidence version.' : !open ? 'This review is complete.' : !current ? 'Open the review for the current case version before accepting more evidence.' : null;
 return <div className="evidence-acceptance"><button type="submit" className="btn btn--primary btn--sm" disabled={!allowed}>Accept into a new case version</button>{reason?<p className="small muted">{reason}</p>:null}</div>;
}
