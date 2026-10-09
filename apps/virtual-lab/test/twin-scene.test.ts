/**
 * Tests for the twin scene's pure maths and its colour vocabulary.
 *
 * `AracnidTwinScene` itself needs a canvas and a WebGL context, so it is not
 * tested here. What is tested is the part that can silently go wrong without
 * anyone noticing: frame blending (a bad lerp makes the replay jitter or freeze)
 * and the state/grade colour maps (a state the engine can report but the scene
 * cannot colour is an invisible hand).
 */
import { describe, expect, it } from 'vitest';

import { AracnidWorld, DEFAULT_MISSION_EPOCH_MS, runMission } from '@agrirobots/engine';
import { compileAgriTaskSource } from '@agrirobots/policy';

import { ARM_STATE_COLOURS, GRADE_COLOURS, blendFrames } from '../app/lib/twin-scene';
import type { TwinFrameData } from '../app/shared/lab-types';
import { findLabTask, readLabTaskSource } from '../server/utils/lab-tasks';

function realFrames(): TwinFrameData[] {
  const task = findLabTask('aracnid-egg-collection');
  if (!task) throw new Error('aracnid-egg-collection is not on the lab shelf');
  const compiled = compileAgriTaskSource(readLabTaskSource(task));
  const world = new AracnidWorld({ scenario: 'nominal', seed: 7, nestLayout: 'arc' });
  return runMission({
    compiled,
    world,
    runId: 'test-twin-scene',
    epochMs: DEFAULT_MISSION_EPOCH_MS,
  }).twinFrames as TwinFrameData[];
}

/**
 * A span in which something continuous actually changes, so interpolation has
 * work to do. Twin frames are per-statement snapshots: the round is executed
 * docked (the task has no `move`), so what moves between two frames is the
 * battery, an arm's extension and the magazine - not the rover.
 */
function changingSpan(frames: readonly TwinFrameData[]): [TwinFrameData, TwinFrameData] {
  for (let index = 0; index < frames.length - 1; index += 1) {
    const a = frames[index];
    const b = frames[index + 1];
    if (!a || !b) continue;
    if (a.carrier.battery !== b.carrier.battery || a.arms[0]?.extension !== b.arms[0]?.extension) {
      return [a, b];
    }
  }
  throw new Error('nothing changes between any two twin frames');
}

/** Every number in a frame, flattened, for "no NaN anywhere" assertions. */
function numbers(value: unknown, path = ''): Array<{ path: string; value: number }> {
  if (typeof value === 'number') return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => numbers(entry, `${path}[${String(index)}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      numbers(entry, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

describe('frame blending', () => {
  const frames = realFrames();
  const [a, b] = changingSpan(frames);

  it('returns the bounding frame outright at the ends of the span', () => {
    expect(blendFrames(a, b, 0)).toBe(a);
    expect(blendFrames(a, b, -1)).toBe(a);
    expect(blendFrames(a, b, 1)).toBe(b);
    expect(blendFrames(a, b, 2)).toBe(b);
  });

  it('interpolates every continuous carrier value', () => {
    const half = blendFrames(a, b, 0.5);
    expect(half.t).toBeCloseTo((a.t + b.t) / 2, 9);
    expect(half.carrier.x).toBeCloseTo((a.carrier.x + b.carrier.x) / 2, 9);
    expect(half.carrier.y).toBeCloseTo((a.carrier.y + b.carrier.y) / 2, 9);
    expect(half.carrier.heading).toBeCloseTo((a.carrier.heading + b.carrier.heading) / 2, 9);
    expect(half.carrier.speed).toBeCloseTo((a.carrier.speed + b.carrier.speed) / 2, 9);
    expect(half.carrier.tilt).toBeCloseTo((a.carrier.tilt + b.carrier.tilt) / 2, 9);
    expect(half.carrier.battery).toBeCloseTo((a.carrier.battery + b.carrier.battery) / 2, 9);
  });

  it('takes discrete state from the later frame, never half of it', () => {
    const half = blendFrames(a, b, 0.5);
    expect(half.carrier.parked).toBe(b.carrier.parked);
    expect(half.carrier.armsDeployed).toBe(b.carrier.armsDeployed);
    expect(half.magazine).toBe(b.magazine);
    expect(half.nestBank).toBe(b.nestBank);
    expect(half.tally).toBe(b.tally);
    expect(half.safety).toBe(b.safety);
  });

  it('interpolates all eight arm poses and keeps their identity', () => {
    const half = blendFrames(a, b, 0.5);
    expect(half.arms).toHaveLength(b.arms.length);
    expect(half.arms.map((arm) => arm.id)).toEqual(b.arms.map((arm) => arm.id));
    for (const [index, arm] of half.arms.entries()) {
      const before = a.arms[index];
      const after = b.arms[index];
      if (!before || !after) throw new Error('arm count changed mid-run');
      expect(arm.shoulderYaw).toBeCloseTo((before.shoulderYaw + after.shoulderYaw) / 2, 9);
      expect(arm.elbowPitch).toBeCloseTo((before.elbowPitch + after.elbowPitch) / 2, 9);
      expect(arm.wristPitch).toBeCloseTo((before.wristPitch + after.wristPitch) / 2, 9);
      expect(arm.extension).toBeCloseTo((before.extension + after.extension) / 2, 9);
      expect(arm.suctionKpa).toBeCloseTo((before.suctionKpa + after.suctionKpa) / 2, 9);
      expect(arm.forceN).toBeCloseTo((before.forceN + after.forceN) / 2, 9);
      // What the hand is doing, and what it is holding, are facts not quantities.
      expect(arm.state).toBe(after.state);
      expect(arm.holding).toBe(after.holding);
    }
  });

  it('moves monotonically across the span, so the replay never doubles back', () => {
    const alphas = [0, 0.25, 0.5, 0.75, 1];
    for (const [name, read] of [
      ['battery', (frame: TwinFrameData) => frame.carrier.battery],
      ['hand 1 extension', (frame: TwinFrameData) => frame.arms[0]?.extension ?? 0],
    ] as Array<[string, (frame: TwinFrameData) => number]>) {
      const values = alphas.map((alpha) => read(blendFrames(a, b, alpha)));
      const direction = Math.sign(read(b) - read(a)) || 1;
      for (let index = 1; index < values.length; index += 1) {
        const step = ((values[index] ?? 0) - (values[index - 1] ?? 0)) * direction;
        expect(step, `${name} at alpha ${String(alphas[index])}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reflects what the round actually does: docked rover, working arms, draining battery', () => {
    const xs = new Set(frames.map((frame) => frame.carrier.x));
    expect(xs.size, 'the ARACNID round has no move statement, so the rover stays docked').toBe(1);
    const extensions = new Set(frames.map((frame) => frame.arms[0]?.extension ?? 0));
    expect(extensions.size, 'hand 1 reaches and retracts').toBeGreaterThan(1);
    const first = frames[0]?.carrier.battery ?? 0;
    const last = frames[frames.length - 1]?.carrier.battery ?? 0;
    expect(last, 'the battery only drains').toBeLessThan(first);
    const states = new Set(frames.flatMap((frame) => frame.arms.map((arm) => arm.state)));
    expect(states.has('stowed'), 'hands start stowed').toBe(true);
    expect(states.has('sealing') || states.has('holding'), 'hands work').toBe(true);
  });

  it('produces no NaN, including when the earlier frame has no arms', () => {
    for (const alpha of [0.1, 0.5, 0.9]) {
      const blended = blendFrames(a, b, alpha);
      for (const entry of numbers(blended)) {
        expect(Number.isFinite(entry.value), `${entry.path} at alpha ${String(alpha)}`).toBe(true);
      }
    }
    const armless: TwinFrameData = { ...a, arms: [] };
    const fallback = blendFrames(armless, b, 0.5);
    expect(fallback.arms).toHaveLength(b.arms.length);
    for (const entry of numbers(fallback)) {
      expect(Number.isFinite(entry.value), entry.path).toBe(true);
    }
  });
});

describe('the scene can colour everything the engine can report', () => {
  it('has a colour for every arm state in the twin-frame contract', () => {
    const states = ['stowed', 'reaching', 'sealing', 'holding', 'placing', 'fault'];
    expect(Object.keys(ARM_STATE_COLOURS).sort()).toEqual([...states].sort());
    for (const state of states) {
      expect(Number.isInteger(ARM_STATE_COLOURS[state]), state).toBe(true);
    }
  });

  it('has a colour for every egg grade the world produces, plus unknown', () => {
    const frames = realFrames();
    const grades = new Set<string>();
    for (const frame of frames) {
      for (const slot of frame.nestBank.slots) {
        if (slot.egg) grades.add(slot.egg.grade);
      }
    }
    expect(grades.size).toBeGreaterThan(0);
    for (const grade of grades) {
      expect(GRADE_COLOURS[grade], grade).toBeDefined();
    }
    expect(GRADE_COLOURS['unknown']).toBeDefined();
    expect(GRADE_COLOURS['cracked']).toBeDefined();
  });

  it('keeps the legend and the materials on one vocabulary', () => {
    // The viewport legend imports these maps rather than restating them, so a new
    // hand state cannot be coloured in the scene and missing from the legend.
    expect(Object.keys(ARM_STATE_COLOURS)).toHaveLength(6);
    expect(Object.keys(GRADE_COLOURS)).toHaveLength(5);
  });
});
