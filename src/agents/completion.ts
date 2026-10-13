import type { CaseDecision, CaseRecord, DecisionDisposition, RunRecord } from '../domain/contracts';
import { getCase } from '../repositories/cases';
import { ensureReviewTask, findOpenTask } from '../repositories/reviewTasks';
import {
  chargeRefFor,
  effectiveDecisionForCase,
  listSettlementsForCase,
  postSettlement,
  recordDecision,
} from '../repositories/ledger';

/**
 * Turns a finished analysis run into an operational outcome.
 *
 * Two journeys leave this function: an eligible standard case records an AI
 * decision and posts a simulated settlement with no further model calls, while
 * an uncertain case gets exactly one open review task. Failures and stale case
 * versions are routed to a reviewer rather than being labelled settled.
 */
export type CompletionKind =
  | 'review_task'
  | 'auto_settled'
  | 'settlement_failed'
  | 'none';

export interface CompletionOutcome {
  kind: CompletionKind;
  taskId?: string;
  decisionId?: string;
  settlementId?: string;
  note: string;
}

/** Dispositions the automatic path is permitted to settle without a reviewer. */
const AUTO_SETTLEABLE: ReadonlySet<string> = new Set(['refund', 'uphold', 'partial_refund']);

function asDecisionDisposition(value: string): DecisionDisposition | null {
  return AUTO_SETTLEABLE.has(value) || value === 'insufficient_evidence'
    ? (value as DecisionDisposition)
    : null;
}

/**
 * Never throws: a settlement or persistence problem must not retroactively fail
 * an analysis run that already produced a valid recommendation. Problems are
 * reported as an outcome so the UI can show "needs attention" honestly.
 */
export async function applyCompletion(run: RunRecord): Promise<CompletionOutcome> {
  try {
    return await complete(run);
  } catch (error) {
    return {
      kind: 'settlement_failed',
      note: `Completion step failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function complete(run: RunRecord): Promise<CompletionOutcome> {
  const caseRecord = await getCase(run.caseId);
  if (!caseRecord) return { kind: 'none', note: 'Case no longer exists.' };

  let outcome: CompletionOutcome;

  if (run.state === 'failed') {
    const { task } = await ensureReviewTask({
      caseId: run.caseId,
      caseVersion: run.caseVersion,
      runId: run.id,
      kind: 'runtime_failure',
      reasonCodes: [run.errorCode ?? 'run_failed'],
      reasonSummary: `The automated review could not complete: ${run.errorMessage ?? 'unknown provider error'}.`,
      openQuestions: ['The three-agent review did not finish, so no recommendation exists.'],
    });
    outcome = {
      kind: 'review_task',
      taskId: task.id,
      note: 'Runtime failure routed to a reviewer.',
    };
  } else {
    const resolution = run.resolution;
    if (!resolution) {
      outcome = { kind: 'none', note: 'No resolution was recorded for this run.' };
    } else if (caseRecord.version !== run.caseVersion) {
      // The case changed after this run was recorded, so its recommendation no
      // longer describes the current evidence. Do not settle against stale analysis.
      const { task } = await ensureReviewTask({
        caseId: run.caseId,
        caseVersion: run.caseVersion,
        runId: run.id,
        kind: 'automatic_escalation',
        reasonCodes: ['case_version_changed'],
        reasonSummary: `This run analysed case v${run.caseVersion}, but the case is now v${caseRecord.version}. The recommendation cannot be applied automatically.`,
        openQuestions: ['Re-run the review against the current case version.'],
      });
      outcome = {
        kind: 'review_task',
        taskId: task.id,
        note: 'Case version changed since the run; held for review.',
      };
    } else if (resolution.requiresHumanReview || resolution.disposition === 'human_review') {
      const { task } = await ensureReviewTask({
        caseId: run.caseId,
        caseVersion: run.caseVersion,
        runId: run.id,
        kind: 'automatic_escalation',
        reasonCodes:
          resolution.escalationReasons.length > 0
            ? resolution.escalationReasons
            : ['evidence_insufficient'],
        reasonSummary:
          'The evidence did not support a deterministic outcome, so this case needs a human reviewer.',
        openQuestions: run.judge?.missingEvidence ?? [],
      });
      outcome = {
        kind: 'review_task',
        taskId: task.id,
        note: 'Escalation task created for a reviewer.',
      };
    } else {
      // Auto-resolution criteria: no existing decision, no open task, and a
      // disposition the automatic path is allowed to settle.
      const existingDecision = await effectiveDecisionForCase(run.caseId);
      if (existingDecision) {
        outcome = await recoverSettlement(caseRecord, existingDecision);
      } else {
        const openTask = await findOpenTask(run.caseId);
        if (openTask) {
          outcome = {
            kind: 'review_task',
            taskId: openTask.id,
            note: 'An open review task blocks automatic settlement.',
          };
        } else {
          const disposition = asDecisionDisposition(resolution.disposition);
          if (!disposition) {
            outcome = {
              kind: 'none',
              note: `Disposition "${resolution.disposition}" is not settleable.`,
            };
          } else {
            const decision = await recordDecision({
              caseId: run.caseId,
              caseVersion: run.caseVersion,
              runId: run.id,
              taskId: null,
              source: 'ai',
              disposition,
              targetRefundCents: resolution.recommendedRefundCents ?? 0,
              evidenceIds: resolution.judge.materialEvidenceIds,
              policyIds: resolution.judge.policyIds,
              policyVersion: resolution.policyVersion,
              explanation: resolution.judge.reasoningSummary,
              differenceFromRecommendation: null,
              reviewerId: null,
              supersedesDecisionId: null,
              chargeRef: chargeRefFor(caseRecord),
            });

            const { settlement } = await postSettlement({ caseRecord, decision });

            if (settlement.status === 'posted') {
              outcome = {
                kind: 'auto_settled',
                decisionId: decision.id,
                settlementId: settlement.id,
                note: 'Recorded an automated decision and posted the simulated settlement.',
              };
            } else {
              outcome = {
                kind: 'settlement_failed',
                decisionId: decision.id,
                settlementId: settlement.id,
                note: settlement.failureReason ?? 'The simulated settlement could not be posted.',
              };
            }
          }
        }
      }
    }
  }

  // Integrity alert is independent of the primary outcome. It never changes
  // disposition; it only ensures a human looks at tampering signals.
  if (run.integrityAssessment?.triggersReview) {
    const assessment = run.integrityAssessment;
    const { task: integrityTask, created } = await ensureReviewTask({
      caseId: run.caseId,
      caseVersion: run.caseVersion,
      runId: run.id,
      kind: 'integrity_alert',
      reasonCodes: assessment.signals.map((s) => `integrity_${s.code}`),
      reasonSummary: `Integrity assessment detected ${assessment.signals.length} signal(s) with overall severity "${assessment.overallSeverity}".`,
      openQuestions: assessment.signals.map((s) => s.explanation),
      integritySeverity: assessment.overallSeverity,
    });
    if (created) {
      outcome = {
        ...outcome,
        note: `${outcome.note} An integrity review task was also created.`,
      };
    }
    void integrityTask;
  }

  return outcome;
}

/** Helper for callers that need the charge reference without importing ledger. */
export function chargeRef(caseRecord: CaseRecord): string {
  return chargeRefFor(caseRecord);
}

/**
 * A decision that exists but has no completed settlement is not a finished case.
 *
 * Previously this branch returned "a decision already exists" and stopped, so a
 * settlement interrupted between its ledger entries and its record was never
 * retried — the case sat half-settled with nothing able to finish it.
 *
 * `postSettlement` is idempotent and resumes an interrupted posting, so calling
 * it again is the repair: it rewrites the same entry and receipt ids rather than
 * posting a second credit.
 */
async function recoverSettlement(
  caseRecord: CaseRecord,
  decision: CaseDecision,
): Promise<CompletionOutcome> {
  // A closure without a liability ruling is complete by definition — there is
  // no money to post, so there is nothing to recover.
  if (decision.disposition === 'insufficient_evidence') {
    return { kind: 'none', note: 'A closure without a ruling exists for this case.' };
  }

  const settlements = await listSettlementsForCase(caseRecord.id);
  const forDecision = settlements.find((entry) => entry.decisionId === decision.id);

  // `manual_adjustment_required` is a deliberate terminal state for a person to
  // resolve; retrying it would just re-derive the same flag.
  if (forDecision && forDecision.status !== 'pending' && forDecision.status !== 'failed') {
    return { kind: 'none', note: 'A decision and its settlement already exist for this case.' };
  }

  const { settlement, recovered } = await postSettlement({ caseRecord, decision });

  if (settlement.status === 'posted') {
    return {
      kind: 'auto_settled',
      decisionId: decision.id,
      settlementId: settlement.id,
      note: recovered
        ? 'Completed a settlement that had been left unfinished.'
        : 'Recorded the simulated settlement for the existing decision.',
    };
  }

  return {
    kind: 'settlement_failed',
    decisionId: decision.id,
    settlementId: settlement.id,
    note: settlement.failureReason ?? 'The simulated settlement could not be posted.',
  };
}
