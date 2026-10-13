import { NextResponse } from 'next/server';
import { loadCasePacket } from '@/lib/casePacket';
import { visibleEvidenceForRole } from '@/lib/workspace';
import { getDemoRole } from '@/lib/demoSession';

/**
 * Citation index for one case.
 *
 * Everything needed to explain a canonical evidence id or a policy clause id
 * without a second round trip: original contents, provenance, quality issues and
 * the findings that cite it. The drawer renders exactly this, so a citation can
 * never show something the case does not contain.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const role = await getDemoRole();
  if (!role) return NextResponse.json({ error: 'Choose a workspace first' }, { status: 403 });
  const party = role !== 'reviewer';
  const { id } = await context.params;
  const url = new URL(request.url);
  const runId = party ? null : url.searchParams.get('run');

  const packet = await loadCasePacket(id, { runId });
  if (!packet) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  const { caseRecord, evaluation, pack, catalog } = packet;

  // Party inspection is limited to shared GPS records, never chat, history or other-party claims.
  const evidence = visibleEvidenceForRole(caseRecord,role).map((item) => {
    const entry = catalog.find((candidate) => candidate.id === item.id);
    return {
      id: item.id,
      kind: item.kind,
      timestamp: item.timestamp,
      summary: entry?.summary ?? null,
      source: item.source,
      qualityIssues: item.qualityIssues,
      claims: (item.claims ?? []).filter(claim => !party || claim.suppliedBy === role),
      payload: item.payload,
      findings: evaluation.findings
        .filter((finding) => finding.evidenceIds.includes(item.id))
        .map((finding) => ({
          id: finding.id,
          kind: finding.kind,
          material: finding.material,
          text: finding.text,
        })),
    };
  });

  const policy = pack.clauses.map((clause) => ({
    id: clause.id,
    title: clause.title,
    text: clause.text,
    authority: clause.authority ?? 'demo',
    sourceUrl: clause.sourceUrl ?? null,
    retrievedAt: clause.retrievedAt ?? null,
    category: clause.category,
    policyVersion: pack.version,
    policyId: pack.id,
    findings: evaluation.findings
      .filter((finding) => finding.policyIds.includes(clause.id))
      .map((finding) => ({
        id: finding.id,
        kind: finding.kind,
        material: finding.material,
        text: finding.text,
      })),
  }));

  return NextResponse.json({
    caseId: caseRecord.id,
    caseVersion: caseRecord.version,
    policyId: pack.id,
    policyVersion: pack.version,
    evidence,
    policy,
  });
}

