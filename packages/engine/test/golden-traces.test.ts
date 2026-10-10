/**
 * Golden traces: the equivalence contract between this TypeScript reference
 * engine and the C++ engine in `engine/`.
 *
 * `docs/09` §7 holds the two implementations equivalent by golden trace rather
 * than by review. This file makes that concrete: it runs a fixed set of
 * missions, writes what each produced into `engine/testdata/`, and on every
 * normal run regenerates those files in memory and fails if a committed byte
 * differs. Fixtures are therefore never hand-edited; they are reproduced with
 * `npm run export:golden`.
 *
 * Two languages agree when they agree on bytes, so the fixtures carry exactly
 * the things a port gets subtly wrong: ECMAScript number formatting, string
 * escaping, key ordering (including the integer-index hoisting JavaScript does
 * and most JSON libraries do not), the nine-field journal shape, and the sha256
 * over all of it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalJson, findRepoRoot, repoFile } from '@agrirobots/compiler-core';
import { compileAgriTaskSource } from '@agrirobots/policy';

import {
  AracnidWorld,
  DEFAULT_MISSION_EPOCH_MS,
  ScriptedWorld,
  canonicalTraceOf,
  runMission,
  type AracnidScenario,
  type MissionResult,
  type RuntimeValue,
} from '../src/index.ts';

const EXPORT = process.env['AGRI_EXPORT_GOLDEN'] === '1';
// repoFile() insists the path exists; the fixture tree is created on export.
const FIXTURE_DIR = path.join(findRepoRoot(), 'engine', 'testdata');
const FIXTURE_VERSION = 1;
const GENERATOR = 'packages/engine/test/golden-traces.test.ts';

/** The IR hash `packages/policy/test/agri-task-compile.test.ts` pins. */
const ARACNID_IR_HASH = '4f35636c61653393438b5e3532ff5306340a40677a4f6a10757be3be61fc498c';

/** The trace hash of the nominal ARACNID round, seed 7, arc nest geometry. */
const ARACNID_NOMINAL_JOURNAL_HASH =
  'ca0008e7fbb31f68a1a6df16e1fc4e1630679e418f22e27419bec1dfbfbab90e';

interface GoldenFile {
  /** Path relative to `engine/testdata/`. */
  readonly name: string;
  readonly text: string;
}

function goldenFile(name: string, fixture: unknown): GoldenFile {
  return { name, text: `${JSON.stringify(fixture, null, 2)}\n` };
}

/* -------------------------------------------------------------------------- */
/* A small task, so one fixture can carry the canonical bytes themselves.      */
/* -------------------------------------------------------------------------- */

const PROBE_SOURCE = `meta {
  owner "farm-ops";
  change_ticket "AGR-TEST-009";
  description "Golden-trace probe: the smallest run that exercises a permit, quantities and verification.";
  tags "test";
}

task golden-probe@1.0.0 {
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
    tool_timeout  = 30 s;
    max_retries   = 0 count;
  }

  preflight {
    // ScriptedWorld reports mode AUTO_TASK and battery.charge, so the probe reads
    // the same names the engine's own scripted tests use.
    safety.mode == #AUTO_TASK @ within 500 ms;
    cassette.latch == #LOCKED @ within 500 ms;
    operator.present == true  @ within 500 ms;
    battery.charge >= 35 %    @ within 2 s;
  }

  steps {
    start_round: record probe.started {
      task = task.name;
      run  = task.run_id;
      zone = zone.current_id;
    };

    to_lane: move along house-3-feed-lane at 0.35 m/s within 120 s;

    dispense: with_permit tool_energy on tool[dispenser] for 60 s {
      pour: actuate dispense_mass.v1 (
              station = "probe-station",
              mass    = 2.5 kg,
              rate    = 0.30 kg/s
            )
            within 25 s
            verify {
              tool.dispensed_mass >= 2.4 kg @ within 2 s;
              tool.dispensed_mass <= 2.6 kg @ within 2 s;
            }
            idempotency_key task.run_id + ":probe";
    };

    done: finish success message = "probe finished";
  }

  on_fault {
    stop: safe_stop reason = "probe fault";
    end:  finish failed PROBE_FAULT message = "probe faulted";
  }

  evidence {
    retain journal;
    retention_days 30;
  }
}
`;

function probeWorld(): ScriptedWorld {
  return new ScriptedWorld({
    cassetteId: 'FD-01',
    capabilities: ['dispense_mass.v1'],
    tree: {
      cassette: { id: 'FD-01', latch: 'LOCKED' },
      operator: { present: true },
      tool: { dispensed_mass: { value: 2.5, unit: 'kg' } },
      zone: { current_id: 'house-3-feed-lane' },
    } as Record<string, RuntimeValue>,
  });
}

/* -------------------------------------------------------------------------- */
/* Fixture shape                                                               */
/* -------------------------------------------------------------------------- */

interface TraceFixtureOptions {
  readonly name: string;
  readonly taskId: string;
  readonly source: string;
  readonly result: MissionResult;
  readonly world: Record<string, unknown>;
  /** Carry the canonical bytes themselves, not only their hash. */
  readonly includeCanonical: boolean;
}

function traceFixture(options: TraceFixtureOptions): Record<string, unknown> {
  const { result } = options;
  const compiled = compileAgriTaskSource(options.source);
  return {
    fixtureVersion: FIXTURE_VERSION,
    generator: GENERATOR,
    contract: 'docs/09_DSL_AND_EXECUTION_ENGINE.md section 7',
    name: options.name,
    reference: {
      engine: '@agrirobots/engine',
      language: 'TypeScript',
      epochMs: DEFAULT_MISSION_EPOCH_MS,
    },
    task: {
      id: options.taskId,
      name: compiled.ir.task.name,
      version: compiled.ir.task.version,
      source: options.source,
    },
    world: options.world,
    run: {
      runId: result.runId,
      status: result.status,
      exitCode: result.exitCode,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.message ? { message: result.message } : {}),
      elapsedMs: result.elapsedMs,
      visits: result.visits,
      tally: result.tally,
      safety: result.safety,
    },
    ir: {
      irHash: compiled.irHash,
      sourceHash: compiled.sourceHash,
      canonicalBytes: Buffer.byteLength(compiled.canonicalJson, 'utf8'),
      ...(options.includeCanonical ? { canonicalJson: compiled.canonicalJson } : {}),
      value: compiled.ir,
    },
    journal: {
      eventCount: result.journal.length,
      journalHash: result.journalHash,
      ...(options.includeCanonical ? { canonicalTrace: canonicalTraceOf(result.journal) } : {}),
      events: result.journal,
    },
  };
}

function aracnidTrace(
  name: string,
  scenario: AracnidScenario,
  seed: number,
  nestLayout: 'arc' | 'straight',
  includeCanonical: boolean,
): GoldenFile {
  const source = readFileSync(repoFile('dsl/examples/aracnid-egg-collection.agri'), 'utf8');
  const compiled = compileAgriTaskSource(source);
  const world = new AracnidWorld({ scenario, seed, nestLayout });
  // The lab's own run-id shape, so each golden trace is the same round the
  // Virtual Lab renders — and so the nominal one reproduces the journal hash the
  // docs quote.
  const result = runMission({
    compiled,
    world,
    runId: `lab-aracnid-egg-collection-${scenario}-${String(seed)}-${nestLayout}`,
    epochMs: DEFAULT_MISSION_EPOCH_MS,
  });
  return goldenFile(
    path.join('traces', `${name}.json`),
    traceFixture({
      name,
      taskId: 'aracnid-egg-collection',
      source,
      result,
      world: { model: 'AracnidWorld', scenario, seed, nestLayout },
      includeCanonical,
    }),
  );
}

function probeTrace(): GoldenFile {
  const compiled = compileAgriTaskSource(PROBE_SOURCE);
  expect(compiled.issues, JSON.stringify(compiled.issues)).toEqual([]);
  const result = runMission({
    compiled,
    world: probeWorld(),
    runId: 'golden-probe-run',
    epochMs: DEFAULT_MISSION_EPOCH_MS,
  });
  expect(result.status, result.message ?? '').toBe('completed');
  return goldenFile(
    path.join('traces', 'probe-permit-and-verify.json'),
    traceFixture({
      name: 'probe-permit-and-verify',
      taskId: 'golden-probe',
      source: PROBE_SOURCE,
      result,
      world: { model: 'ScriptedWorld', cassetteId: 'FD-01', capabilities: ['dispense_mass.v1'] },
      includeCanonical: true,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Canonicalisation vectors                                                    */
/* -------------------------------------------------------------------------- */

function floatBits(value: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return `0x${view.getBigUint64(0).toString(16).padStart(16, '0')}`;
}

/** Values chosen to break a formatter that is merely close to ECMAScript's. */
const NUMBERS: readonly number[] = [
  0,
  -0,
  1,
  -1,
  2,
  10,
  42,
  -42,
  100,
  0.1,
  0.5,
  1.5,
  2.5,
  0.4,
  0.35,
  2.4,
  2.6,
  4.6,
  0.836,
  62.5,
  18,
  3.141592653589793,
  1 / 3,
  2 / 3,
  0.30000000000000004,
  0.000001,
  0.0000001,
  1e-7,
  5e-7,
  1e-6,
  1e-5,
  1e-21,
  1e-22,
  1e20,
  1e21,
  1e22,
  -1e21,
  1e100,
  6.02e23,
  1.6e-19,
  21752,
  2400000,
  9007199254740991,
  9007199254740992,
  9007199254740994,
  123456789012345680000,
  // Written as a string so eslint does not (rightly) flag the literal: the point
  // is the double a 30-digit decimal rounds to, not the digits themselves.
  Number('123456789012345678901234567890'),
  1.7976931348623157e308,
  2.2250738585072014e-308,
  5e-324,
];

function numberVectors(): GoldenFile {
  const cases = NUMBERS.map((value, index) => {
    const json = JSON.stringify(value);
    return {
      index,
      bits: floatBits(value),
      json,
      document: `{"value":${json}}`,
      // JSON.stringify(-0) is "0", so the sign of zero cannot survive a JSON
      // round trip. The C++ suite skips its bit-pattern check for exactly those
      // cases rather than pretending the comparison still means something.
      roundTripsBits: Object.is(Number(json), value),
    };
  });
  return goldenFile(path.join('vectors', 'numbers.json'), {
    fixtureVersion: FIXTURE_VERSION,
    generator: GENERATOR,
    note: 'ECMAScript Number::toString exactly as JSON.stringify writes it. `bits` is the IEEE-754 double, so a parser difference cannot hide behind a decimal string.',
    cases,
  });
}

/**
 * Raw JSON documents, as text, so key order survives into the fixture. Writing
 * these as JavaScript objects would lose the case that matters most: JSON.parse
 * hoists integer-index keys, so a fixture built from parsed objects could never
 * reveal a port that forgot to hoist them.
 */
const JSON_VECTORS: ReadonlyArray<{ name: string; inputText: string }> = [
  { name: 'empty object', inputText: '{}' },
  { name: 'empty array', inputText: '[]' },
  { name: 'unsorted keys', inputText: '{"z":1,"a":2,"m":3,"B":4,"_x":5,"0z":6}' },
  {
    name: 'integer-index keys hoist ahead of sorted string keys',
    inputText: '{"b":1,"10":2,"2":3,"1":4,"0":5,"a":6,"-1":7,"1.0":8,"01":9}',
  },
  {
    name: 'nested objects and arrays',
    inputText: '{"outer":{"inner":[1,{"deep":true},null,"x"]},"list":[[],[[]],{}]}',
  },
  { name: 'booleans and null', inputText: '{"t":true,"f":false,"n":null}' },
  {
    name: 'numbers in every format',
    inputText: '{"i":42,"neg":-7,"d":0.5,"e":1e21,"tiny":5e-324,"zero":0,"negzero":-0}',
  },
  {
    name: 'escapes',
    inputText:
      '{"quote":"a\\"b","back":"a\\\\b","nl":"a\\nb","tab":"a\\tb","cr":"a\\rb","bs":"a\\bb","ff":"a\\fb"}',
  },
  {
    name: 'control characters',
    inputText: '{"nul":"a\\u0000b","unit":"a\\u001fb","del":"a\\u007fb","esc":"a\\u001bb"}',
  },
  {
    name: 'line separators stay raw',
    inputText: '{"ls":"a\\u2028b","ps":"a\\u2029b","nbsp":"a\\u00a0b"}',
  },
  {
    name: 'non-ASCII stays UTF-8',
    inputText: '{"accent":"café","egg":"🥚","cjk":"鶏卵","mixed":"é🙂z"}',
  },
  {
    name: 'UTF-16 key order differs from code-point order',
    inputText: '{"\uffff":1,"😀":2,"z":3,"a":4}',
  },
  {
    name: 'deep nesting with mixed key orders',
    inputText: '{"b":{"z":[1,{"q":1,"p":2}],"a":2},"a":[true,false,null]}',
  },
];

function jsonVectors(): GoldenFile {
  const cases = JSON_VECTORS.map((vector, index) => {
    const parsed: unknown = JSON.parse(vector.inputText);
    return {
      index,
      name: vector.name,
      inputText: vector.inputText,
      /** `JSON.stringify`: insertion order, with JavaScript's integer-key hoisting. */
      stringify: JSON.stringify(parsed),
      /** `canonicalJson()`: every object key sorted, recursively. */
      canonical: canonicalJson(parsed),
    };
  });
  return goldenFile(path.join('vectors', 'canonical-json.json'), {
    fixtureVersion: FIXTURE_VERSION,
    generator: GENERATOR,
    note: 'Two orders, because the engine uses both: the journal hash stringifies with configuration keys in run order and payload keys sorted, while the IR hash sorts everything.',
    cases,
  });
}

/* -------------------------------------------------------------------------- */
/* The set, and the drift gate                                                 */
/* -------------------------------------------------------------------------- */

function goldenFiles(): GoldenFile[] {
  return [
    probeTrace(),
    aracnidTrace('aracnid-nominal-seed7-arc', 'nominal', 7, 'arc', false),
    aracnidTrace('aracnid-nominal-seed7-straight', 'nominal', 7, 'straight', false),
    aracnidTrace('aracnid-tilt-breach-seed7-arc', 'tilt-breach', 7, 'arc', false),
    aracnidTrace('aracnid-fewer-eggs-seed7-arc', 'fewer-eggs-than-hands', 7, 'arc', true),
    numberVectors(),
    jsonVectors(),
  ];
}

function firstDifference(expected: string, actual: string): string {
  const limit = Math.min(expected.length, actual.length);
  for (let index = 0; index < limit; index += 1) {
    if (expected[index] !== actual[index]) {
      const from = Math.max(0, index - 60);
      return `byte ${String(index)}: committed …${expected.slice(from, index + 60)}… regenerated …${actual.slice(from, index + 60)}…`;
    }
  }
  return `lengths differ: committed ${String(expected.length)} bytes, regenerated ${String(actual.length)} bytes`;
}

describe('golden traces for the C++ engine', () => {
  const files = goldenFiles();

  it('produces a stable set of fixtures', () => {
    const names = files.map((file) => file.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(path.join('traces', 'aracnid-nominal-seed7-arc.json'));
    for (const file of files) {
      expect(file.text.endsWith('\n'), file.name).toBe(true);
      // Nothing in a fixture may depend on when it was generated.
      expect(file.text, file.name).not.toMatch(/generatedAt|"now"|epochRealMs/);
    }
  });

  it('pins the ARACNID hashes the rest of the repository quotes', () => {
    const nominal = files.find((file) => file.name.endsWith('aracnid-nominal-seed7-arc.json'));
    expect(nominal).toBeDefined();
    const fixture = JSON.parse(nominal?.text ?? '{}') as {
      ir: { irHash: string };
      journal: { journalHash: string; eventCount: number };
      run: { status: string; exitCode: number };
    };
    expect(fixture.ir.irHash).toBe(ARACNID_IR_HASH);
    expect(fixture.journal.journalHash).toBe(ARACNID_NOMINAL_JOURNAL_HASH);
    expect(fixture.journal.eventCount).toBe(297);
    expect(fixture.run.status).toBe('completed');
    expect(fixture.run.exitCode).toBe(0);
  });

  it('matches the committed fixtures byte for byte', () => {
    for (const file of files) {
      const target = path.join(FIXTURE_DIR, file.name);
      if (EXPORT) {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.text, 'utf8');
        continue;
      }
      if (!existsSync(target)) {
        throw new Error(
          `missing golden fixture ${path.join('engine/testdata', file.name)} — run \`npm run export:golden\` and commit the result`,
        );
      }
      const committed = readFileSync(target, 'utf8');
      expect(committed, `${file.name}: ${firstDifference(committed, file.text)}`).toBe(file.text);
    }
  });

  it('keeps every fixture under the tracked-file limit', () => {
    // scripts/check-tree.mjs refuses tracked files of 5 MB or more.
    for (const file of files) {
      expect(Buffer.byteLength(file.text, 'utf8'), file.name).toBeLessThan(4 * 1024 * 1024);
    }
  });
});
