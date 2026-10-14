import { describe, expect, it } from 'vitest';
import type {
  CaseDecision,
  EvidenceRequest,
  ReviewTask,
  Settlement,
} from '../src/domain/contracts';
import {
  deriveWorkspaceView,
  isOpenTask,
  otherOpenTasks,
  selectWorkspaceTask,
  stageProgress,
  type WorkspaceInput,
} from '../src/domain/workspace';
import { buildActionRegistry, starterPrompts } from '../src/domain/workspaceActions';
import type { DemoRole } from '../src/domain/demoAccess';

const NOW = '2026-10-09T02:00:00.000Z';

function task(overrides: Partial<ReviewTask> & { kind: ReviewTask['kind'] }): ReviewTask {
  return {
    id: `task_${overrides.kind}_${Math.random().toString(36).slice(2, 6)}`,
    caseId: 'DISP-002',
    caseVersion: 1,
    runId: 'run_1',
    status: 'queued',
    assigneeId: null,
    reasonCodes: [],
    reasonSummary: 'Test task',
    openQuestions: [],
    linkedDecisionId: null,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function request(overrides: Partial<EvidenceRequest>): EvidenceRequest {
  return {
    id: `evreq_${Math.random().toString(36).slice(2, 6)}`,
    taskId: 'task_1',
    caseId: 'DISP-002',
    recipient: 'driver',
    question: 'Where were you at 14:05?',
    evidenceType: 'gps',
    whyItMatters: 'The arrival time is disputed.',
    status: 'open',
    responseNote: null,
    structuredResponse: null,
    acceptedIntoCaseVersion: null,
    responseVerification: null,
    responseEvidenceIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function decision(overrides: Partial<CaseDecision> = {}): CaseDecision {
  return {
    id: 'dec_1',
    caseId: 'DISP-002',
    caseVersion: 1,
    runId: 'run_1',
    taskId: null,
    source: 'reviewer',
    disposition: 'refund',
    targetRefundCents: 500,
    evidenceIds: [],
    policyIds: [],
    policyVersion: 'rydr_demo_v1',
    explanation: 'Refunded.',
    differenceFromRecommendation: null,
    reviewerId: 'reviewer_demo_01',
    supersedesDecisionId: null,
    chargeRef: 'charge_1',
    createdAt: NOW,
    ...overrides,
  };
}

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 'set_1',
    caseId: 'DISP-002',
    decisionId: 'dec_1',
    chargeRef: 'charge_1',
    mode: 'simulation',
    status: 'posted',
    originalChargeCents: 500,
    targetRefundCents: 500,
    deltaRefundCents: 500,
    retainedCents: 0,
    ledgerEntryIds: [],
    idempotencyKey: 'idem_1',
    failureReason: null,
    postedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function input(overrides: Partial<WorkspaceInput> = {}): WorkspaceInput {
  return {
    caseId: 'DISP-002',
    role: 'reviewer',
    currentCaseVersion: 1,
    displayedCaseVersion: 1,
    historical: false,
    status: 'open',
    runState: null,
    hasRun: false,
    runStaleAgainstCurrentVersion: false,
    runMissingForCurrentVersion: false,
    tasks: [],
    selectedTaskId: null,
    evidenceRequests: [],
    effectiveDecision: null,
    settlements: [],
    hasOpenAppeal: false,
    ...overrides,
  };
}

describe('task selection', () => {
  it('prefers an active appeal over other open tasks', () => {
    const appeal = task({ kind: 'appeal', status: 'queued' });
    const escalation = task({ kind: 'automatic_escalation', status: 'ready' });
    const selected = selectWorkspaceTask([escalation, appeal], null);
    expect(selected?.id).toBe(appeal.id);
  });

  it('honours an explicit still-valid task id', () => {
    const appeal = task({ kind: 'appeal', status: 'queued' });
    const escalation = task({ kind: 'automatic_escalation', status: 'ready' });
    const selected = selectWorkspaceTask([escalation, appeal], escalation.id);
    expect(selected?.id).toBe(escalation.id);
  });

  it('ignores an explicit id that is no longer valid and falls back', () => {
    const escalation = task({ kind: 'automatic_escalation', status: 'ready' });
    const selected = selectWorkspaceTask([escalation], 'task_missing');
    expect(selected?.id).toBe(escalation.id);
  });

  it('never selects a closed task as the actionable one', () => {
    const closed = task({ kind: 'appeal', status: 'decided' });
    expect(selectWorkspaceTask([closed], null)).toBeNull();
  });

  it('keeps non-primary tasks accessible through a selector', () => {
    const appeal = task({ kind: 'appeal', status: 'queued' });
    const escalation = task({ kind: 'automatic_escalation', status: 'ready' });
    const others = otherOpenTasks([appeal, escalation], appeal.id);
    expect(others.map((entry) => entry.id)).toEqual([escalation.id]);
    expect(isOpenTask(escalation)).toBe(true);
  });
});

describe('reviewer derivation', () => {
  it('offers an assessment for an unassessed case', () => {
    const view = deriveWorkspaceView(input({ role: 'reviewer' }));
    expect(view.primaryAction?.id).toBe('run-assessment');
    expect(view.nextActor).toBe('reviewer');
    expect(view.businessStatus).toBe('open');
  });

  it('offers reassessment when the displayed run predates the current version', () => {
    const view = deriveWorkspaceView(
      input({ role: 'reviewer', hasRun: true, runStaleAgainstCurrentVersion: true }),
    );
    expect(view.primaryAction?.id).toBe('reassess');
  });

  it('routes an active appeal ahead of other tasks and explains the waiting state', () => {
    const appeal = task({ kind: 'appeal', status: 'queued', submittedBy: 'driver' });
    const view = deriveWorkspaceView(
      input({ role: 'reviewer', status: 'appeal_pending', hasOpenAppeal: true, tasks: [appeal] }),
    );
    expect(view.primaryAction?.id).toBe('review-appeal');
    expect(view.primaryAction?.taskId).toBe(appeal.id);
    expect(view.nextActor).toBe('reviewer');
  });

  it('shows a waiting state — not a fake enabled action — while evidence is outstanding', () => {
    const awaiting = task({ kind: 'automatic_escalation', status: 'awaiting_evidence' });
    const view = deriveWorkspaceView(
      input({ role: 'reviewer', status: 'awaiting_evidence', tasks: [awaiting] }),
    );
    expect(view.primaryAction?.id).toBe('await-party');
    expect(view.primaryAction?.enabled).toBe(false);
    expect(view.primaryAction?.disabledReason).toBeTruthy();
    expect(view.nextActor).not.toBe('reviewer');
  });

  it('offers response review once a structured response is submitted', () => {
    const awaiting = task({ kind: 'automatic_escalation', status: 'awaiting_evidence' });
    const submitted = request({
      taskId: awaiting.id,
      status: 'submitted',
      structuredResponse: {
        kind: 'gps_accuracy',
        sampleIds: ['ev_gps_1'],
        accuracyMeters: 12,
        provenanceNote: 'From my phone.',
      },
    });
    const view = deriveWorkspaceView(
      input({
        role: 'reviewer',
        status: 'awaiting_evidence',
        tasks: [awaiting],
        evidenceRequests: [submitted],
      }),
    );
    expect(view.primaryAction?.id).toBe('review-response');
    expect(view.primaryAction?.requestId).toBe(submitted.id);
  });

  it('offers a decision when the task is ready', () => {
    const ready = task({ kind: 'automatic_escalation', status: 'ready' });
    const view = deriveWorkspaceView(
      input({ role: 'reviewer', status: 'ready_for_decision', tasks: [ready] }),
    );
    expect(view.primaryAction?.id).toBe('make-decision');
    expect(view.primaryAction?.expectedTaskRevision).toBe(ready.revision);
  });

  it('surfaces financial attention as a secondary action without erasing the appeal state', () => {
    const appeal = task({ kind: 'appeal', status: 'queued' });
    const view = deriveWorkspaceView(
      input({
        role: 'reviewer',
        status: 'appeal_pending',
        hasOpenAppeal: true,
        tasks: [appeal],
        effectiveDecision: decision(),
        settlements: [settlement({ status: 'manual_adjustment_required' })],
      }),
    );
    expect(view.primaryAction?.id).toBe('review-appeal');
    expect(view.secondaryActions.map((action) => action.id)).toContain('view-payments');
  });
});

describe('party derivation and role boundaries', () => {
  it('shows a read-only tracking state for an unassessed case', () => {
    const view = deriveWorkspaceView(input({ role: 'rider' }));
    expect(view.primaryAction?.id).toBe('view-brief');
    expect(view.nextActor).toBe('reviewer');
  });

  it('makes responding the primary action only for the addressed party', () => {
    const addressed = request({ recipient: 'rider' });
    const riderView = deriveWorkspaceView(
      input({ role: 'rider', status: 'awaiting_evidence', tasks: [task({id:addressed.taskId,kind:"party_request",status:"awaiting_evidence"})], evidenceRequests: [addressed] }),
    );
    expect(riderView.primaryAction?.id).toBe('respond-to-request');
    expect(riderView.nextActor).toBe('rider');

    const driverView = deriveWorkspaceView(
      input({ role: 'driver', status: 'awaiting_evidence', tasks: [task({id:addressed.taskId,kind:"party_request",status:"awaiting_evidence"})], evidenceRequests: [addressed] }),
    );
    expect(driverView.primaryAction?.id).not.toBe('respond-to-request');
  });

  it('offers an appeal after a decision, but not while one is already open', () => {
    const decided = deriveWorkspaceView(
      input({ role: 'driver', status: 'settled', effectiveDecision: decision() }),
    );
    expect(decided.primaryAction?.id).toBe('view-outcome'); expect(decided.secondaryActions.some(a=>a.id==='submit-appeal')).toBe(true);

    const pending = deriveWorkspaceView(
      input({
        role: 'driver',
        status: 'appeal_pending',
        hasOpenAppeal: true,
        effectiveDecision: decision(),
      }),
    );
    expect(pending.primaryAction?.id).toBe('view-outcome');
    expect(pending.nextActor).toBe('reviewer');
  });

  it('never derives a reviewer action for a party', () => {
    const ready = task({ kind: 'automatic_escalation', status: 'ready' });
    for (const role of ['rider', 'driver'] as DemoRole[]) {
      const view = deriveWorkspaceView(
        input({ role, status: 'ready_for_decision', tasks: [ready] }),
      );
      const ids = [view.primaryAction?.id, ...view.secondaryActions.map((a) => a.id)];
      expect(ids).not.toContain('make-decision');
      expect(ids).not.toContain('review-appeal');
      expect(ids).not.toContain('run-assessment');
    }
  });

  it('returns a read-only historical view with no mutation target', () => {
    const view = deriveWorkspaceView(
      input({
        role: 'reviewer',
        historical: true,
        displayedCaseVersion: 1,
        currentCaseVersion: 2,
        hasRun: true,
        tasks: [task({ kind: 'automatic_escalation', status: 'ready' })],
      }),
    );
    expect(view.primaryAction?.id).toBe('return-to-current');
    expect(view.primaryAction?.expectedCaseVersion).toBe(2);
    expect(view.nextActionExplanation).toMatch(/historical/i);
  });
});

describe('action registry', () => {
  const base = {
    caseId: 'DISP-002',
    findings: [{ id: 'f1', text: 'Arrival time conflicts.', material: true }],
    evidenceIds: ['ev_gps_1', 'ev_chat_1'],
    policyIds: ['DM-01'],
    tasks: [],
    evidenceRequests: [],
  };

  it('registers a decision form for a reviewer with an open task and none for a party', () => {
    const ready = task({ kind: 'automatic_escalation', status: 'ready' });
    const reviewerView = deriveWorkspaceView(
      input({ role: 'reviewer', status: 'ready_for_decision', tasks: [ready] }),
    );
    const reviewerRegistry = buildActionRegistry({ ...base, view: reviewerView, tasks: [ready] });
    const reviewerTargets = reviewerRegistry.actions.map((action) => action.target.kind);
    expect(reviewerTargets).toContain('decision-form');

    const partyView = deriveWorkspaceView(input({ role: 'driver', status: 'ready_for_decision', tasks: [ready] }));
    const partyRegistry = buildActionRegistry({ ...base, view: partyView, tasks: [ready] });
    const partyTargets = partyRegistry.actions.map((action) => action.target.kind);
    expect(partyTargets).not.toContain('decision-form');
    expect(partyTargets).not.toContain('appeal-review');
    expect(partyTargets).not.toContain('response-review');
  });

  it('registers a respond form only for the addressed party', () => {
    const addressed = request({ recipient: 'driver' });
    const driverView = deriveWorkspaceView(
      input({ role: 'driver', status: 'awaiting_evidence', tasks: [task({id:addressed.taskId,kind:"party_request",status:"awaiting_evidence"})], evidenceRequests: [addressed] }),
    );
    const registry = buildActionRegistry({
      ...base,
      view: driverView,
      tasks: [task({id:addressed.taskId,kind:"party_request",status:"awaiting_evidence"})], evidenceRequests: [addressed],
    });
    const respond = registry.actions.find((action) => action.target.kind === 'respond-form');
    expect(respond?.target).toEqual({
      kind: 'respond-form',
      taskId: addressed.taskId,
      requestId: addressed.id,
    });
  });

  it('limits visible starter prompts to three', () => {
    const appeal = task({ kind: 'appeal', status: 'queued' });
    const view = deriveWorkspaceView(
      input({ role: 'reviewer', status: 'appeal_pending', hasOpenAppeal: true, tasks: [appeal] }),
    );
    const prompts = starterPrompts({
      view,
      findings: [{ id: 'f1', text: 'conflict', material: true }],
      tasks: [appeal],
      evidenceRequests: [request({ status: 'submitted' })],
    });
    expect(prompts.length).toBeLessThanOrEqual(3);
    expect(prompts).toContain('Compare the appeal with the original decision');
  });
});

describe('stage progress', () => {
  it('does not claim evidence is unnecessary before assessment',()=>{const stages=stageProgress({status:'open',hasDecision:false,hasAppeal:false,hasOpenEvidenceRequest:false});expect(stages.find(s=>s.stage==='Evidence')).toMatchObject({state:'upcoming',detail:'Not requested yet'});});
  it('marks evidence as not required when no request is open', () => {
    const progress = stageProgress({
      status: 'ready_for_decision',
      hasDecision: false,
      hasAppeal: false,
      hasOpenEvidenceRequest: false,
    });
    const evidence = progress.find((entry) => entry.stage === 'Evidence');
    expect(evidence?.state).toBe('skipped');
    expect(evidence?.detail).toBe('Not needed for this decision');
  });

  it('shows appeal review on the decision stage when an appeal is open', () => {
    const progress = stageProgress({
      status: 'appeal_pending',
      hasDecision: true,
      hasAppeal: true,
      hasOpenEvidenceRequest: false,
    });
    const decision = progress.find((entry) => entry.stage === 'Decision');
    expect(decision?.detail).toBe('Appeal review open');
  });
});
