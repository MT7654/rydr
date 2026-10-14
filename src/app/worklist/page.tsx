import Link from 'next/link';
import { requireReviewerRole } from '@/lib/demoSession';
import { loadAllCasePackets } from '@/lib/casePacket';
import { formatSgd } from '@/domain/money';
import { CASE_STATUS_LABELS, caseStatusTone } from '@/domain/caseStatus';
import { SERVICE_TARGET_LABEL, deadlineLabel, isOverdue } from '@/domain/routing';
import { migrateLegacyReviewRequests } from '@/repositories/reviewTasks';
import { EmptyState } from '@/components/States';

import { reviewTaskLabel } from '@/domain/navigation';
import {
  WORKLIST_FILTERS,
  compareWorklistSummaries,
  matchesWorklistFilter,
  parseWorklistFilter,
  summarizeCase,
  worklistCounts,
  type WorklistFilter,
} from '@/domain/worklist';

const OWNER_LABELS: Record<string, string> = {
  reviewer: 'Reviewer',
  rider: 'Rider',
  driver: 'Driver',
  platform: 'Platform',
};

/**
 * Reviewer Worklist.
 *
 * One case-oriented list. Opening it performs no paid AI calls — it reads the
 * existing repositories and derives state; it never starts an assessment.
 */
export default async function WorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  await requireReviewerRole();
  const { filter: filterParam, q: query = '' } = await searchParams;
  const q=query.trim().slice(0,120);
  const search=q.toLocaleLowerCase();
  const filter = parseWorklistFilter(filterParam);

  // Bring any legacy pending request into the queue so nothing stays stranded.
  await migrateLegacyReviewRequests();

  const now = Date.now();
  const packets = await loadAllCasePackets();
  const summaries = packets.map(summarizeCase);
  const counts = worklistCounts(summaries);
  const ordered = [...summaries].sort((a, b) => compareWorklistSummaries(a, b, now));
  const visible = ordered.filter((summary) => matchesWorklistFilter(summary, filter) && (!search || (summary.caseId+' '+summary.issueLabel+' '+summary.stageLabel).toLocaleLowerCase().includes(search)));

  const activeFilter = WORKLIST_FILTERS.find((entry) => entry.key === filter)!;
  const safetyCount = ordered.filter((summary) => summary.lane === 'safety').length;
  const overdueCount = ordered.filter(
    (summary) => summary.dueAt !== null && isOverdue(summary.dueAt, now),
  ).length;

  return (
    <main className="container stack worklist">
      <header className="desk-worklist-head"><div><p className="eyebrow">Reviewer workspace</p><h1>Worklist</h1><p className="muted">Choose a case to assess or resolve.</p></div><Link href="/intake" className="btn btn--ghost">Add case</Link></header>
      <div className="worklist-tools"><form method="get" action="/worklist" className="worklist-search"><input type="hidden" name="filter" value={filter}/><label htmlFor="worklist-search" className="sr-only">Search cases</label><input id="worklist-search" name="q" className="input" defaultValue={q} placeholder="Search case or issue" maxLength={120}/><button className="btn btn--ghost" type="submit">Search</button></form><span className="small muted">{summaries.length} cases{overdueCount?' · '+overdueCount+' past target':''}{safetyCount?' · '+safetyCount+' safety priority':''}</span><details className="worklist-method"><summary>Routing and sample data</summary><p>Sample identities. Ordered by lane and target age. {SERVICE_TARGET_LABEL}. Queue priority never changes an outcome or refund amount.</p></details></div>

      <nav className="filters" aria-label="Filter cases">
        {WORKLIST_FILTERS.map((entry) => (
          <Link
            key={entry.key}
            href={'/worklist?filter='+entry.key+(q?'&q='+encodeURIComponent(q):'')}
            className="filter"
            aria-current={filter === entry.key?'page':undefined}
          >
            {entry.label} <span className="small muted">{counts[entry.key as WorklistFilter]}</span>
          </Link>
        ))}
      </nav>
      <p className="small muted" style={{ marginTop: '-0.5rem' }}>{activeFilter.description}</p>

      {summaries.length === 0 ? (
        <EmptyState
          title="No cases yet"
          body="Import a case to begin. Nothing is waiting on a reviewer in this session."
          illustration={{
            src: '/illustrations/empty-queue.png',
            alt: 'A small stack of blank paper sheets with a single teal thread looping through them.',
          }}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={`Nothing matches “${activeFilter.label}”`}
          body={`${activeFilter.description} No case in this session is in that state right now.`}
        />
      ) : (
        <div className="card worklist__scroll" style={{ padding: 0 }}>
          <table className="queue-table" tabIndex={0}>
            <caption className="sr-only">Rydr worklist — one row per case</caption>
            <thead><tr><th scope="col">Case</th><th scope="col">Next step</th><th scope="col">Amount</th><th scope="col">Owner and target</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {visible.map((summary) => {
                const overdue = summary.dueAt !== null && isOverdue(summary.dueAt, now);
                const href = `/cases/${summary.caseId}${summary.selectedTaskId ? `?task=${summary.selectedTaskId}` : ''}`;
                return (
                  <tr key={summary.caseId}>
                    <td data-label="Case"><Link href={href} className="case-identifier">{summary.caseId}</Link><strong className="worklist-issue">{summary.issueLabel}</strong><span className="small muted">v{summary.caseVersion} · {summary.provenance==='supplied_sample'?'Supplied sample':'Synthetic sample'}{summary.openTaskCount>1?' · '+summary.openTaskCount+' tasks':''}</span></td>
                    <td data-label="Next step"><span className={`badge badge--${caseStatusTone(summary.status)}`}>{CASE_STATUS_LABELS[summary.status]}</span><p className="small muted">{summary.openTaskKinds.length?summary.openTaskKinds.map(reviewTaskLabel).join(', '):summary.stageLabel}</p></td>
                    <td data-label="Disputed" className="amount">{formatSgd(summary.disputedCents)}</td>
                    <td data-label="Owner / target"><strong>{summary.nextActor?OWNER_LABELS[summary.nextActor]:'No action needed'}</strong><p className={overdue?'queue-overdue small':'small muted'}>{summary.dueAt?deadlineLabel(summary.dueAt,now):'No target yet'}</p></td>
                    <td><Link href={href} className="btn btn--ghost btn--sm">Open case <span className="sr-only">{summary.caseId}</span></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {summaries.length > 0 && (filter !== 'all'||q) ? (
        <p className="small muted">
          <Link href="/worklist">Clear filters</Link> to see every case.
        </p>
      ) : null}
    </main>
  );
}
