import { NextResponse } from 'next/server';
import { CASE_STATUS_LABELS } from '@/domain/caseStatus';
import { loadAllCasePackets, type CasePacket } from '@/lib/casePacket';

/** Newest timestamp any of the case's records carries. */
function latestActivityAt(packet: CasePacket): string | null {
  const stamps = [
    packet.run?.updatedAt ?? null,
    packet.effectiveDecision?.createdAt ?? null,
    ...packet.tasks.map((task) => task.updatedAt),
    ...packet.settlements.map((settlement) => settlement.postedAt ?? settlement.createdAt),
  ].filter((value): value is string => typeof value === 'string');
  if (stamps.length === 0) return null;
  return stamps.reduce((best, current) => (Date.parse(current) > Date.parse(best) ? current : best));
}

/**
 * Case index for the queue. Status comes from the derived business status, so a
 * completed analysis that has not settled is never reported as resolved.
 */
export async function GET() {
  const packets = await loadAllCasePackets();

  const summaries = packets.map((packet) => ({
    id: packet.caseRecord.id,
    version: packet.caseRecord.version,
    category: packet.caseRecord.category,
    disputedCents: packet.caseRecord.disputedCents,
    provenance: packet.caseRecord.provenance,
    status: packet.status,
    statusLabel: CASE_STATUS_LABELS[packet.status],
    openTaskId: packet.openTask?.id ?? null,
    effectiveDisposition: packet.effectiveDecision?.disposition ?? null,
    lastUpdatedAt: latestActivityAt(packet),
    syntheticDataNotice: true as const,
  }));

  return NextResponse.json({
    syntheticDataNotice: true,
    summaries,
    categories: [...new Set(packets.map((packet) => packet.caseRecord.category))],
  });
}

