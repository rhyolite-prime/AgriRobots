#!/usr/bin/env node
/**
 * Repository boundary check.
 *
 * The architecture in docs/08_IMPLEMENTATION_PLAN.md section 3.1 is a control
 * decision, not a suggestion: the Virtual Lab, simulation, compiler, edge
 * runtime and fleet services must stay separable, and the safety controller must
 * stay independent of all of them. This script fails CI when a boundary
 * disappears or when safety-controller logic is placed in a non-safety tree.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const MAX_TRACKED_FILE_BYTES = 5 * 1024 * 1024;

/** Boundary -> marker file that proves the boundary still exists. */
const REQUIRED_BOUNDARIES = [
  ['apps/virtual-lab', 'README.md', 'Nuxt 4 Virtual Lab (browser studio)'],
  ['packages/contracts', 'package.json', 'Versioned cross-subsystem contracts'],
  ['packages/domain-model', 'package.json', 'AP-01/UCI-01/cassette identifiers and manifests'],
  ['packages/compiler-core', 'package.json', 'AgriScript loader, schema validation and IR'],
  ['packages/policy', 'package.json', 'Capability allow-list and approval gating'],
  ['packages/asset-import', 'README.md', 'GLTF/URDF import and asset checks (planned)'],
  ['ros_ws/src', 'README.md', 'ROS 2 Jazzy edge packages (planned)'],
  ['simulation/gazebo', 'README.md', 'Gazebo worlds, scenarios and fault injection'],
  ['simulation/replay', 'README.md', 'Recorded-run and dataset replay'],
  ['simulation/hil', 'README.md', 'Power/safety HIL bench adapters'],
  ['ai/datasets', 'README.md', 'Dataset manifests, labels, splits and governance'],
  ['ai/training', 'README.md', 'Reproducible CV/RL training jobs'],
  ['ai/evaluation', 'README.md', 'Held-out, replay and drift evaluation reports'],
  ['fleet/control-plane', 'README.md', 'Non-safety registry, rollout and audit services'],
  ['fleet/schemas', 'README.md', 'Robot, artifact and deployment manifests'],
  ['recipes', 'README.md', 'Reviewed and signed pilot recipes'],
  ['test_evidence', 'README.md', 'VVT-* records, reports and configuration hashes'],
  ['dsl/schema', 'agri.script.v1.schema.json', 'AgriScript structural schema'],
  ['docs', '08_IMPLEMENTATION_PLAN.md', 'Implementation plan'],
];

/** Trees that must never contain safety-controller implementation. */
const NON_SAFETY_TREES = ['apps', 'simulation', 'fleet', 'ai'];
const SAFETY_CONTROLLER_FILE = /safety[_-]?controller|safety[_-]?plc|e[_-]?stop[_-]?logic/i;

const errors = [];

for (const [boundary, marker, purpose] of REQUIRED_BOUNDARIES) {
  const markerPath = path.join(REPO_ROOT, boundary, marker);
  if (!existsSync(markerPath)) {
    errors.push(`missing boundary: ${boundary}/${marker} — ${purpose}`);
  }
}

function walk(dir, visit) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

for (const tree of NON_SAFETY_TREES) {
  walk(path.join(REPO_ROOT, tree), (file) => {
    if (SAFETY_CONTROLLER_FILE.test(path.relative(REPO_ROOT, file))) {
      errors.push(
        `safety independence violation: ${path.relative(REPO_ROOT, file)} must not live under ${tree}/`,
      );
    }
  });
}

let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
} catch {
  tracked = [];
}

for (const file of tracked) {
  const absolute = path.join(REPO_ROOT, file);
  if (!existsSync(absolute)) continue;
  const size = statSync(absolute).size;
  if (size > MAX_TRACKED_FILE_BYTES) {
    errors.push(
      `oversized tracked file: ${file} is ${(size / 1024 / 1024).toFixed(1)} MB (limit 5 MB) — use external storage`,
    );
  }
}

const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
for (const workspace of packageJson.workspaces ?? []) {
  if (!existsSync(path.join(REPO_ROOT, workspace, 'package.json'))) {
    errors.push(`declared workspace has no package.json: ${workspace}`);
  }
}

if (errors.length > 0) {
  console.error('Repository boundary check failed:\n');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('\nSee docs/08_IMPLEMENTATION_PLAN.md section 3.1 for the required boundaries.');
  process.exit(1);
}

console.log(`Repository boundary check passed (${REQUIRED_BOUNDARIES.length} boundaries).`);
