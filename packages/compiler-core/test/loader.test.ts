import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AgriScriptError,
  DSL_EXAMPLES_DIR,
  loadRecipeFile,
  parseRecipeYaml,
  repoFile,
} from '../src/index.ts';

function exampleFiles(): string[] {
  const dir = repoFile(DSL_EXAMPLES_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => path.join(dir, name));
}

describe('AgriScript YAML loader', () => {
  it('loads every shipped example recipe', () => {
    const files = exampleFiles();
    expect(files.length).toBeGreaterThanOrEqual(4);

    for (const file of files) {
      const document = loadRecipeFile(file) as { apiVersion: string; kind: string };
      expect(document.apiVersion, file).toBe('agri.script/v1');
      expect(document.kind, file).toBe('Task');
    }
  });

  it('rejects duplicate mapping keys instead of letting the last one win', () => {
    expect(() => parseRecipeYaml('limits:\n  deadline_s: 60\n  deadline_s: 600\n')).toThrowError(
      AgriScriptError,
    );

    try {
      parseRecipeYaml('spec:\n  a: 1\n  a: 2\n');
      expect.unreachable('duplicate key should have been rejected');
    } catch (error) {
      expect((error as AgriScriptError).code).toBe('E_YAML_DUPLICATE_KEY');
    }
  });

  it('rejects merge keys so unreviewed content cannot be pulled in', () => {
    const source = 'base: &base\n  deadline_s: 60\nspec:\n  <<: *base\n';
    expect(() => parseRecipeYaml(source)).toThrowError(AgriScriptError);
  });

  it('reports malformed YAML with an actionable message', () => {
    expect(() => parseRecipeYaml('spec: [unclosed\n')).toThrowError(/Recipe YAML rejected/);
  });

  it('fails clearly when a repository file is missing', () => {
    expect(() => repoFile('dsl', 'examples', 'does-not-exist.yaml')).toThrowError(
      /Expected repository file not found/,
    );
  });
});
