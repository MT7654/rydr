import { describe, expect, it, vi } from 'vitest';
import { initialCheckpoint, transitionPickup, validateNavigator, assertBalanced } from '../src/domain/journeys';
import { withStorageSession } from '../src/repositories/store';
import { getCheckpoint, updateCheckpoint, listRemedies, submitRemedy, actOnRemedy, requestRepair, listRepairs } from '../src/repositories/journeys';
import { navigatorContext } from '../src/agents/navigator';
import { createAdpProvider } from '../src/providers/adp';
import { appendCaseVersion, getCase } from '../src/repositories/cases';
import { listReviewTasksForCase } from '../src/repositories/reviewTasks';
import { randomUUID } from 'node:crypto';

function isolated<T>(fn: () => Promise<T>) { return withStorageSession(randomUUID(), fn); }
const claim = { caseId: 'SYN-015', version: 1, kind: 'cleaning' as const, amountCents: 2500, note: 'Please verify the professional receipt and trip-linked sample images.', evidenceIds: ['SYN015-IMG-01','SYN015-RECEIPT'] };
async function paid() {
  let r = await submitRemedy('driver', claim);
  r = await actOnRemedy('reviewer', r.id, r.revision, { action: 'approve', verified: true, tier: 'food', note: 'Verified sample receipt, vehicle linkage, timing, responsibility and food-tier eligibility.' });
  return actOnRemedy('reviewer', r.id, r.revision, { action: 'post' });
}

describe('pickup prevention', () => {
  it('requires two independent confirmations and resets them after a changed entrance', () => {
    let c = transitionPickup(initialCheckpoint(),'rider',{ action:'entrance',entrance:'North entrance' });
    c = transitionPickup(c,'driver',{ action:'entrance',entrance:'South entrance' }); expect(c.status).toBe('mismatch');
    c = transitionPickup(c,'rider',{ action:'propose',entrance:'Taxi stand' });
    c = transitionPickup(c,'rider',{ action:'confirm' }); expect(c.status).toBe('meeting_proposed');
    expect(() => transitionPickup(c,'driver',{ action:'pickup' })).toThrow();
    c = transitionPickup(c,'driver',{ action:'confirm' }); expect(c.status).toBe('clarified');
    const reset = transitionPickup(c,'driver',{ action:'entrance',entrance:'North entrance' }); expect(reset.riderConfirmed).toBe(false);
    c = transitionPickup(c,'driver',{ action:'pickup' }); expect(c.status).toBe('picked_up');
    expect(() => transitionPickup(c,'rider',{ action:'review' })).toThrow();
  });
  it('does not allow a reviewer to impersonate a party', () => expect(() => transitionPickup(initialCheckpoint(),'reviewer',{ action:'confirm' })).toThrow());
  it('rejects stale updates and keeps new visitor rides independent', async () => {
    await isolated(async () => { const c = await updateCheckpoint('rider',1,{ action:'entrance',entrance:'North entrance' }); expect(c.revision).toBe(2);
      await expect(updateCheckpoint('driver',1,{ action:'entrance',entrance:'South entrance' })).rejects.toThrow(/changed/); });
    await isolated(async () => expect((await getCheckpoint()).riderEntrance).toBeNull());
  });
  it('preserves checkpoint reports in a separate review case with no charge', async () => isolated(async () => {
    const c = await updateCheckpoint('rider',1,{ action:'review' }); expect(c.linkedCaseId).toBe('PICKUP-001');
    const record = await getCase('PICKUP-001'); expect(record?.disputedCents).toBe(0); expect(record?.evidence[0].source.dataset).toBe('checkpoint/RIDE-001');
    expect((await listReviewTasksForCase('PICKUP-001')).length).toBe(1);
  }));
});

describe('guided evidence repair', () => {
  it('retrieves a relevant record once, creates a new version and keeps private request history scoped', async () => isolated(async () => {
    const record = await requestRepair('SYN-006',1,'C-ACCURACY','rider'); expect(record.status).toBe('retrieved'); expect(record.resultingVersion).toBe(2);
    expect((await requestRepair('SYN-006',1,'C-ACCURACY','rider')).id).toBe(record.id);
    expect((await listRepairs('SYN-006','driver')).length).toBe(0); expect((await listRepairs('SYN-006','reviewer')).length).toBe(1);
  }));
  it('routes unavailable evidence to a real reviewer task without fabricating a version', async () => isolated(async () => {
    const r = await requestRepair('SYN-008',1,'C-ACCURACY','rider'); expect(r.status).toBe('unavailable'); expect(r.resultingVersion).toBeNull(); expect(r.taskId).toBeTruthy();
  }));
  it('rejects stale case versions and invented repair conditions', async () => isolated(async () => {
    await expect(requestRepair('SYN-006',2,'C-ACCURACY','rider')).rejects.toThrow(/changed/);
    await expect(requestRepair('SYN-006',1,'invented','rider')).rejects.toThrow(/available/);
  }));
});

describe('independent remedies and accounting', () => {
  it('posts driver reimbursement before recovery and keeps it after failed collection', async () => isolated(async () => {
    let r = await paid(); expect(r.status).toBe('posted'); expect(r.recovery).toBe('pending'); expect(r.entries.length).toBe(2);
    r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'fail_recovery' }); expect(r.status).toBe('posted'); expect(r.entries.length).toBe(2); assertBalanced(r.entries);
  }));
  it('reuses duplicate submissions and posts exactly once under concurrent retries', async () => isolated(async () => {
    const [a,b] = await Promise.all([submitRemedy('driver',claim),submitRemedy('driver',claim)]); expect(a.id).toBe(b.id);
    const approved = await actOnRemedy('reviewer',a.id,a.revision,{ action:'approve',verified:true,tier:'food',note:'Verified sample receipt, deadline, vehicle and responsibility.' });
    await Promise.all([actOnRemedy('reviewer',a.id,approved.revision,{ action:'post' }),actOnRemedy('reviewer',a.id,approved.revision,{ action:'post' })]);
    expect((await listRemedies())[0].entries.length).toBe(2);
  }));
  it('cannot approve without verification, exceed a tier cap, or bypass reviewer authority', async () => isolated(async () => {
    const r = await submitRemedy('driver',{ ...claim, amountCents:5000 });
    await expect(actOnRemedy('driver',r.id,r.revision,{ action:'approve' })).rejects.toThrow(/reviewer/);
    await expect(actOnRemedy('reviewer',r.id,r.revision,{ action:'approve',verified:false,tier:'food',note:'Inspected professional sample records.' })).rejects.toThrow(/Verification/);
    await expect(actOnRemedy('reviewer',r.id,r.revision,{ action:'approve',verified:true,tier:'food',note:'Inspected professional sample records.' })).rejects.toThrow(/cap/);
  }));
  it('cannot approve an unlinked cleaning receipt or pay before approval', async () => isolated(async () => {
    const r = await submitRemedy('driver',{ ...claim, evidenceIds:['SYN015-IMG-01'] });
    await expect(actOnRemedy('reviewer',r.id,r.revision,{ action:'post' })).rejects.toThrow(/approval/);
    await expect(actOnRemedy('reviewer',r.id,r.revision,{ action:'approve',verified:true,tier:'food',note:'Inspected professional sample records.' })).rejects.toThrow(/receipt/);
  }));
  it('does not allow unauthorized roles to exploit completed-operation retry paths', async () => isolated(async () => {
    const r = await paid(); await expect(actOnRemedy('rider',r.id,r.revision,{ action:'post' })).rejects.toThrow(/reviewer/);
  }));
  it('records recovery separately and never reimburses the driver twice', async () => isolated(async () => {
    let r = await paid(); r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'recover' });
    const repeat = await actOnRemedy('reviewer',r.id,1,{ action:'recover' }); expect(repeat.entries.length).toBe(4);
    expect(repeat.entries.filter(e => e.account === 'driver').length).toBe(1); assertBalanced(repeat.entries);
  }));
  it('holds disputed recovery and allows a reviewed waiver while preserving payment', async () => isolated(async () => {
    let r = await paid(); r = await actOnRemedy('rider',r.id,r.revision,{ action:'dispute',note:'I dispute responsibility and request verification of trip linkage.' });
    await expect(actOnRemedy('reviewer',r.id,r.revision,{ action:'recover' })).rejects.toThrow(/undisputed/);
    r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'waive_recovery',verified:true,note:'After reviewing the rider challenge, platform bears the unresolved cost.' });
    expect(r.status).toBe('posted'); expect(r.recovery).toBe('not_applicable'); expect(r.entries.length).toBe(2);
    await expect(actOnRemedy('reviewer',r.id,r.revision,{ action:'recover' })).rejects.toThrow(/undisputed/);
  }));
  it('corrects a partially reduced award and reverses excess rider recovery without rewriting history', async () => isolated(async () => {
    let r = await paid(); r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'recover' });
    const original = structuredClone(r.entries);
    r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'adjust',amountCents:1500,verified:true,tier:'food',note:'Reviewed correction reduces the professional cleaning amount to S$15.' });
    expect(r.entries.slice(0,4)).toEqual(original); expect(r.entries.length).toBe(8); expect(r.amountCents).toBe(1500); assertBalanced(r.entries);
  }));
  it('collects only the remaining delta after an increased reviewed award', async () => isolated(async () => {
    let r = await paid(); r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'recover' });
    r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'adjust',amountCents:3000,verified:true,tier:'food',note:'Reviewed receipt correction increases the professional cleaning amount.' });
    expect(r.recovery).toBe('pending'); r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'recover' });
    expect(r.entries.at(-1)?.amountCents).toBe(500); assertBalanced(r.entries);
  }));
  it('rejects stale approvals after the case changes', async () => isolated(async () => {
    const r = await submitRemedy('driver',claim); await appendCaseVersion('SYN-015',c => c,'New evidence received.');
    await expect(actOnRemedy('reviewer',r.id,r.revision,{ action:'approve',verified:true,tier:'food',note:'Inspected professional sample records.' })).rejects.toThrow(/changed/);
  }));
  it('requires reviewer authority and a capped proposed basis for goodwill', async () => isolated(async () => {
    const input = { ...claim, kind:'goodwill' as const, amountCents:500, evidenceIds:[] };
    await expect(submitRemedy('driver',input)).rejects.toThrow(/role/); await expect(submitRemedy('reviewer',{ ...input,amountCents:501 })).rejects.toThrow();
    let r = await submitRemedy('reviewer',input); r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'approve',verified:true,note:'Authorize platform goodwill without attributing responsibility.' });
    r = await actOnRemedy('reviewer',r.id,r.revision,{ action:'post' }); expect(r.policyVersion).toBe('proposed-goodwill-v1'); expect(r.entries[1].account).toBe('rider'); assertBalanced(r.entries);
  }));
  it('isolates financial records between visitors', async () => { await isolated(paid); await isolated(async () => expect(await listRemedies()).toEqual([])); });
});

describe('Navigator contract and privacy', () => {
  const context = { actions:[{ id:'repair',label:'Request record',href:'/cases/SYN-006/repair',sourceOwner:'platform' as const,findingIds:['F1'] }], findingIds:['F1'],evidenceIds:['E1'],policyIds:['P1'] };
  const output = { schemaVersion:'rydr-navigator-v1',status:'action_recommended',message:'Request the platform record to clarify this finding.',matchedFindingIds:['F1'],recommendedActionId:'repair',sourceOwner:'platform',clarificationQuestion:null,evidenceIds:['E1'],policyIds:['P1'] };
  it('accepts an allowed recommendation but rejects invented actions, references and owners', () => {
    expect(validateNavigator(output,context).recommendedActionId).toBe('repair');
    for (const edit of [{ recommendedActionId:'pay-now' },{ evidenceIds:['secret'] },{ sourceOwner:'rider' },{ matchedFindingIds:['unknown'] },{ policyIds:['fake'] }]) expect(() => validateNavigator({ ...output,...edit },context)).toThrow();
  });
  it('does not allow an action alongside clarification or an unsolicited output field', () => {
    expect(() => validateNavigator({ ...output,status:'clarification_needed',clarificationQuestion:'Which entrance?' },context)).toThrow();
    expect(() => validateNavigator({ ...output,executedPayment:true },context)).toThrow();
  });
  it('filters other-party communications and excludes private appeal/payment approval notes', async () => isolated(async () => {
    const c = await navigatorContext('rider','case','SYN-015'); expect(c.actions.every(a => a.href.startsWith('/'))).toBe(true);
    await paid(); const payment = JSON.stringify((await navigatorContext('rider','payments')).context); expect(payment).not.toContain('Verified sample receipt'); expect(payment).not.toContain('approvalNote');
  }));
  it('routes the Navigator role to its own AppKey without reading another role key', async () => {
    vi.stubEnv('RYDR_ADP_NAVIGATOR_APPKEY','test-navigator-key');
    let body: Record<string,unknown> = {};
    vi.stubGlobal('fetch',async (_url: unknown,options: RequestInit) => { body = JSON.parse(String(options.body));
      return new Response('data: '+JSON.stringify({ Type:'response.completed',Response:{ Messages:[{ Type:'reply',Contents:[{ Text:JSON.stringify(output) }] }] } })+'\n\n', { status:200 }); });
    try { await createAdpProvider('https://example.test/adp').invoke({ role:'navigator',stage:'navigate',runId:'test',systemInstruction:'Test contract',input:{},allowedEvidenceIds:[],timeoutMs:1000,maxOutputTokens:100 }); expect(body.AppKey).toBe('test-navigator-key'); }
    finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
