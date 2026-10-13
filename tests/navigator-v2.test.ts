import { describe, expect, it } from 'vitest';
import {
  validateNavigator,
  validateNavigatorAny,
  validateNavigatorV2,
  type NavigatorAction,
} from '../src/domain/journeys';

const actions: NavigatorAction[] = [
  {
    id: 'draft-request',
    label: 'Draft a targeted request',
    href: '/cases/DISP-002?section=evidence#request-form',
    sourceOwner: 'reviewer',
    findingIds: ['f1'],
    target: { kind: 'request-form', taskId: 'task_1' },
  },
  {
    id: 'view-source:ev_gps_1',
    label: 'Inspect this source record',
    href: '/cases/DISP-002?section=evidence#evidence-ev_gps_1',
    sourceOwner: 'platform',
    findingIds: [],
    target: { kind: 'source', evidenceId: 'ev_gps_1' },
  },
];

const context = {
  actions,
  findingIds: ['f1'],
  evidenceIds: ['ev_gps_1'],
  policyIds: ['DM-01'],
  permittedRecipients: ['rider', 'driver', 'platform'] as ('rider' | 'driver' | 'platform')[],
  permittedEvidenceTypes: ['gps_accuracy', 'fare_ledger'],
};

const v1 = {
  schemaVersion: 'rydr-navigator-v1',
  status: 'action_recommended',
  message: 'The arrival accuracy radius is missing, so request it from the driver.',
  matchedFindingIds: ['f1'],
  recommendedActionId: 'draft-request',
  sourceOwner: 'reviewer',
  clarificationQuestion: null,
  evidenceIds: ['ev_gps_1'],
  policyIds: ['DM-01'],
};

const draft = {
  actionId: 'draft-request',
  recipient: 'driver',
  question: 'What accuracy radius applied to your arrival sample?',
  whyItMatters: 'Without it the arrival zone cannot be classified.',
  evidenceType: 'gps_accuracy',
};

const v2 = { ...v1, schemaVersion: 'rydr-navigator-v2', requestDraft: draft };

describe('Navigator v1', () => {
  it('still validates and selects an allowed action', () => {
    const output = validateNavigator(v1, context);
    expect(output.schemaVersion).toBe('rydr-navigator-v1');
    expect(output.recommendedActionId).toBe('draft-request');
  });

  it('rejects an unavailable reference', () => {
    expect(() => validateNavigator({ ...v1, evidenceIds: ['ev_missing'] }, context)).toThrow(
      /unavailable reference/i,
    );
  });

  it('rejects an execution claim', () => {
    expect(() => validateNavigator({ ...v1, message: 'I have refunded the charge.' }, context)).toThrow(
      /cannot claim execution/i,
    );
  });

  it('rejects an action that does not exist', () => {
    expect(() => validateNavigator({ ...v1, recommendedActionId: 'invented' }, context)).toThrow(
      /unavailable action/i,
    );
  });
});

describe('Navigator v2', () => {
  it('accepts a draft tied to the recommended request-form action', () => {
    const output = validateNavigatorV2(v2, context);
    expect(output.requestDraft?.recipient).toBe('driver');
  });

  it('accepts a null draft', () => {
    const output = validateNavigatorV2({ ...v2, requestDraft: null }, context);
    expect(output.requestDraft).toBeNull();
  });

  it('rejects a draft whose actionId does not match the recommendation', () => {
    expect(() =>
      validateNavigatorV2({ ...v2, requestDraft: { ...draft, actionId: 'view-source:ev_gps_1' } }, context),
    ).toThrow(/belong to the recommended action/i);
  });

  it('rejects a draft attached to an action that is not a request form', () => {
    expect(() =>
      validateNavigatorV2(
        { ...v2, recommendedActionId: 'view-source:ev_gps_1', sourceOwner: 'platform' },
        context,
      ),
    ).toThrow(/does not support a request draft/i);
  });

  it('rejects a recipient this action does not permit', () => {
    expect(() =>
      validateNavigatorV2({ ...v2, requestDraft: { ...draft, recipient: 'platform' } }, {
        ...context,
        permittedRecipients: ['rider'],
      }),
    ).toThrow(/recipient this action does not permit/i);
  });

  it('rejects an unsupported evidence type', () => {
    expect(() =>
      validateNavigatorV2({ ...v2, requestDraft: { ...draft, evidenceType: 'bank_statement' } }, context),
    ).toThrow(/unsupported evidence type/i);
  });

  it('rejects a draft that accompanies a clarification', () => {
    expect(() =>
      validateNavigatorV2(
        {
          ...v2,
          status: 'clarification_needed',
          recommendedActionId: null,
          sourceOwner: null,
          clarificationQuestion: 'Which ride is this about?',
        },
        context,
      ),
    ).toThrow(/only accompany a recommended action/i);
  });

  it('rejects extra fields', () => {
    expect(() => validateNavigatorV2({ ...v2, verified: true }, context)).toThrow();
  });
});

describe('version dispatch', () => {
  it('routes v1 and v2 to their own validators', () => {
    expect(validateNavigatorAny(v1, context).schemaVersion).toBe('rydr-navigator-v1');
    expect(validateNavigatorAny(v2, context).schemaVersion).toBe('rydr-navigator-v2');
  });

  it('rejects an unrecognised version rather than guessing', () => {
    expect(() => validateNavigatorAny({ ...v1, schemaVersion: 'rydr-navigator-v9' }, context)).toThrow(
      /unrecognised response version/i,
    );
  });
});
