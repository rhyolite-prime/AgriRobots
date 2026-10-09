import { AgriScriptError, ERROR_CODES } from '../errors.ts';
import type { Span } from './ast.ts';

export type TokenType =
  'ident' | 'number' | 'version' | 'quantity' | 'string' | 'enum' | 'variable' | 'punct' | 'eof';

export interface Token {
  type: TokenType;
  /**
   * Identifier text, punctuation, string contents, enum or variable name, or
   * the full `x.y.z` text of a version literal.
   */
  value: string;
  /** Numeric value for `number` and `quantity` tokens. */
  number?: number;
  /** Unit for `quantity` tokens. */
  unit?: string;
  span: Span;
}

/**
 * Units from the grammar's <unit> production, longest first so that `m/s` is not
 * lexed as `m` then `/s`, and `min` is not lexed as `m` then `in`.
 */
export const UNITS: readonly string[] = Object.freeze(
  [
    'kg/min',
    'mL/min',
    'kg/s',
    'mL/s',
    'L/min',
    'mm/s',
    'mol/L',
    'g/s',
    'L/s',
    'km/h',
    'degC',
    'mg/L',
    'm/s',
    'rad/s',
    'g/L',
    'kPa',
    'kN',
    'Nm',
    'kg',
    'km',
    'cm',
    'mm',
    'ms',
    'min',
    'mL',
    'm3',
    'Wh',
    'ppm',
    'ratio',
    'count',
    'items',
    'eggs',
    'stations',
    'plants',
    'deg',
    'rad',
    'bar',
    'Pa',
    'N',
    'V',
    'A',
    'W',
    'K',
    'g',
    't',
    'L',
    's',
    'h',
    'm',
    '%',
  ].sort((a, b) => b.length - a.length),
);

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const TWO_CHAR_PUNCT = ['==', '!=', '<=', '>=', '&&', '||'];
const ONE_CHAR_PUNCT = '{}()[];,:=@.<>|+-*/!';

export class LexError extends AgriScriptError {
  constructor(message: string, span: Span) {
    super(ERROR_CODES.yamlParse, message);
    this.name = 'LexError';
    this.span = span;
  }
  readonly span: Span;
}

interface Cursor {
  text: string;
  pos: number;
  line: number;
  column: number;
}

function spanOf(cursor: Cursor, start: number): Span {
  return { start, end: cursor.pos, line: cursor.line, column: cursor.column };
}

/**
 * Tokenises an `agri.task/v1` source. Comments and whitespace are skipped; a
 * number immediately followed by a known unit becomes one `quantity` token, so
 * `12 min` can never be mis-read as `12` and an identifier `min`.
 */
export function tokenize(source: string): Token[] {
  const cursor: Cursor = { text: source, pos: 0, line: 1, column: 1 };
  const tokens: Token[] = [];

  const advance = (count = 1): void => {
    for (let i = 0; i < count; i += 1) {
      const char = cursor.text[cursor.pos];
      if (char === '\n') {
        cursor.line += 1;
        cursor.column = 1;
      } else {
        cursor.column += 1;
      }
      cursor.pos += 1;
    }
  };

  const skipTrivia = (): void => {
    for (;;) {
      const rest = cursor.text.slice(cursor.pos);
      if (/^\s/.test(rest)) {
        advance(1);
        continue;
      }
      if (rest.startsWith('//')) {
        while (cursor.pos < cursor.text.length && cursor.text[cursor.pos] !== '\n') advance(1);
        continue;
      }
      if (rest.startsWith('/*')) {
        const end = cursor.text.indexOf('*/', cursor.pos + 2);
        if (end < 0) {
          throw new LexError('unterminated block comment', spanOf(cursor, cursor.pos));
        }
        advance(end + 2 - cursor.pos);
        continue;
      }
      return;
    }
  };

  while (cursor.pos < cursor.text.length) {
    skipTrivia();
    if (cursor.pos >= cursor.text.length) break;

    const start = cursor.pos;
    const startLine = cursor.line;
    const startColumn = cursor.column;
    const char = cursor.text[cursor.pos] as string;
    const span = (): Span => ({ start, end: cursor.pos, line: startLine, column: startColumn });

    // string literal
    if (char === '"') {
      advance(1);
      let value = '';
      for (;;) {
        if (cursor.pos >= cursor.text.length) {
          throw new LexError('unterminated string literal', span());
        }
        const current = cursor.text[cursor.pos] as string;
        if (current === '"') {
          advance(1);
          break;
        }
        if (current === '\\') {
          advance(1);
          const escaped = cursor.text[cursor.pos];
          switch (escaped) {
            case 'n':
              value += '\n';
              break;
            case 't':
              value += '\t';
              break;
            case 'r':
              value += '\r';
              break;
            case '"':
              value += '"';
              break;
            case '\\':
              value += '\\';
              break;
            default:
              throw new LexError(`unknown escape \\${escaped ?? ''}`, span());
          }
          advance(1);
          continue;
        }
        value += current;
        advance(1);
      }
      tokens.push({ type: 'string', value, span: span() });
      continue;
    }

    // enum literal  #hand_1
    if (char === '#') {
      advance(1);
      let name = '';
      while (
        cursor.pos < cursor.text.length &&
        IDENT_CHAR.test(cursor.text[cursor.pos] as string)
      ) {
        name += cursor.text[cursor.pos];
        advance(1);
      }
      if (name.length === 0) throw new LexError('empty enum literal after #', span());
      tokens.push({ type: 'enum', value: name, span: span() });
      continue;
    }

    // variable  $held
    if (char === '$') {
      advance(1);
      let name = '';
      while (
        cursor.pos < cursor.text.length &&
        IDENT_CHAR.test(cursor.text[cursor.pos] as string)
      ) {
        name += cursor.text[cursor.pos];
        advance(1);
      }
      if (name.length === 0) throw new LexError('empty variable name after $', span());
      tokens.push({ type: 'variable', value: name, span: span() });
      continue;
    }

    // version literal `1.0.0`: one token, so `task x@1.0.0` cannot be read as
    // a decimal number followed by a stray `.0`
    const versionMatch = /^[0-9]+\.[0-9]+\.[0-9]+(?![0-9.])/.exec(cursor.text.slice(cursor.pos));
    if (versionMatch) {
      advance(versionMatch[0].length);
      tokens.push({ type: 'version', value: versionMatch[0], span: span() });
      continue;
    }

    // number, possibly with a unit
    if (DIGIT.test(char) || (char === '.' && DIGIT.test(cursor.text[cursor.pos + 1] ?? ''))) {
      let raw = '';
      while (cursor.pos < cursor.text.length && /[0-9]/.test(cursor.text[cursor.pos] as string)) {
        raw += cursor.text[cursor.pos];
        advance(1);
      }
      if (cursor.text[cursor.pos] === '.') {
        raw += '.';
        advance(1);
        while (cursor.pos < cursor.text.length && /[0-9]/.test(cursor.text[cursor.pos] as string)) {
          raw += cursor.text[cursor.pos];
          advance(1);
        }
      }
      if (/[eE]/.test(cursor.text[cursor.pos] ?? '')) {
        raw += cursor.text[cursor.pos];
        advance(1);
        if (/[+-]/.test(cursor.text[cursor.pos] ?? '')) {
          raw += cursor.text[cursor.pos];
          advance(1);
        }
        while (cursor.pos < cursor.text.length && /[0-9]/.test(cursor.text[cursor.pos] as string)) {
          raw += cursor.text[cursor.pos];
          advance(1);
        }
      }

      // Unit lookahead: skip spaces, match the longest unit, and require a
      // non-identifier boundary after it (so `3 times` is not `3 t` + `imes`).
      const numberEnd = cursor.pos;
      let probe = numberEnd;
      while (probe < cursor.text.length && /[ \t]/.test(cursor.text[probe] as string)) probe += 1;
      const rest = cursor.text.slice(probe);
      const unit = UNITS.find(
        (candidate) =>
          rest.startsWith(candidate) &&
          !IDENT_CHAR.test(rest.slice(candidate.length, candidate.length + 1) || ' '),
      );

      if (unit) {
        advance(probe - cursor.pos + unit.length);
        tokens.push({
          type: 'quantity',
          value: unit,
          unit,
          number: Number(raw),
          span: span(),
        });
      } else {
        tokens.push({ type: 'number', value: raw, number: Number(raw), span: span() });
      }
      continue;
    }

    // hash literal: one lexical unit, never number-then-identifier fragments
    const hashMatch = /^(sha256|ed25519):[0-9A-Za-z+/=_-]{16,}/.exec(cursor.text.slice(cursor.pos));
    if (hashMatch) {
      advance(hashMatch[0].length);
      tokens.push({ type: 'ident', value: hashMatch[0], span: span() });
      continue;
    }

    // identifier (hyphens allowed without surrounding spaces: lay-house-3)
    if (IDENT_START.test(char)) {
      let value = '';
      while (
        cursor.pos < cursor.text.length &&
        IDENT_CHAR.test(cursor.text[cursor.pos] as string)
      ) {
        value += cursor.text[cursor.pos];
        advance(1);
      }
      while (
        cursor.text[cursor.pos] === '-' &&
        IDENT_CHAR.test(cursor.text[cursor.pos + 1] ?? '')
      ) {
        value += '-';
        advance(1);
        while (
          cursor.pos < cursor.text.length &&
          IDENT_CHAR.test(cursor.text[cursor.pos] as string)
        ) {
          value += cursor.text[cursor.pos];
          advance(1);
        }
      }
      tokens.push({ type: 'ident', value, span: span() });
      continue;
    }

    // punctuation
    const two = cursor.text.slice(cursor.pos, cursor.pos + 2);
    if (TWO_CHAR_PUNCT.includes(two)) {
      advance(2);
      tokens.push({ type: 'punct', value: two, span: span() });
      continue;
    }
    if (ONE_CHAR_PUNCT.includes(char)) {
      advance(1);
      tokens.push({ type: 'punct', value: char, span: span() });
      continue;
    }

    throw new LexError(`unexpected character ${JSON.stringify(char)}`, span());
  }

  tokens.push({
    type: 'eof',
    value: '',
    span: {
      start: cursor.pos,
      end: cursor.pos,
      line: cursor.line,
      column: cursor.column,
    },
  });
  return tokens;
}
