/**
 * A renderer for compiled `agri.expr/v1` nodes.
 *
 * Structural on purpose: the browser must be able to show what the compiler
 * produced without importing the compiler, and the server uses the same code so
 * the two never disagree about how a condition reads.
 */
export interface ExprNode {
  kind: string;
  [key: string]: unknown;
}

function isNode(value: unknown): value is ExprNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

function renderMany(nodes: unknown, join: string): string {
  return Array.isArray(nodes) ? nodes.map((node) => renderExpr(node)).join(join) : '';
}

export function renderExpr(node: unknown): string {
  if (!isNode(node)) return String(node ?? '');
  switch (node.kind) {
    case 'quantity':
      return `${String(node['value'])} ${String(node['unit'])}`;
    case 'number':
    case 'string':
    case 'boolean':
      return typeof node['value'] === 'string'
        ? `"${String(node['value'])}"`
        : String(node['value']);
    case 'null':
      return 'null';
    case 'enum':
      return `#${String(node['name'])}`;
    case 'ref': {
      const base = node['base'] as { type?: string; root?: string; name?: string } | undefined;
      let out =
        base?.type === 'variable' ? `$${String(base.name ?? '')}` : String(base?.root ?? '');
      for (const step of (node['steps'] ?? []) as Array<Record<string, unknown>>) {
        if (step['type'] === 'field') out += `.${String(step['name'])}`;
        else out += `[${renderExpr(step['expr'])}]`;
      }
      const freshness = node['freshnessMs'];
      return typeof freshness === 'number' ? `${out} @ within ${String(freshness)} ms` : out;
    }
    case 'call':
      return `${String(node['name'])}(${renderMany(node['args'], ', ')})`;
    case 'unary':
      return `${String(node['op'])}${renderExpr(node['operand'])}`;
    case 'binary':
      return `${renderExpr(node['left'])} ${String(node['op'])} ${renderExpr(node['right'])}`;
    case 'list':
      return `[${renderMany(node['items'], ', ')}]`;
    case 'struct': {
      const fields = (node['fields'] ?? []) as Array<Record<string, unknown>>;
      return `{ ${fields.map((field) => `${String(field['name'])}: ${renderExpr(field['value'])}`).join(', ')} }`;
    }
    default:
      return JSON.stringify(node);
  }
}

export interface AssertionNode {
  condition: unknown;
  freshnessMs?: number;
}

/** `carrier.tilt < 4 deg @ within 200 ms` — how the source wrote it. */
export function renderAssertion(assertion: AssertionNode): string {
  const condition = renderExpr(assertion.condition);
  return typeof assertion.freshnessMs === 'number'
    ? `${condition} @ within ${String(assertion.freshnessMs)} ms`
    : condition;
}
