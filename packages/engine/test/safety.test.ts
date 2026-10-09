import { describe, expect, it } from 'vitest';

import {
  aracnidResourcePolicy,
  IndependentSafetyModel,
  Journal,
  ResourceArbitrator,
  SafetyGate,
  VirtualClock,
  type SafetyRequest,
  type StateSnapshot,
} from '../src/index.ts';

const EPOCH = Date.parse('2026-10-09T17:00:00.000Z');

function tree(overrides: Record<string, unknown> = {}): StateSnapshot['tree'] {
  return {
    safety: {
      mode: 'AUTO_TASK',
      e_stop: false,
      arm_envelope_clear: true,
      presence_detected: false,
      presence_zone: '',
    },
    carrier: { parked: true, tilt: { value: 0.4, unit: 'deg' }, arms_deployed: false },
    cassette: { id: 'EG-08', latch: 'LOCKED', magazine: { indexing: false, hand_in_bay: false } },
    tool: {},
    ...overrides,
  } as StateSnapshot['tree'];
}

function snap(
  overrides: Record<string, unknown> = {},
  nowMs = EPOCH + 1000,
  ageMs = 0,
): StateSnapshot {
  return {
    tree: tree(overrides),
    sampledAtMs: { safety: nowMs - ageMs, carrier: nowMs, cassette: nowMs, tool: nowMs },
    nowMs,
  };
}

const request = (partial: Partial<SafetyRequest> = {}): SafetyRequest => ({
  kind: 'actuate',
  capability: 'pick_egg.v1',
  resources: ['tool.hand_1'],
  permits: ['tool_energy'],
  motionDuringToolUse: false,
  ...partial,
});

function model(): IndependentSafetyModel {
  return new IndependentSafetyModel({ carrierId: 'AR-01', cassetteId: 'EG-08' });
}

describe('independent safety model (SF-AR-01 … SF-AR-10)', () => {
  it('reports every function and inhibits nothing when the machine is healthy', () => {
    const assessment = model().assess(snap(), request());
    expect(assessment.inhibited).toBe(false);
    expect(assessment.state).toBe('AUTO_TASK');
    expect(assessment.functions.map((fn) => fn.id)).toEqual([
      'SF-AR-01',
      'SF-AR-02',
      'SF-AR-03',
      'SF-AR-04',
      'SF-AR-05',
      'SF-AR-06',
      'SF-AR-07',
      'SF-AR-08',
      'SF-AR-09',
      'SF-AR-10',
    ]);
    expect(assessment.functions.every((fn) => fn.tripped === false)).toBe(true);
  });

  it('SF-AR-01: an e-stop removes everything and reports SAFE_STOP', () => {
    const assessment = model().assess(
      snap({ safety: { mode: 'AUTO_TASK', e_stop: true } }),
      request(),
    );
    expect(assessment.state).toBe('SAFE_STOP');
    expect(assessment.inhibited).toBe(true);
    expect(assessment.functions.find((fn) => fn.id === 'SF-AR-01')?.tripped).toBe(true);
  });

  it('SF-AR-03/04: a hand over force or losing its seal is refused', () => {
    const overForce = model().assess(
      snap({
        tool: {
          hand_1: { force_peak: { value: 14, unit: 'N' }, holding: null, seal_quality: 'good' },
        },
      }),
      request(),
    );
    expect(overForce.functions.find((fn) => fn.id === 'SF-AR-03')?.tripped).toBe(true);
    expect(overForce.inhibited).toBe(true);

    const sealLoss = model().assess(
      snap({
        tool: {
          hand_1: { force_peak: { value: 5, unit: 'N' }, holding: 'egg-01', seal_quality: 'lost' },
        },
      }),
      request(),
    );
    expect(sealLoss.functions.find((fn) => fn.id === 'SF-AR-04')?.tripped).toBe(true);
    expect(sealLoss.reasons.join(' ')).toMatch(/SF-AR-04/);
  });

  it('SF-AR-05: a cassette latch or identity mismatch inhibits tool energy and travel', () => {
    const unlatched = model().assess(snap({ cassette: { id: 'EG-08', latch: 'OPEN' } }), request());
    expect(unlatched.inhibited).toBe(true);
    expect(unlatched.reasons.join(' ')).toMatch(/SF-AR-05/);

    const wrongId = model().assess(snap({ cassette: { id: 'FD-01', latch: 'LOCKED' } }), request());
    expect(wrongId.inhibited).toBe(true);

    // Sensing alone is not inhibited by a latch fault: the round can still look.
    const observe = model().assess(
      snap({ cassette: { id: 'EG-08', latch: 'OPEN' } }),
      request({ kind: 'observe', capability: 'scan_nest.v1', resources: ['sensing'], permits: [] }),
    );
    expect(observe.inhibited).toBe(false);
  });

  it('SF-AR-06: motion with deployed arms is interlocked unless the manifest approves it', () => {
    const deployed = snap({
      carrier: { parked: false, tilt: { value: 0.4, unit: 'deg' }, arms_deployed: true },
    });
    const refused = model().assess(deployed, request({ kind: 'move', resources: ['traction'] }));
    expect(refused.inhibited).toBe(true);
    expect(refused.reasons.join(' ')).toMatch(/SF-AR-06/);

    const approved = model().assess(
      deployed,
      request({ kind: 'move', resources: ['traction'], motionDuringToolUse: true }),
    );
    expect(approved.reasons.join(' ')).not.toMatch(/SF-AR-06/);
  });

  it('SF-AR-07: a bird or worker in the cell holds the arms and inhibits traction', () => {
    const assessment = model().assess(
      snap({
        safety: {
          mode: 'READY',
          e_stop: false,
          arm_envelope_clear: true,
          presence_detected: true,
          presence_zone: 'aisle',
        },
      }),
      request(),
    );
    expect(assessment.inhibited).toBe(true);
    expect(assessment.functions.find((fn) => fn.id === 'SF-AR-07')?.tripped).toBe(true);
  });

  it('SF-AR-08: tilt beyond the trip limit removes all energy', () => {
    const assessment = model().assess(
      snap({ carrier: { parked: true, tilt: { value: 6.5, unit: 'deg' }, arms_deployed: true } }),
      request(),
    );
    expect(assessment.inhibited).toBe(true);
    expect(assessment.reasons.join(' ')).toMatch(/SF-AR-08/);
  });

  it('SF-AR-09: stale safety telemetry is a heartbeat loss, never a permission', () => {
    const assessment = model().assess(snap({}, EPOCH + 5000, 4000), request());
    expect(assessment.functions.find((fn) => fn.id === 'SF-AR-09')?.tripped).toBe(true);
    expect(assessment.inhibited).toBe(true);
  });

  it('SF-AR-10: the tray bay cannot index while a hand is inside it', () => {
    const assessment = model().assess(
      snap({
        cassette: { id: 'EG-08', latch: 'LOCKED', magazine: { indexing: true, hand_in_bay: true } },
      }),
      request({ resources: ['tool.hand_3', 'tool.magazine'] }),
    );
    expect(assessment.functions.find((fn) => fn.id === 'SF-AR-10')?.tripped).toBe(true);
    expect(assessment.inhibited).toBe(true);
  });

  it('SF-AR-02: an arm-envelope breach stops the affected arms and traction', () => {
    const assessment = model().assess(
      snap({
        safety: {
          mode: 'AUTO_TASK',
          e_stop: false,
          arm_envelope_clear: false,
          presence_detected: false,
        },
      }),
      request(),
    );
    expect(assessment.inhibited).toBe(true);
    expect(assessment.functions.find((fn) => fn.id === 'SF-AR-02')?.tripped).toBe(true);
  });

  it('an unreadable mode is UNKNOWN, which is inhibiting', () => {
    const assessment = model().assess(
      snap({ safety: { mode: 'WHATEVER', e_stop: false } }),
      request(),
    );
    expect(assessment.state).toBe('UNKNOWN');
  });
});

describe('resource arbitrator (S11 at run time)', () => {
  it('grants an exclusive instance to one holder only', () => {
    const resources = new ResourceArbitrator(aracnidResourcePolicy());
    const first = resources.acquire('branch/h1', ['tool.hand_1'], EPOCH);
    expect(first.granted).toBe(true);
    const second = resources.acquire('branch/h2', ['tool.hand_1'], EPOCH);
    expect(second.granted).toBe(false);
    if (!second.granted) {
      expect(second.key).toBe('tool.hand_1');
      expect(second.holder).toBe('branch/h1');
    }
  });

  it('lets several holders share a sensing resource', () => {
    const resources = new ResourceArbitrator(aracnidResourcePolicy());
    expect(resources.acquire('a', ['sensing.nest_scan'], EPOCH).granted).toBe(true);
    expect(resources.acquire('b', ['sensing.nest_scan'], EPOCH).granted).toBe(true);
  });

  it('takes a multi-resource claim atomically', () => {
    const resources = new ResourceArbitrator(aracnidResourcePolicy());
    expect(resources.acquire('placer-1', ['tool.magazine'], EPOCH).granted).toBe(true);
    const second = resources.acquire('placer-2', ['tool.hand_3', 'tool.magazine'], EPOCH);
    expect(second.granted).toBe(false);
    // The hand was not taken either: a partial grant is a denial.
    expect(resources.holderOf('tool.hand_3', EPOCH)).toBeUndefined();
  });

  it('treats an unknown resource as exclusive (fail closed)', () => {
    const resources = new ResourceArbitrator({ exclusive: [], shared: [] });
    expect(resources.isExclusive('tool.mystery')).toBe(true);
  });

  it('resolves a dynamic instance through a variable, and refuses to guess', () => {
    const resources = new ResourceArbitrator(aracnidResourcePolicy());
    const dynamic = { class: 'tool', instance: { kind: 'string', value: 'ignored' } } as const;

    // `tool[$held.id]` with $held.id = "hand_3"
    expect(resources.resolve(dynamic, () => 'hand_3')).toBe('tool.hand_3');
    // A literal instance never needs the evaluator.
    expect(resources.resolve({ class: 'tool', instance: 'magazine' }, () => null)).toBe(
      'tool.magazine',
    );
    // An unbound variable is a refusal, not a wildcard claim on every hand.
    expect(resources.resolve(dynamic, () => null)).toBe('tool.__unresolved__');
  });

  it('expires leases when their time is up', () => {
    const resources = new ResourceArbitrator(aracnidResourcePolicy());
    resources.acquire('a', ['tool.hand_1'], EPOCH, 1000);
    expect(resources.holderOf('tool.hand_1', EPOCH + 500)).toBeDefined();
    expect(resources.expire(EPOCH + 1500)).toHaveLength(1);
    expect(resources.holderOf('tool.hand_1', EPOCH + 1500)).toBeUndefined();
  });
});

describe('safety gate', () => {
  function rig() {
    const clock = new VirtualClock(EPOCH);
    const resources = new ResourceArbitrator(aracnidResourcePolicy());
    const safety = model();
    const journal = new Journal({
      runId: 'run-gate',
      source: 'simulator',
      clock,
      configuration: { carrierId: 'AR-01', cassetteSerial: 'EG-08-0001' },
      safetyState: () => 'AUTO_TASK',
    });
    const gate = new SafetyGate({
      clock,
      journal,
      model: safety,
      resources,
      motionDuringToolUse: false,
    });
    return { clock, resources, safety, journal, gate };
  }

  it('grants a permit, claims the resource and journals both', () => {
    const { gate, journal, clock } = rig();
    const decision = gate.requestPermit('h1', 'tool_energy', ['tool.hand_1'], 30_000, (req) =>
      model().assess(snap({}, clock.now()), req),
    );
    expect(decision.granted).toBe(true);
    expect(journal.of('permit.granted')).toHaveLength(1);
    expect(journal.of('resource.claimed')).toHaveLength(1);
  });

  it('denies energy when the safety model inhibits, and says why', () => {
    const { gate, journal, clock } = rig();
    const decision = gate.requestPermit('h1', 'tool_energy', ['tool.hand_1'], 30_000, (req) =>
      model().assess(snap({ safety: { mode: 'AUTO_TASK', e_stop: true } }, clock.now()), req),
    );
    expect(decision.granted).toBe(false);
    expect(journal.of('safety.inhibited')).toHaveLength(1);
    expect(journal.of('permit.denied')).toHaveLength(1);
  });

  it('refuses everything after a task-requested safe stop, irreversibly', () => {
    const { gate, clock, journal } = rig();
    gate.requestSafeStop('vacuum vented, arms held');
    expect(gate.isStopped()).toBe(true);
    const decision = gate.requestPermit('h1', 'tool_energy', ['tool.hand_1'], 30_000, (req) =>
      model().assess(snap({}, clock.now()), req),
    );
    expect(decision.granted).toBe(false);
    expect(journal.of('safety.state_changed').at(-1)?.payload).toMatchObject({ to: 'SAFE_STOP' });
  });

  it('expires a permit whose lease ran out', () => {
    const { gate, clock, journal } = rig();
    gate.requestPermit('h1', 'tool_energy', ['tool.hand_1'], 1000, (req) =>
      model().assess(snap({}, clock.now()), req),
    );
    clock.advance(1500);
    const expired = gate.tick();
    expect(expired.permits).toHaveLength(1);
    expect(journal.of('permit.expired')).toHaveLength(1);
    expect(gate.activePermits()).toHaveLength(0);
  });

  it('authorises a dispatch only when the model agrees', () => {
    const { gate, clock } = rig();
    const ok = gate.authorize(request(), (req) => model().assess(snap({}, clock.now()), req));
    expect(ok.allowed).toBe(true);
    const refused = gate.authorize(request(), (req) =>
      model().assess(
        snap(
          { carrier: { parked: true, tilt: { value: 9, unit: 'deg' }, arms_deployed: true } },
          clock.now(),
        ),
        req,
      ),
    );
    expect(refused.allowed).toBe(false);
  });
});
