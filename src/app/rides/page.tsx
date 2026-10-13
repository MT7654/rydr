import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSelectedCaseId, requirePartyRole } from '@/lib/demoSession';
import { loadWorkspace } from '@/lib/workspace';
import { loadAllCasePackets } from '@/lib/casePacket';
import { getAllCases, getCase, getPolicyPack } from '@/repositories/cases';
import { getCheckpoint } from '@/repositories/journeys';
import { formatSgd } from '@/domain/money';
import { CASE_STATUS_LABELS } from '@/domain/caseStatus';
import { checkpointPolicyPreview } from '@/domain/pickupPolicy';
import { navigatorReady } from '@/agents/navigator';
import { PickupJourney } from '@/components/PickupJourney';
import { NavigatorPanel } from '@/components/NavigatorPanel';
import { paymentsForCase } from '@/lib/casePayments';
import { EmptyState } from '@/components/States';
import { PartyWorkspace } from '@/components/workspace/PartyWorkspace';
import { CaseSelector, type CaseOption } from '@/components/workspace/CaseSelector';

/**
 * My rides — the single party entry.
 *
 * Server derives rider vs driver from the session. Selection priority:
 * valid explicit URL selection → valid session selection → DISP-002 when
 * available → first accessible case → useful empty state.
 */
export default async function RidesPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string; journey?: string; section?: string; task?: string; run?: string; notice?: string; error?: string; as?: string }>;
}) {
  const role = await requirePartyRole();
  const params = await searchParams;

  if (params.journey === 'pickup') {
    return <PickupStage role={role} />;
  }

  const cases = await getAllCases();
  if (cases.length === 0) {
    return (
      <main className="container stack">
        <EmptyState
          title="No rides in this session"
          body="Start a fresh session to open a new set of sample rides."
        />
      </main>
    );
  }

  // Selection: explicit → session preference → featured → first accessible.
  // An invalid or inaccessible selection falls back silently, so a stale id
  // never reveals whether another visitor's case exists.
  const explicit = params.case && /^[A-Za-z0-9_-]{1,80}$/.test(params.case) ? params.case : null;
  const sessionSelection = await getSelectedCaseId();
  const accessible = new Set(cases.map((record) => record.id));
  const caseId =
    (explicit && accessible.has(explicit) ? explicit : null) ??
    (sessionSelection && accessible.has(sessionSelection) ? sessionSelection : null) ??
    (accessible.has('DISP-002') ? 'DISP-002' : null) ??
    cases[0]!.id;

  const data = await loadWorkspace(caseId, {
    role,
    runId: params.run ?? null,
    section: params.section,
    taskId: params.task ?? null,
  });
  if (!data) redirect('/');

  const packets = await loadAllCasePackets();
  const options: CaseOption[] = packets.map((packet) => ({
    id: packet.caseRecord.id,
    label: packet.caseRecord.id+' · '+(packet.caseRecord.category === 'damage' ? 'Damage charge' : packet.caseRecord.category === 'no_show_charge' ? 'No-show charge' : 'Route charge'),
    status: CASE_STATUS_LABELS[packet.status],
    disputedCents: packet.caseRecord.disputedCents,
  }));

  return (
    <PartyWorkspace
      data={data}
      notice={params.notice}
      error={params.error}
      selector={
        <CaseSelector
          options={options}
          selectedId={caseId}
          formatAmount={(cents) => formatSgd(cents)}
        />
      }
      payments={await paymentsForCase(caseId, role)}
    />
  );
}

/** Payments and independent remedies for exactly one case. */
/** Pre-trip checkpoint, inside the same My rides shell. */
async function PickupStage({ role }: { role: 'rider' | 'driver' }) {
  const checkpoint = await getCheckpoint();
  const template = await getCase('SYN-011');
  if (!template) throw new Error('Pickup source sample unavailable.');
  const preview = checkpointPolicyPreview(checkpoint, template, await getPolicyPack(checkpoint.policyId));

  return (
    <main className="container stack workspace">
      <header className="workspace-header">
        <div className="workspace-header__main">
          <p className="eyebrow">{role === 'driver' ? 'Driver workspace' : 'Rider workspace'} · Before a dispute</p>
          <h1 className="workspace-header__title">Meet at the right place</h1>
          <p className="workspace-header__meta">
            <span>Pre-trip checkpoint</span>
            <span aria-hidden="true"> · </span>
            <span>Next: <strong>{role === 'driver' ? 'Driver' : 'Rider'}</strong></span>
          </p>
        </div>
        <div className="workspace-header__aside">
          <span className="badge badge--neutral">Sample ride</span>
          <Link className="btn btn--ghost btn--sm" href="/rides">
            Back to your rides
          </Link>
        </div>
      </header>

      <ol className="workspace-progress" aria-label="Case progress">
        <li className="workspace-progress__step is-current" aria-current="step">
          <span className="workspace-progress__marker" aria-hidden="true">1</span>
          <span className="workspace-progress__label">Pickup</span>
          <span className="small muted workspace-progress__detail">In progress</span>
        </li>
        <li className="workspace-progress__step is-upcoming">
          <span className="workspace-progress__marker" aria-hidden="true">2</span>
          <span className="workspace-progress__label">Ride</span>
          <span className="small muted workspace-progress__detail">Not yet reached</span>
        </li>
        <li className="workspace-progress__step is-skipped">
          <span className="workspace-progress__marker" aria-hidden="true">–</span>
          <span className="workspace-progress__label">Dispute</span>
          <span className="small muted workspace-progress__detail">Not required if pickup is confirmed</span>
        </li>
      </ol>

      <div className="workspace-grid">
        <div className="workspace-canvas">
          <PickupJourney checkpoint={checkpoint} role={role} preview={preview} />
        </div>
        <NavigatorPanel target="pickup" ready={navigatorReady()} />
      </div>

      <p className="small muted">
        <Link href="/rides">← Back to your rides</Link> · <Link href="/policies">Help &amp; policies</Link>
      </p>
    </main>
  );
}
