import Link from 'next/link';
import { requireReviewerRole } from '@/lib/demoSession';
import { loadAllCasePackets } from '@/lib/casePacket';
import { formatSgd } from '@/domain/money';
import { CASE_STATUS_LABELS, caseStatusTone } from '@/domain/caseStatus';
import { SERVICE_TARGET_LABEL, deadlineLabel, isOverdue } from '@/domain/routing';
import { migrateLegacyReviewRequests } from '@/repositories/reviewTasks';
import { EmptyState } from '@/components/States';
import { SyntheticNotice } from '@/components/Badges';
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
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireReviewerRole();
  const { filter: filterParam } = await searchParams;
  const filter = parseWorklistFilter(filterParam);

  // Bring any legacy pending request into the queue so nothing stays stranded.
  await migrateLegacyReviewRequests();

  const now = Date.now();
  const packets = await loadAllCasePackets();
  const summaries = packets.map(summarizeCase);
  const counts = worklistCounts(summaries);
  const ordered = [...summaries].sort((a, b) => compareWorklistSummaries(a, b, now));
  const visible = ordered.filter((summary) => matchesWorklistFilter(summary, filter));

  const activeFilter = WORKLIST_FILTERS.find((entry) => entry.key === filter)!;
  const safetyCount = ordered.filter((summary) => summary.lane === 'safety').length;
  const overdueCount = ordered.filter(
    (summary) => summary.dueAt !== null && isOverdue(summary.dueAt, now),
  ).length;

  return (
    <main className="container stack worklist">
      <div className="card">
        <div className="card__title">
          <h1>Worklist</h1>
          <span className="badge badge--review">Reviewer workspace · sample identity</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Every case in this session, including ones with no assessment yet. Open a case to assess
          it, resolve a gap and record a decision. Clear cases settle without a reviewer.
        </p>
        <p className="small muted" style={{ margin: '0.5rem 0 0' }}>
          Ordered by lane, then by how far past its target a case has run. Deadlines are{' '}
          <strong>{SERVICE_TARGET_LABEL}</strong>. Priority changes who looks next and by when; it
          never changes the refund amount.
        </p>
      </div>

      <div className="row" aria-label="Worklist summary">
        <span className="badge badge--neutral">{summaries.length} cases</span>
        <span className={`badge ${safetyCount > 0 ? 'badge--danger' : 'badge--neutral'}`}>
          {safetyCount} in the safety lane
        </span>
        <span className={`badge ${overdueCount > 0 ? 'badge--review' : 'badge--neutral'}`}>
          {overdueCount} past target
        </span>
        <Link href="/intake" className="btn btn--ghost btn--sm">
          Add case
        </Link>
      </div>

      <nav className="filters" aria-label="Filter cases">
        {WORKLIST_FILTERS.map((entry) => (
          <Link
            key={entry.key}
            href={entry.key === 'all' ? '/worklist' : `/worklist?filter=${entry.key}`}
            className="filter"
            aria-current={filter === entry.key}
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
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Issue</th>
                <th scope="col">Disputed</th>
                <th scope="col">Status</th>
                <th scope="col">Next owner</th>
                <th scope="col">Active task</th>
                <th scope="col">Target</th>
                <th scope="col">Provenance</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {visible.map((summary) => {
                const overdue = summary.dueAt !== null && isOverdue(summary.dueAt, now);
                const href = `/cases/${summary.caseId}${summary.selectedTaskId ? `?task=${summary.selectedTaskId}` : ''}`;
                return (
                  <tr key={summary.caseId}>
                    <td>
                      <Link href={href} className="mono">
                        {summary.caseId}
                      </Link>
                      <div className="small muted">
                        v{summary.caseVersion}
                        {summary.openTaskCount > 1 ? ` · ${summary.openTaskCount} open tasks` : ''}
                      </div>
                    </td>
                    <td>{summary.issueLabel}</td>
                    <td className="amount">{formatSgd(summary.disputedCents)}</td>
                    <td>
                      <span className={`badge badge--${caseStatusTone(summary.status)}`}>
                        {CASE_STATUS_LABELS[summary.status]}
                      </span>
                      <div className="small muted">{summary.stageLabel}</div>
                    </td>
                    <td>{summary.nextActor ? OWNER_LABELS[summary.nextActor] : '—'}</td>
                    <td className="queue-table__reason">
                      {summary.openTaskKinds.length === 0
                        ? summary.needsAssessment
                          ? 'No assessment yet'
                          : 'No open task'
                        : summary.openTaskKinds.map(reviewTaskLabel).join(', ')}
                    </td>
                    <td>
                      {summary.dueAt ? (
                        <span className={overdue ? 'queue-overdue' : undefined}>
                          {deadlineLabel(summary.dueAt, now)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <SyntheticNotice provenance={summary.provenance} />
                    </td>
                    <td>
                      <Link href={href} className="btn btn--primary btn--sm">
                        {summary.primaryActionLabel}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {summaries.length > 0 && visible.length > 0 && filter !== 'all' ? (
        <p className="small muted">
          <Link href="/worklist">Clear filters</Link> to see every case.
        </p>
      ) : null}
    </main>
  );
}
