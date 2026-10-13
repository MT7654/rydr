import { NextResponse } from 'next/server';
import { getCase } from '@/repositories/cases';
import { evaluateCase } from '@/domain/policy';
import { scoreEvidence } from '@/domain/confidence';
import { getPolicyPack } from '@/repositories/cases';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const caseRecord = await getCase(id);
  if (!caseRecord) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }
  const pack = await getPolicyPack(caseRecord.policyVersion);
  if (pack.source === 'supplied_sample') {
    return NextResponse.json({ error: 'Case is not governed by the demo pack' }, { status: 400 });
  }
  const evaluation = evaluateCase(caseRecord, pack);
  const quality = scoreEvidence(caseRecord, evaluation, pack.thresholds);

  return NextResponse.json({
    case: caseRecord,
    evaluation: {
      disposition: evaluation.disposition,
      recommendedRefundCents: evaluation.recommendedRefundCents,
      findings: evaluation.findings,
      issues: evaluation.issues,
      materialEvidenceIds: evaluation.materialEvidenceIds,
      policyIds: evaluation.policyIds,
      noShow: evaluation.noShow,
      route: evaluation.route,
    },
    quality,
    clauses: pack.clauses,
  });
}

