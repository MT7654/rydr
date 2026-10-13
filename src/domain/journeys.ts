import { z } from 'zod';
import type { DemoRole } from './demoAccess';

export const EntranceSchema = z.enum(['North entrance', 'South entrance', 'Taxi stand']);
export const CheckpointSchema = z.object({
  id: z.literal('RIDE-001'), revision: z.number().int().positive(),
  pickup: z.string(), riderEntrance: EntranceSchema.nullable(), driverEntrance: EntranceSchema.nullable(),
  meetingPoint: EntranceSchema.nullable(), riderConfirmed: z.boolean(), driverConfirmed: z.boolean(),
  status: z.enum(['awaiting_confirmation', 'mismatch', 'meeting_proposed', 'clarified', 'picked_up', 'review_requested']),
  events: z.array(z.object({ at: z.string(), actor: z.enum(['rider','driver','reviewer','system']), text: z.string() })),
  linkedCaseId: z.string().nullable(),
  policyId: z.string().default('ryde-on-demand-no-show-20261002'),
  bookingType: z.literal('on_demand').default('on_demand'),
  contactAttempts: z.number().int().nonnegative().default(0),
  playbackSeconds: z.number().int().min(0).max(900).nullable().default(null),
  safetyReported: z.boolean().default(false),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type PickupAction = { action: 'entrance' | 'propose' | 'confirm' | 'pickup' | 'review' | 'contact' | 'playback' | 'safety'; entrance?: string; seconds?:number };

export function initialCheckpoint(): Checkpoint {
  return { id: 'RIDE-001', revision: 1, pickup: 'Orchard Central', riderEntrance: null,
    driverEntrance: null, meetingPoint: null, riderConfirmed: false, driverConfirmed: false,
    status: 'awaiting_confirmation', linkedCaseId: null, policyId:'ryde-on-demand-no-show-20261002', bookingType:'on_demand', contactAttempts:0,playbackSeconds:null,safetyReported:false,
    events: [{ at: new Date().toISOString(), actor: 'system', text: 'Sample ride opened. Arrival and access have not been verified.' }] };
}

export function transitionPickup(current: Checkpoint, role: DemoRole, input: PickupAction): Checkpoint {
  if (role === 'reviewer') throw new Error('Choose a rider or driver role to respond to this pickup.');
  if (current.status === 'picked_up' || current.status === 'review_requested') throw new Error('This pickup is closed.');
  const next = structuredClone(current);
  let text = '';
  if (input.action === 'contact') {
    if (role !== 'driver') throw new Error('The driver records their own contact attempt.');
    next.contactAttempts += 1; text = 'Driver reported an in-app contact attempt. Delivery and rider response are not verified.';
  } else if (input.action === 'playback') {
    if (role !== 'driver') throw new Error('Choose the driver role for sample event playback.');
    next.playbackSeconds = z.number().int().min(0).max(900).parse(input.seconds);
    text = `Played synthetic arrival-to-cancellation records at ${next.playbackSeconds} seconds. This is an eligibility preview; no charge was posted.`;
  } else if (input.action === 'safety') {
    next.safetyReported = true; next.status = 'review_requested';
    text = 'Party reported feeling unsafe. Normal pickup actions stopped and safety review was requested.';
  } else if (input.action === 'entrance') {
    const entrance = EntranceSchema.parse(input.entrance);
    if (role === 'rider') next.riderEntrance = entrance; else next.driverEntrance = entrance;
    next.meetingPoint = null; next.riderConfirmed = false; next.driverConfirmed = false;
    next.status = next.riderEntrance && next.driverEntrance && next.riderEntrance !== next.driverEntrance
      ? 'mismatch' : 'awaiting_confirmation';
    text = `${role === 'rider' ? 'Rider' : 'Driver'} reported ${entrance}. This is a party statement.`;
  } else if (input.action === 'propose') {
    if (!next.riderEntrance || !next.driverEntrance) throw new Error('Both parties must report an entrance first.');
    next.meetingPoint = EntranceSchema.parse(input.entrance);
    next.riderConfirmed = false; next.driverConfirmed = false; next.status = 'meeting_proposed';
    text = `${role === 'rider' ? 'Rider' : 'Driver'} proposed meeting at ${next.meetingPoint}.`;
  } else if (input.action === 'confirm') {
    if (!next.meetingPoint) throw new Error('Propose a meeting point first.');
    if (role === 'rider') next.riderConfirmed = true; else next.driverConfirmed = true;
    next.status = next.riderConfirmed && next.driverConfirmed ? 'clarified' : 'meeting_proposed';
    text = `${role === 'rider' ? 'Rider' : 'Driver'} confirmed the proposed meeting point.`;
  } else if (input.action === 'pickup') {
    if (role !== 'driver' || next.status !== 'clarified') throw new Error('Both parties must confirm before the driver records pickup.');
    next.status = 'picked_up'; text = 'Driver recorded pickup after both parties confirmed. No no-show charge was posted.';
  } else {
    next.status = 'review_requested'; text = 'Pickup concern sent to review; no fee or finding of responsibility was created.';
  }
  next.revision += 1;
  next.events.push({ at: new Date().toISOString(), actor: role, text });
  return CheckpointSchema.parse(next);
}

export const NavigatorActionSchema = z.object({ id: z.string(), label: z.string(), href: z.string(),
  sourceOwner: z.enum(['platform','rider','driver','policy_owner','reviewer']).nullable(), findingIds: z.array(z.string()),
  /** Optional inline target. The model never generates this; the app resolves it. */
  target: z.unknown().optional() });
export type NavigatorAction = z.infer<typeof NavigatorActionSchema>;

/** A UI destination the application resolves for an allowlisted action id. */
export const ActionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), evidenceId: z.string().min(1) }),
  z.object({ kind: z.literal('policy'), policyId: z.string().min(1) }),
  z.object({ kind: z.literal('request-form'), taskId: z.string().min(1) }),
  z.object({ kind: z.literal('respond-form'), taskId: z.string().min(1), requestId: z.string().min(1) }),
  z.object({ kind: z.literal('response-review'), taskId: z.string().min(1), requestId: z.string().min(1) }),
  z.object({ kind: z.literal('decision-form'), taskId: z.string().min(1) }),
  z.object({ kind: z.literal('appeal-review'), taskId: z.string().min(1) }),
  z.object({ kind: z.literal('appeal-form') }),
  z.object({ kind: z.literal('outcome') }),
]);
export type ActionTarget = z.infer<typeof ActionTargetSchema>;

export const NavigatorOutputSchema = z.object({
  schemaVersion: z.literal('rydr-navigator-v1'),
  status: z.enum(['action_recommended','clarification_needed','no_supported_action']),
  message: z.string().min(1).max(450), matchedFindingIds: z.array(z.string()).max(8),
  recommendedActionId: z.string().nullable(),
  sourceOwner: z.enum(['platform','rider','driver','policy_owner','reviewer']).nullable(),
  clarificationQuestion: z.string().min(1).max(250).nullable(), evidenceIds: z.array(z.string()).max(15), policyIds: z.array(z.string()).max(15),
}).strict();
export type NavigatorOutput = z.infer<typeof NavigatorOutputSchema>;

/**
 * V2 adds an optional AI-written evidence-request draft.
 *
 * A draft is text the user must inspect and submit. It can never set verified
 * status, case version, refund amount or task ownership.
 */
export const NavigatorRequestDraftSchema = z.object({
  actionId: z.string().min(1),
  recipient: z.enum(['rider', 'driver', 'platform']),
  question: z.string().min(1).max(500),
  whyItMatters: z.string().min(1).max(350),
  evidenceType: z.string().min(1),
}).strict();
export type NavigatorRequestDraft = z.infer<typeof NavigatorRequestDraftSchema>;

export const NavigatorOutputV2Schema = z.object({
  schemaVersion: z.literal('rydr-navigator-v2'),
  status: z.enum(['action_recommended','clarification_needed','no_supported_action']),
  message: z.string().min(1).max(450), matchedFindingIds: z.array(z.string()).max(8),
  recommendedActionId: z.string().nullable(),
  sourceOwner: z.enum(['platform','rider','driver','policy_owner','reviewer']).nullable(),
  clarificationQuestion: z.string().min(1).max(250).nullable(),
  evidenceIds: z.array(z.string()).max(15), policyIds: z.array(z.string()).max(15),
  requestDraft: NavigatorRequestDraftSchema.nullable(),
}).strict();
export type NavigatorOutputV2 = z.infer<typeof NavigatorOutputV2Schema>;

export interface NavigatorValidationContext {
  actions: NavigatorAction[];
  findingIds: string[];
  evidenceIds: string[];
  policyIds: string[];
  /** Recipients a drafted request may target. Absent means none are permitted. */
  permittedRecipients?: ('rider' | 'driver' | 'platform')[];
  /** Evidence kinds a drafted request may name. */
  permittedEvidenceTypes?: string[];
}

const EXECUTION_CLAIM =
  /\bI (?:have )?(?:paid|refunded|transferred|approved|settled)\b|\b(?:guaranteed refund|bank transfer (?:completed|successful))\b/i;

function assertCommon(output: { status: string; message: string; matchedFindingIds: string[]; evidenceIds: string[]; policyIds: string[]; recommendedActionId: string | null; sourceOwner: string | null; clarificationQuestion: string | null }, context: NavigatorValidationContext) {
  if (EXECUTION_CLAIM.test(output.message)) {
    throw new Error('Navigator cannot claim execution or promise a financial result.');
  }
  for (const [refs, valid] of [
    [output.matchedFindingIds, context.findingIds],
    [output.evidenceIds, context.evidenceIds],
    [output.policyIds, context.policyIds],
  ] as [string[], string[]][]) {
    if (refs.some((id) => !valid.includes(id))) throw new Error('Navigator returned an unavailable reference.');
  }
  const selected = context.actions.find((action) => action.id === output.recommendedActionId);
  if (output.status === 'action_recommended') {
    if (!selected || output.sourceOwner !== selected.sourceOwner || output.clarificationQuestion !== null) {
      throw new Error('Navigator recommended an unavailable action.');
    }
  } else if (output.recommendedActionId !== null || output.sourceOwner !== null) {
    throw new Error('No action may accompany clarification or an unsupported concern.');
  }
  if ((output.status === 'clarification_needed') !== (output.clarificationQuestion !== null)) {
    throw new Error('Navigator clarification does not match its status.');
  }
  return selected ?? null;
}

export function validateNavigator(raw: unknown, context: NavigatorValidationContext): NavigatorOutput {
  const output = NavigatorOutputSchema.parse(raw);
  assertCommon(output, context);
  return output;
}

/**
 * V2 validation. Rejects unknown ids, mismatched recipients, unsupported
 * evidence types and a draft that is not tied to the recommended request-form
 * action. A draft never accompanies a clarification or an unsupported concern.
 */
export function validateNavigatorV2(
  raw: unknown,
  context: NavigatorValidationContext,
): NavigatorOutputV2 {
  const output = NavigatorOutputV2Schema.parse(raw);
  const selected = assertCommon(output, context);

  if (output.requestDraft === null) return output;

  if (output.status !== 'action_recommended' || !selected) {
    throw new Error('A request draft may only accompany a recommended action.');
  }
  const target = selected.target as { kind?: string } | undefined;
  if (!target || target.kind !== 'request-form') {
    throw new Error('The recommended action does not support a request draft.');
  }
  if (output.requestDraft.actionId !== output.recommendedActionId) {
    throw new Error('The draft must belong to the recommended action.');
  }
  const recipients = context.permittedRecipients ?? [];
  if (!recipients.includes(output.requestDraft.recipient)) {
    throw new Error('The draft names a recipient this action does not permit.');
  }
  const kinds = context.permittedEvidenceTypes ?? [];
  if (kinds.length > 0 && !kinds.includes(output.requestDraft.evidenceType)) {
    throw new Error('The draft names an unsupported evidence type.');
  }
  return output;
}

/**
 * Accepts either schema version. A valid v1 response remains useful for
 * explanation and action selection but carries no AI-written draft.
 */
export function validateNavigatorAny(
  raw: unknown,
  context: NavigatorValidationContext,
): NavigatorOutput | NavigatorOutputV2 {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === 'rydr-navigator-v2') return validateNavigatorV2(raw, context);
  if (version === 'rydr-navigator-v1') return validateNavigator(raw, context);
  throw new Error('Navigator returned an unrecognised response version.');
}

export const RemedySchema = z.object({
  id: z.string(), caseId: z.string(), caseVersion: z.number().int().positive(), revision: z.number().int().positive(),
  kind: z.enum(['cleaning','goodwill']), amountCents: z.number().int().positive(),
  status: z.enum(['submitted','approved','posted','rejected']),
  recovery: z.enum(['not_applicable','pending','received','failed','disputed']),
  policyIds: z.array(z.string()), policyVersion: z.string(), evidenceIds: z.array(z.string()),
  note: z.string(), approvalNote: z.string().nullable(), reviewer: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
  entries: z.array(z.object({ id: z.string(), transaction: z.string(), account: z.enum(['driver','rider','platform_cleaning_expense','platform_cash','platform_recovery','platform_goodwill_expense']),
    direction: z.enum(['debit','credit']), amountCents: z.number().int().nonnegative() })),
  events: z.array(z.object({ at: z.string(), text: z.string() })),
});
export type Remedy = z.infer<typeof RemedySchema>;
export const CLEANING_CAPS = { food: 4000, stains: 12000, vomit: 20000 } as const;
export const GOODWILL_CAP_CENTS = 500;
export function assertBalanced(entries: Remedy['entries']) {
  for (const transaction of new Set(entries.map(e => e.transaction))) {
    const lines = entries.filter(e => e.transaction === transaction);
    const sum = lines.reduce((total, e) => total + (e.direction === 'debit' ? e.amountCents : -e.amountCents), 0);
    if (sum !== 0 || lines.length < 2) throw new Error('Financial transaction does not balance.');
  }
}
