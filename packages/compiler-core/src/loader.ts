import { readFileSync } from 'node:fs';

import { parseDocument, type ParseOptions } from 'yaml';

import { AgriScriptError, ERROR_CODES } from './errors.ts';

/**
 * AgriScript is loaded with the strictest YAML settings the pipeline can use:
 *
 * - `uniqueKeys` rejects duplicate mapping keys, so a second `safe_stop` or a
 *   repeated limit cannot silently override a reviewed value;
 * - `merge` is disabled and any `<<:` merge key is rejected outright, so a
 *   recipe cannot pull in unreviewed content by reference;
 * - custom tags are not registered, so no YAML tag can execute or construct
 *   unexpected objects.
 */
export const PARSE_OPTIONS: ParseOptions = Object.freeze({
  strict: true,
  uniqueKeys: true,
  merge: false,
  prettyErrors: true,
});

/** Parses recipe text and returns plain JSON-compatible data. */
export function parseRecipeYaml(sourceText: string): unknown {
  const document = parseDocument(sourceText, PARSE_OPTIONS);

  if (document.errors.length > 0) {
    const messages = document.errors.map((error) => error.message);
    const duplicate = messages.some((message) => /duplicate|unique/i.test(message));
    throw new AgriScriptError(
      duplicate ? ERROR_CODES.duplicateKey : ERROR_CODES.yamlParse,
      `Recipe YAML rejected: ${messages[0] ?? 'unknown parse error'}`,
      messages,
    );
  }

  // Alias expansion is bounded so a small file cannot expand into a large one.
  const data = document.toJS({ maxAliasCount: 100 });
  assertNoMergeKeys(data, '<root>');
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * With `merge: false` a `<<` key survives as an ordinary key instead of being
 * applied. It is still unreviewed content pulled in by reference, so it is
 * rejected explicitly.
 */
function assertNoMergeKeys(value: unknown, location: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoMergeKeys(item, `${location}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (key === '<<') {
      throw new AgriScriptError(
        ERROR_CODES.mergeKey,
        `Recipe YAML rejected: merge keys are not allowed (found at ${location})`,
      );
    }
    assertNoMergeKeys(child, `${location}.${key}`);
  }
}

/** Reads and parses a recipe file. */
export function loadRecipeFile(filePath: string): unknown {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, 'utf8');
  } catch (cause) {
    throw new AgriScriptError(ERROR_CODES.yamlParse, `Could not read recipe file: ${filePath}`, [
      String(cause),
    ]);
  }
  return parseRecipeYaml(sourceText);
}
