import { getCaseVersion, getPolicyPack } from './cases';
import { listRuns } from './runs';
import { listRepairs } from './journeys';
import { evaluateCase } from '../domain/policy';
import type { DemoRole } from '../domain/demoAccess';
export async function repairComparison(caseId: string, role: DemoRole) {
  const repair = (await listRepairs(caseId,role)).filter(r=>r.resultingVersion).at(-1);
  if (!repair?.resultingVersion) return null;
  const before = await getCaseVersion(caseId,repair.startingVersion); const after = await getCaseVersion(caseId,repair.resultingVersion);
  if (!before || !after) return null;
  const a = evaluateCase(before,await getPolicyPack(before.policyVersion)); const b = evaluateCase(after,await getPolicyPack(after.policyVersion));
  const changes = b.findings.filter(f=>f.kind !== 'claim').flatMap(f=>{
    const old = a.findings.find(previous=>previous.id === f.id);
    return old && old.text !== f.text ? [{findingId:f.id,before:old.text,after:f.text,policyIds:f.policyIds}] : [];
  });
  const runs = await listRuns(caseId);
  const prior = runs.filter(r=>r.caseVersion === before.version && r.resolution).at(-1);
  const current = runs.filter(r=>r.caseVersion === after.version && r.resolution).at(-1);
  return { beforeVersion:before.version,afterVersion:after.version,changes:changes.slice(0,3),
    beforeDisposition:prior?.resolution?.disposition ?? null, afterDisposition:current?.resolution?.disposition ?? null,
    deterministicBefore:a.disposition,deterministicAfter:b.disposition,mode:current?.mode ?? null };
}
