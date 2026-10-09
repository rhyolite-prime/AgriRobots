import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DSL_EXAMPLES_DIR, ParseError, parseTaskSource, repoFile } from '../src/index.ts';
import type { Statement, TaskAst } from '../src/lang/ast.ts';

function examples(): Array<{ name: string; source: string }> {
  const dir = repoFile(DSL_EXAMPLES_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.agri'))
    .sort()
    .map((name) => ({ name, source: readFileSync(path.join(dir, name), 'utf8') }));
}

function collect(statements: Statement[], out: Statement[] = []): Statement[] {
  for (const statement of statements) {
    out.push(statement);
    for (const key of ['body', 'otherwise'] as const) {
      const nested = (statement as unknown as Record<string, unknown>)[key];
      if (Array.isArray(nested)) collect(nested as Statement[], out);
    }
    if (statement.kind === 'parallel') {
      for (const branch of statement.branches) collect(branch.body, out);
    }
  }
  return out;
}

describe('agri.task/v1 parser', () => {
  it('parses every shipped .agri example', () => {
    const parsed = examples().map(({ name, source }) => ({ name, task: parseTaskSource(source) }));
    expect(parsed.length).toBe(3);

    for (const { name, task } of parsed) {
      expect(task.name, name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(task.version, name).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
      expect(task.requires.capabilities.length, name).toBeGreaterThan(0);
      expect(task.steps.length, name).toBeGreaterThan(0);
      expect(task.onFault.length, name).toBeGreaterThan(0);
      expect(task.evidence.retain.length, name).toBeGreaterThan(0);
    }
  });

  it('reads the ARACNID reference task completely', () => {
    const source = examples().find((example) => example.name.startsWith('aracnid'))!.source;
    const task: TaskAst = parseTaskSource(source);

    expect(task.name).toBe('aracnid-egg-collection');
    expect(task.requires.cassette).toBe('EG-08');
    expect(task.requires.capabilities).toEqual(['scan_nest.v1', 'pick_egg.v1', 'place_egg.v1']);
    expect(task.requires.zones).toEqual(['lay-house-3', 'egg-room']);
    expect(task.requires.processApproval).toBe('EGG-08-001');
    expect(task.limits['max_force']).toEqual({ value: 6, unit: 'N' });
    expect(task.limits['travel_speed']).toEqual({ value: 0.15, unit: 'm/s' });
    expect(task.preflight).toHaveLength(8);

    const statements = collect(task.steps);
    const kinds = statements.map((statement) => statement.kind);
    expect(kinds).toContain('move');
    expect(kinds).toContain('dock');
    expect(kinds).toContain('observe');
    expect(kinds).toContain('guard');
    expect(kinds).toContain('parallel');
    expect(kinds).toContain('with_permit');
    expect(kinds).toContain('actuate');
    expect(kinds).toContain('for_each');
    expect(kinds).toContain('finish');

    // Eight concurrent hands, one exclusive instance each.
    const parallel = statements.find((statement) => statement.kind === 'parallel')!;
    expect(parallel.kind).toBe('parallel');
    if (parallel.kind === 'parallel') {
      expect(parallel.branches).toHaveLength(8);
      expect(parallel.join).toEqual({ kind: 'quorum', count: 6 });
      const instances = parallel.branches.map((branch) => branch.resource.instance);
      expect(instances).toEqual([
        'hand_1',
        'hand_2',
        'hand_3',
        'hand_4',
        'hand_5',
        'hand_6',
        'hand_7',
        'hand_8',
      ]);
    }

    // Every pick carries a deadline and three verified post-conditions.
    const picks = statements.filter(
      (statement) => statement.kind === 'actuate' && statement.capability === 'pick_egg.v1',
    );
    expect(picks).toHaveLength(8);
    for (const pick of picks) {
      if (pick.kind !== 'actuate') continue;
      expect(pick.within.ms).toBe(8000);
      expect(pick.verify).toHaveLength(3);
      expect(pick.onMismatch).toEqual({ kind: 'fault' });
    }

    // Placement claims the hand and the magazine together.
    const place = statements.find(
      (statement) => statement.kind === 'actuate' && statement.capability === 'place_egg.v1',
    );
    expect(place?.kind).toBe('actuate');
    if (place?.kind === 'actuate') {
      expect(place.using?.map((spec) => spec.klass)).toEqual(['tool', 'tool']);
      expect(place.onMismatch?.kind).toBe('retry');
      if (place.onMismatch?.kind === 'retry') {
        expect(place.onMismatch.atMost).toBe(1);
        expect(place.onMismatch.backoff?.ms).toBe(2000);
      }
    }

    // The guard carries a freshness bound and a period.
    const guard = statements.find((statement) => statement.kind === 'guard');
    expect(guard?.kind).toBe('guard');
    if (guard?.kind === 'guard') {
      expect(guard.every.ms).toBe(500);
      expect(guard.condition.kind).toBe('binary');
      expect(guard.onBreach).toEqual({ kind: 'fault' });
    }
  });

  it('parses quantities, units, enums, variables and freshness bounds', () => {
    const task = parseTaskSource(`task probe@1.0.0 {
      requires { cassette FD-01 with dispense_mass.v1; operator supervisor_on_site; zones z-1; }
      limits { travel_speed = 0.40 m/s; task_deadline = 30 min; }
      preflight { safety.mode == #READY @ within 500 ms; }
      steps {
        look: observe scan_nest.v1 (bank = #nest_bank_3, min_confidence = 0.80 ratio)
              into $nest within 5 s abstain_if $nest.confidence < 0.80;
        done: finish success;
      }
      on_fault { halt: safe_stop reason = task.fault_reason; stop: finish failed X_1; }
      evidence { retain journal; }
    }`);

    expect(task.limits['task_deadline']).toEqual({ value: 30, unit: 'min' });
    const observe = collect(task.steps).find((s) => s.kind === 'observe');
    expect(observe?.kind).toBe('observe');
    if (observe?.kind === 'observe') {
      expect(observe.into).toBe('nest');
      expect(observe.within?.ms).toBe(5000);
      expect(observe.args[1]?.value).toEqual({
        kind: 'quantity',
        value: { value: 0.8, unit: 'ratio' },
        span: observe.args[1]!.value.span,
      });
    }
    // A compound condition carries its freshness bound at assertion level;
    // a bare state reference carries it on the reference itself.
    const assertion = task.preflight[0]!;
    expect(assertion.freshness?.ms).toBe(500);
    expect(assertion.condition.kind).toBe('binary');
    if (assertion.condition.kind === 'binary') {
      expect(assertion.condition.right).toMatchObject({ kind: 'enum', name: 'READY' });
      expect(assertion.condition.left).toMatchObject({
        kind: 'ref',
        base: { type: 'state', root: 'safety' },
        steps: [{ type: 'field', name: 'mode' }],
      });
    }
  });

  it('rejects constructs the grammar does not have', () => {
    const base = (steps: string): string => `task probe@1.0.0 {
      requires { cassette FD-01 with dispense_mass.v1; operator supervisor_on_site; zones z-1; }
      limits { travel_speed = 0.40 m/s; }
      preflight { safety.mode == #READY @ within 500 ms; }
      steps { ${steps} }
      on_fault { halt: safe_stop; stop: finish failed X_1; }
      evidence { retain journal; }
    }`;

    expect(() => parseTaskSource(base('run_shell "ls"; done: finish success;'))).toThrowError(
      ParseError,
    );
    expect(() => parseTaskSource(base('done: finish success;'))).not.toThrow();

    // actuate without a deadline / verify clause is not derivable
    expect(() =>
      parseTaskSource(base('go: actuate dispense_mass.v1 (mass = 2 kg); done: finish success;')),
    ).toThrowError(/within|duration/i);

    // unbounded loop does not exist
    expect(() =>
      parseTaskSource(base('loop: for_each $x in tool.holding_hands { done: finish success; };')),
    ).toThrowError(/at_most/);

    // unknown permit kind
    expect(() =>
      parseTaskSource(
        base('p: with_permit grant_everything { done: finish success; }; done2: finish success;'),
      ),
    ).toThrowError(/permit kind/);

    // unknown state root
    expect(() =>
      parseTaskSource(
        base('w: when database.rows > 0 { done: finish success; }; done2: finish success;'),
      ),
    ).toThrowError(/unexpected identifier "database"/);
  });

  it('reports the line and column of a syntax error', () => {
    try {
      parseTaskSource('task probe@1.0.0 {\n  requires { cassette FD-01 ; }\n}\n');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).message).toContain('line 2');
    }
  });
});
