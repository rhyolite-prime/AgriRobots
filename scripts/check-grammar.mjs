#!/usr/bin/env node
/**
 * Grammar conformance check for dsl/grammar/agri.task.v1.bnf.
 *
 * The BNF is the authority on what a task may say, so it is treated as a
 * controlled artifact rather than prose. This script fails CI when:
 *
 *   1. the grammar is malformed: a referenced nonterminal is undefined, a
 *      nonterminal is defined twice, or a production is unreachable from the
 *      root (dead grammar);
 *   2. a safety production disappears (deadlines, verify clauses, bounded
 *      loops, permits, guards, the mandatory on_fault clause);
 *   3. a forbidden construct appears as a terminal (shell, network, filesystem,
 *      raw actuator, safety-override or nondeterminism keywords);
 *   4. the grammar and the code drift: the action allow-list in
 *      packages/compiler-core, or the capability allow-list in packages/policy,
 *      no longer maps onto grammar terminals;
 *   5. a .agri example violates a syntactic safety invariant (an actuate
 *      without a deadline and verify clause, an unbounded loop, a retry without
 *      an idempotency key, a guard without a freshness bound).
 *
 * This is a lexical check, not a parser. When the real parser lands, these
 * invariants must survive as parser tests; the check exists so that the grammar,
 * the examples and the allow-lists cannot drift apart in the meantime.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BNF_PATH = 'dsl/grammar/agri.task.v1.bnf';
const IR_PATH = 'packages/compiler-core/src/ir.ts';
const ALLOW_LIST_PATH = 'packages/policy/data/capability-allow-list.yaml';
const EXAMPLES_DIR = 'dsl/examples';

const errors = [];
const notes = [];

function read(relative) {
  const absolute = path.join(ROOT, relative);
  if (!existsSync(absolute)) {
    errors.push(`missing file: ${relative}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. Parse the BNF
// ---------------------------------------------------------------------------

const bnfText = read(BNF_PATH);

/** Strips `;;` comments; the "deliberately absent" list lives in comments. */
function stripBnfComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/;;.*$/, ''))
    .join('\n');
}

function parseProductions(text) {
  const productions = new Map();
  const order = [];
  let current = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    const start = /^<([A-Za-z][A-Za-z0-9_-]*)>\s*::=(.*)$/.exec(line.trim());
    if (start) {
      current = start[1];
      if (productions.has(current)) {
        errors.push(`grammar: nonterminal <${current}> is defined more than once`);
      }
      productions.set(current, [start[2]]);
      order.push(current);
      continue;
    }
    if (current === null) continue;
    if (line.trim() === '') {
      current = null;
      continue;
    }
    productions.get(current).push(line.trim());
  }

  return { productions, order };
}

const stripped = stripBnfComments(bnfText);
const { productions, order } = parseProductions(stripped);

const NONTERMINAL = /<([A-Za-z][A-Za-z0-9_-]*)>/g;
const TERMINAL = /"((?:[^"\\]|\\.)+)"/g;

const definedNames = new Set(productions.keys());
const referencedNames = new Set();
const terminals = new Set();

for (const [name, lines] of productions) {
  const rhs = lines.join(' ');
  for (const match of rhs.matchAll(NONTERMINAL)) {
    if (match[1] !== name) referencedNames.add(match[1]);
  }
  for (const match of rhs.matchAll(TERMINAL)) terminals.add(match[1]);
}

notes.push(`${productions.size} productions, ${terminals.size} terminals`);

if (!definedNames.has('program')) {
  errors.push('grammar: missing root production <program>');
}

for (const name of referencedNames) {
  if (!definedNames.has(name)) {
    errors.push(`grammar: <${name}> is referenced but never defined`);
  }
}

// Reachability from the root: dead productions hide mistakes.
const reachable = new Set();
const queue = ['program'];
while (queue.length > 0) {
  const name = queue.shift();
  if (reachable.has(name) || !productions.has(name)) continue;
  reachable.add(name);
  for (const match of productions.get(name).join(' ').matchAll(NONTERMINAL)) {
    if (!reachable.has(match[1])) queue.push(match[1]);
  }
}
for (const name of order) {
  if (!reachable.has(name)) {
    errors.push(`grammar: <${name}> is unreachable from <program> (dead production)`);
  }
}

// ---------------------------------------------------------------------------
// 2. Required safety productions
// ---------------------------------------------------------------------------

const REQUIRED_TERMINALS = [
  // clause structure
  'task',
  'requires',
  'limits',
  'preflight',
  'steps',
  'on_fault',
  'evidence',
  // bounded, verified actuation
  'actuate',
  'within',
  'verify',
  'on_mismatch',
  'idempotency_key',
  'at_most',
  'times',
  // permission and invariants
  'request_permit',
  'with_permit',
  'guard',
  'every',
  'on_breach',
  '@',
  // sensing with abstention
  'observe',
  'into',
  'abstain_if',
  // suspension and safety requests
  'await',
  'on_timeout',
  'safe_stop',
  'park_tool',
  'degrade_to',
  'notify',
  'severity',
  // termination
  'finish',
  'failed',
];

for (const terminal of REQUIRED_TERMINALS) {
  if (!terminals.has(terminal)) {
    errors.push(`grammar: required safety terminal "${terminal}" is missing`);
  }
}

// ---------------------------------------------------------------------------
// 3. Forbidden constructs
// ---------------------------------------------------------------------------

const FORBIDDEN_TERMINALS = [
  // arbitrary code execution
  'shell',
  'exec',
  'eval',
  'system',
  'script',
  'lua',
  'python',
  // network and filesystem
  'http',
  'https',
  'get',
  'post',
  'put',
  'delete',
  'socket',
  'mqtt',
  'publish',
  'read_file',
  'write_file',
  'import',
  'require',
  // raw actuator access
  'pwm',
  'motor',
  'torque',
  'velocity_cmd',
  'current_cmd',
  // authority over the safety controller
  'grant',
  'clear',
  'override',
  'reset_estop',
  'disable_guard',
  'widen_field',
  'raise_limit',
  'unlock',
  // nondeterminism
  'random',
  'now',
  'today',
];

for (const terminal of FORBIDDEN_TERMINALS) {
  if (terminals.has(terminal)) {
    errors.push(
      `grammar: forbidden terminal "${terminal}" is present; see section 6 of ${BNF_PATH}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Grammar <-> code coupling
// ---------------------------------------------------------------------------

/** Action name in packages/compiler-core -> grammar terminals that express it. */
const ACTION_TO_GRAMMAR = {
  navigate: ['move'],
  dock: ['dock'],
  return_to: ['return_to'],
  dispense_mass: ['actuate'],
  collect_egg: ['actuate'],
  apply_volume: ['actuate'],
  mechanical_weed: ['actuate'],
  inspect: ['observe'],
  scan_row: ['observe'],
  record: ['record'],
  park_tool: ['park_tool'],
  safe_stop: ['safe_stop'],
  notify: ['notify'],
};

/** Sensing capabilities whose base name is not an ALLOWED_ACTIONS entry. */
const CAPABILITY_TO_STATEMENT = {
  inspect_plant: 'observe',
};

function extractAllowedActions(sourceText) {
  const block = /ALLOWED_ACTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(sourceText);
  if (!block) {
    errors.push(`${IR_PATH}: could not find the ALLOWED_ACTIONS list`);
    return [];
  }
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function extractCapabilityIds(sourceText) {
  return [...sourceText.matchAll(/^\s*-\s*id:\s*([a-z0-9_.]+)\s*$/gm)].map((m) => m[1]);
}

const allowedActions = extractAllowedActions(read(IR_PATH));
const missingActions = allowedActions.filter((action) => !(action in ACTION_TO_GRAMMAR));
const extraActions = Object.keys(ACTION_TO_GRAMMAR).filter(
  (action) => !allowedActions.includes(action),
);

for (const action of missingActions) {
  errors.push(
    `drift: action "${action}" is in ${IR_PATH} ALLOWED_ACTIONS but has no grammar mapping in this script`,
  );
}
for (const action of extraActions) {
  errors.push(
    `drift: action "${action}" is mapped to the grammar but is not in ALLOWED_ACTIONS (${IR_PATH})`,
  );
}

for (const [action, grammarTerminals] of Object.entries(ACTION_TO_GRAMMAR)) {
  for (const terminal of grammarTerminals) {
    if (!terminals.has(terminal)) {
      errors.push(
        `drift: action "${action}" needs grammar terminal "${terminal}", which is missing`,
      );
    }
  }
}

// Capability identifiers must be lexable by the grammar's <capability-id>.
const CAPABILITY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*\.v[0-9]+$/;
const capabilityIds = extractCapabilityIds(read(ALLOW_LIST_PATH));
if (capabilityIds.length === 0) {
  errors.push(`${ALLOW_LIST_PATH}: no capability ids found; cannot cross-check the grammar`);
}
for (const capability of capabilityIds) {
  if (!CAPABILITY_ID_PATTERN.test(capability)) {
    errors.push(
      `drift: capability "${capability}" does not match the grammar production <capability-id>`,
    );
    continue;
  }
  const base = capability.replace(/\.v[0-9]+$/, '');
  const kind = base in ACTION_TO_GRAMMAR ? 'actuate' : CAPABILITY_TO_STATEMENT[base];
  if (!kind) {
    errors.push(
      `drift: capability "${capability}" maps to no statement kind; add it to ALLOWED_ACTIONS or to CAPABILITY_TO_STATEMENT`,
    );
    continue;
  }
  const expected = kind === 'actuate' ? (ACTION_TO_GRAMMAR[base] ?? ['actuate']) : [kind];
  for (const terminal of expected) {
    if (!terminals.has(terminal)) {
      errors.push(`drift: capability "${capability}" needs grammar terminal "${terminal}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Example conformance (lexical invariants)
// ---------------------------------------------------------------------------

const STATEMENT_KEYWORDS = [
  'move',
  'dock',
  'return_to',
  'actuate',
  'observe',
  'await',
  'with_permit',
  'request_permit',
  'guard',
  'for_each',
  'repeat',
  'when',
  'parallel',
  'sequence',
  'record',
  'safe_stop',
  'park_tool',
  'degrade_to',
  'notify',
  'run_task',
  'finish',
  'noop',
];

const FORBIDDEN_EXAMPLE_WORDS =
  /\b(shell|exec|eval|system|script|http|https|socket|mqtt|publish|read_file|write_file|import|pwm|motor|torque|grant|override|reset_estop|disable_guard|raise_limit|random|now|today)\b/;

/** Window from a keyword occurrence up to the next statement keyword. */
function statementWindow(text, fromIndex) {
  const rest = text.slice(fromIndex);
  const nextKeyword = new RegExp(`\\b(${STATEMENT_KEYWORDS.join('|')})\\b`, 'g');
  nextKeyword.lastIndex = rest.indexOf(' ', 1) + 1;
  const match = nextKeyword.exec(rest);
  return match ? rest.slice(0, match.index) : rest;
}

function stripAgriComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function checkExample(file, rawText) {
  const text = stripAgriComments(rawText);
  const relative = path.relative(ROOT, file);

  const requiredClauses = [
    ['task header', /\btask\s+[a-z0-9][a-z0-9-]*@[0-9]+\.[0-9]+\.[0-9]+\s*\{/],
    ['requires', /\brequires\s*\{/],
    ['limits', /\blimits\s*\{/],
    ['preflight', /\bpreflight\s*\{/],
    ['steps', /\bsteps\s*\{/],
    ['on_fault', /\bon_fault\s*\{/],
    ['evidence', /\bevidence\s*\{/],
  ];
  for (const [name, pattern] of requiredClauses) {
    if (!pattern.test(text)) errors.push(`${relative}: missing mandatory ${name} clause`);
  }

  const forbidden = FORBIDDEN_EXAMPLE_WORDS.exec(text);
  if (forbidden) {
    errors.push(`${relative}: uses forbidden construct "${forbidden[1]}"`);
  }

  // actuate -> deadline + verification
  for (const match of text.matchAll(/\bactuate\b/g)) {
    const window = statementWindow(text, match.index);
    if (!/\bwithin\b\s+[0-9]/.test(window)) {
      errors.push(
        `${relative}: "actuate" at offset ${match.index} has no "within <duration>" deadline`,
      );
    }
    if (!/\bverify\s*\{/.test(window)) {
      errors.push(
        `${relative}: "actuate" at offset ${match.index} has no "verify { }" post-conditions`,
      );
    }
    if (/\bretry\b/.test(window) && !/\bidempotency_key\b/.test(window)) {
      errors.push(
        `${relative}: "actuate" at offset ${match.index} retries without an idempotency_key`,
      );
    }
  }

  // loops -> explicit bound
  for (const match of text.matchAll(/\bfor_each\b/g)) {
    const window = statementWindow(text, match.index);
    if (!/\bat_most\b\s+[0-9]+/.test(window)) {
      errors.push(
        `${relative}: "for_each" at offset ${match.index} has no "at_most <integer>" bound`,
      );
    }
  }
  for (const match of text.matchAll(/\brepeat\b/g)) {
    const window = statementWindow(text, match.index);
    if (!/\b[0-9]+\s+times\b/.test(window)) {
      errors.push(
        `${relative}: "repeat" at offset ${match.index} is not bounded by "<integer> times"`,
      );
    }
  }

  // guards -> freshness bound and period
  for (const match of text.matchAll(/\bguard\b/g)) {
    const window = statementWindow(text, match.index);
    if (!/@\s*within\b/.test(window)) {
      errors.push(
        `${relative}: "guard" at offset ${match.index} has no "@ within <duration>" freshness bound`,
      );
    }
    if (!/\bevery\b\s+[0-9]/.test(window)) {
      errors.push(
        `${relative}: "guard" at offset ${match.index} has no "every <duration>" check period`,
      );
    }
  }

  // observation -> binding
  for (const match of text.matchAll(/\bobserve\b/g)) {
    const window = statementWindow(text, match.index);
    if (!/\binto\b\s+\$/.test(window)) {
      errors.push(
        `${relative}: "observe" at offset ${match.index} has no "into $variable" binding`,
      );
    }
  }

  // suspension -> deadline
  for (const match of text.matchAll(/\bawait\b/g)) {
    const window = statementWindow(text, match.index);
    if (!/\bwithin\b\s+[0-9]/.test(window)) {
      errors.push(
        `${relative}: "await" at offset ${match.index} has no "within <duration>" deadline`,
      );
    }
  }

  // motion -> deadline
  for (const keyword of ['move', 'dock', 'return_to']) {
    for (const match of text.matchAll(new RegExp(`\\b${keyword}\\b`, 'g'))) {
      const window = statementWindow(text, match.index);
      if (!/\bwithin\b\s+[0-9]/.test(window)) {
        errors.push(
          `${relative}: "${keyword}" at offset ${match.index} has no "within <duration>" deadline`,
        );
      }
    }
  }

  // failure termination -> error code
  for (const match of text.matchAll(/\bfinish\s+failed\b/g)) {
    const window = statementWindow(text, match.index);
    if (!/\bfinish\s+failed\s+[A-Z][A-Z0-9_]+/.test(window)) {
      errors.push(
        `${relative}: "finish failed" at offset ${match.index} has no UPPER_SNAKE error code`,
      );
    }
  }

  // permits -> a block or an explicit denial path
  for (const match of text.matchAll(/\brequest_permit\b/g)) {
    const window = statementWindow(text, match.index);
    if (!/\bon_denied\b/.test(window)) {
      errors.push(`${relative}: "request_permit" at offset ${match.index} has no "on_denied" path`);
    }
  }
}

const examplesDir = path.join(ROOT, EXAMPLES_DIR);
if (!existsSync(examplesDir)) {
  errors.push(`missing directory: ${EXAMPLES_DIR}`);
} else {
  const examples = readdirSync(examplesDir)
    .filter((name) => name.endsWith('.agri'))
    .sort();
  if (examples.length === 0) {
    errors.push(`${EXAMPLES_DIR}: no .agri grammar conformance examples found`);
  }
  for (const name of examples) {
    const file = path.join(examplesDir, name);
    checkExample(file, readFileSync(file, 'utf8'));
  }
  notes.push(`${examples.length} .agri examples checked`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`Grammar conformance check failed (${errors.length} problems):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error(`\nAuthority: ${BNF_PATH} (see also dsl/grammar/README.md).`);
  process.exit(1);
}

console.log(`Grammar conformance check passed (${notes.join('; ')}).`);
