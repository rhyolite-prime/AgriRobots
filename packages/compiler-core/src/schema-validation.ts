import { readFileSync } from 'node:fs';

import addFormats from 'ajv-formats';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import { AgriScriptError, ERROR_CODES } from './errors.ts';
import { AGRI_SCRIPT_SCHEMA_PATH, repoFile } from './repo-paths.ts';

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

/** One Ajv instance per schema; compilation is cached by absolute path. */
const validators = new Map<string, ValidateFunction>();

export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  return ajv;
}

/** Compiles a repository-relative JSON Schema file (2020-12). */
export function compileSchemaFile(relativePath: string): ValidateFunction {
  const absolute = repoFile(relativePath);
  const cached = validators.get(absolute);
  if (cached) return cached;

  let schemaText: string;
  try {
    schemaText = readFileSync(absolute, 'utf8');
  } catch (cause) {
    throw new AgriScriptError(
      ERROR_CODES.schemaUnreadable,
      `Could not read schema file: ${relativePath}`,
      [String(cause)],
    );
  }

  let validate: ValidateFunction;
  try {
    validate = createAjv().compile(JSON.parse(schemaText) as object);
  } catch (cause) {
    throw new AgriScriptError(
      ERROR_CODES.schemaInvalid,
      `Schema ${relativePath} could not be compiled`,
      [String(cause)],
    );
  }

  validators.set(absolute, validate);
  return validate;
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  return errors.map((error) => {
    const location = error.instancePath === '' ? '<root>' : error.instancePath;
    return `${location}: ${error.message ?? 'invalid value'}`;
  });
}

/** Validates any instance against a repository-relative schema. */
export function validateAgainstSchema(
  relativeSchemaPath: string,
  instance: unknown,
): SchemaValidationResult {
  const validate = compileSchemaFile(relativeSchemaPath);
  const valid = validate(instance);
  return {
    valid: valid === true,
    errors: formatAjvErrors(validate.errors),
  };
}

/** Structural validation of an AgriScript `agri.script/v1` recipe document. */
export function validateRecipeDocument(document: unknown): SchemaValidationResult {
  return validateAgainstSchema(AGRI_SCRIPT_SCHEMA_PATH, document);
}
