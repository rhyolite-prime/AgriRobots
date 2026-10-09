import { describe, expect, it } from 'vitest';

import { compileAgriTaskSource } from '@agrirobots/policy';

import {
  EXIT_CODES,
  ScriptedWorld,
  runMission,
  type DispatchResult,
  type RuntimeValue,
  type TravelCall,
} from '../src/index.ts';

/**
 * `degrade_to` is in the grammar with five modes; three of them change what the
 * machine may physically do. These tests pin the engine to the grammar instead
 * of letting a mode be accepted and then ignored.
 */

const HEADER = `
meta {
  owner "farm-ops";
  change_ticket "AGR-TEST-003";
  description "Degradation probe for the engine test suite.";
  tags "test";
}
`;

const REQUIRES = `
  requires {
    cassette FD-01 with dispense_mass.v1;
    operator supervisor_on_site;
    zones house-3-feed-lane;
    route house-3-feed-lane commissioned;
    calibration sha256:9fa67484ddac3e44bb36a36514f645612de0458a29968f594e9f00e5e8fd75ba;
  }

  limits {
    travel_speed  = 0.40 m/s;
    task_deadline = 10 min;
    max_retries   = 0 count;
  }

  preflight {
    cassette.id == "FD-01"    @ within 500 ms;
    cassette.latch == #LOCKED @ within 500 ms;
  }
`;

const FAULT_CLAUSE = `
  on_fault {
    stop: safe_stop reason = "degraded";
    end:  finish failed DEGRADE_FAULT message = "degraded";
  }

  evidence {
    retain journal;
    retention_days 30;
  }
}
`;

function task(steps: string): string {
  return `${HEADER}\ntask degrade-probe@1.0.0 {${REQUIRES}\n\n  steps {\n${steps}\n  }\n${FAULT_CLAUSE}`;
}

class RecordingWorld extends ScriptedWorld {
  readonly travels: TravelCall[] = [];

  override travel(call: TravelCall): DispatchResult {
    this.travels.push(call);
    return super.travel(call);
  }
}

function world(): RecordingWorld {
  return new RecordingWorld({
    cassetteId: 'FD-01',
    capabilities: ['dispense_mass.v1'],
    tree: {
      cassette: { id: 'FD-01', latch: 'LOCKED' },
      tool: { dispensed_mass: { value: 2, unit: 'kg' } },
      operator: { present: true },
    } as Record<string, RuntimeValue>,
  });
}

function payloadOf(
  events: Array<{ payload: Record<string, unknown> }>,
  index = 0,
): Record<string, unknown> {
  return events[index]!.payload as Record<string, unknown>;
}

describe('degrade_to reduced_speed', () => {
  const compiled = compileAgriTaskSource(
    task(`    slow: degrade_to reduced_speed reason = "wet floor";
    lane: move along house-3-feed-lane at 0.40 m/s within 200 s;
    done: finish success message = "slowed and finished";`),
  );

  it('compiles', () => {
    expect(compiled.issues).toEqual([]);
  });

  it('halves the task travel-speed limit and journals the cap', () => {
    const testWorld = world();
    const result = runMission({ compiled, world: testWorld, runId: 'run-slow' });
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(EXIT_CODES.success);

    const degraded = result.journal.filter((event) => event.kind === 'mode.degraded');
    expect(degraded).toHaveLength(1);
    expect(payloadOf(degraded)).toMatchObject({
      from: 'full',
      to: 'reduced_speed',
      reason: 'wet floor',
    });

    const capped = result.journal.filter((event) => event.kind === 'mode.speed_capped');
    expect(capped).toHaveLength(1);
    expect(payloadOf(capped)['applied']).toEqual({ value: 0.2, unit: 'm/s' });

    // The world was commanded with the capped speed, not the written one.
    expect(testWorld.travels).toHaveLength(1);
    expect(testWorld.travels[0]!.speedLimit).toEqual({ value: 0.2, unit: 'm/s' });
  });
});

describe('degrade_to sensing_only', () => {
  const compiled = compileAgriTaskSource(
    task(`    quiet: degrade_to sensing_only reason = "stockperson in the lane";
    lane: move along house-3-feed-lane at 0.20 m/s within 200 s;
    pour: with_permit tool_energy on tool[dispenser] for 60 s {
      dose: actuate dispense_mass.v1 (station = "s1", mass = 2 kg, rate = 0.30 kg/s)
            within 30 s
            verify { tool.dispensed_mass >= 1 kg @ within 2 s; }
            on_mismatch fault
            idempotency_key task.run_id + ":s1";
    };
    done: finish success message = "never reached";`),
  );

  it('refuses actuation and ends inhibited, without dosing', () => {
    const testWorld = world();
    const result = runMission({ compiled, world: testWorld, runId: 'run-quiet' });
    expect(result.status).toBe('inhibited');
    expect(result.exitCode).toBe(EXIT_CODES.safetyInhibited);

    const fault = result.journal.filter((event) => event.kind === 'fault.entered');
    expect(fault).toHaveLength(1);
    expect(payloadOf(fault)).toMatchObject({ code: 'E_DEGRADED', inhibited: true });

    // Motion is refused too: sensing_only means the machine stops moving.
    expect(testWorld.travels).toHaveLength(0);
    expect(
      result.journal.filter(
        (event) =>
          event.kind === 'action.dispatched' &&
          (event.payload as Record<string, unknown>)['capability'] === 'dispense_mass.v1',
      ),
    ).toHaveLength(0);
  });
});

describe('degrade_to return_to_dock', () => {
  const compiled = compileAgriTaskSource(
    task(`    home: degrade_to return_to_dock reason = "battery reserve";
    roam: move along house-3-feed-lane at 0.20 m/s within 200 s;
    bay:  return_to feed-service-bay within 200 s;
    done: finish success message = "never reached";`),
  );

  it('refuses free travel but still lets the machine get home', () => {
    const testWorld = world();
    const result = runMission({ compiled, world: testWorld, runId: 'run-home' });
    const fault = result.journal.filter((event) => event.kind === 'fault.entered');
    expect(fault).toHaveLength(1);
    expect(String(payloadOf(fault)['message'])).toMatch(/return_to_dock/);
    expect(testWorld.travels).toHaveLength(0);

    // The same task without the roaming move gets home and finishes.
    const homing = compileAgriTaskSource(
      task(`    home: degrade_to return_to_dock reason = "battery reserve";
    bay:  return_to feed-service-bay within 200 s;
    done: finish success message = "docked";`),
    );
    const dockWorld = world();
    const docked = runMission({ compiled: homing, world: dockWorld, runId: 'run-docked' });
    expect(docked.status).toBe('completed');
    expect(dockWorld.travels).toHaveLength(1);
    expect(dockWorld.travels[0]!.kind).toBe('return_to');
  });
});

describe('degrade_to hold_position', () => {
  const compiled = compileAgriTaskSource(
    task(`    hold: degrade_to hold_position reason = "wind gusts";
    lane: move along house-3-feed-lane at 0.20 m/s within 200 s;
    done: finish success message = "never reached";`),
  );

  it('refuses motion entirely', () => {
    const testWorld = world();
    const result = runMission({ compiled, world: testWorld, runId: 'run-hold' });
    expect(result.status).toBe('inhibited');
    expect(
      payloadOf(result.journal.filter((event) => event.kind === 'fault.entered'))['code'],
    ).toBe('E_DEGRADED');
    expect(testWorld.travels).toHaveLength(0);
  });
});
