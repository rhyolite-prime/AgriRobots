import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgriScriptError, ERROR_CODES } from './errors.ts';

/** Marker that identifies the repository root regardless of the caller's cwd. */
const ROOT_MARKER = path.join('dsl', 'schema', 'agri.script.v1.schema.json');

export const AGRI_SCRIPT_SCHEMA_PATH = path.join('dsl', 'schema', 'agri.script.v1.schema.json');
export const DSL_EXAMPLES_DIR = path.join('dsl', 'examples');
export const CONTRACT_SCHEMAS_DIR = path.join('packages', 'contracts', 'schemas');
export const MODULE_MANIFEST_SCHEMA_PATH = path.join(
  'packages',
  'domain-model',
  'schemas',
  'agri.module.v1.schema.json',
);

const MAX_PARENT_HOPS = 12;

/** Walks up from this module until the design package marker is found. */
export function findRepoRoot(startDir?: string): string {
  let dir = startDir ?? path.dirname(fileURLToPath(import.meta.url));

  for (let hop = 0; hop < MAX_PARENT_HOPS; hop += 1) {
    if (existsSync(path.join(dir, ROOT_MARKER))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new AgriScriptError(
    ERROR_CODES.repoLayout,
    `Could not locate the repository root (missing ${ROOT_MARKER}).`,
  );
}

/** Absolute path of a repository-relative file, checked to exist. */
export function repoFile(...segments: string[]): string {
  const resolved = path.resolve(findRepoRoot(), ...segments);
  if (!existsSync(resolved)) {
    throw new AgriScriptError(
      ERROR_CODES.repoLayout,
      `Expected repository file not found: ${path.join(...segments)}`,
    );
  }
  return resolved;
}
