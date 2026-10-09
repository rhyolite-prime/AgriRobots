import type { Branch, Statement, TaskAst } from './ast.ts';

export interface StatementRef {
  /** Stable id used by the IR, the journal and jump targets. */
  id: string;
  /** Which top-level clause the statement belongs to. */
  clause: 'steps' | 'on_fault';
  /** Source label when the statement carried one. */
  label?: string;
  statement: Statement;
  /** Lexical parents, outermost first. */
  parents: Statement[];
  /** Ids of the lexical parents, outermost first. */
  parentIds: string[];
}

export interface StatementIdMap {
  byId: Map<string, StatementRef>;
  byStatement: Map<Statement, StatementRef>;
  /** Pre-order, source order. */
  order: StatementRef[];
}

function childBlocks(statement: Statement): Array<{ key: string; body: Statement[] }> {
  const blocks: Array<{ key: string; body: Statement[] }> = [];
  const record = statement as unknown as Record<string, unknown>;
  if (Array.isArray(record['body']))
    blocks.push({ key: 'body', body: record['body'] as Statement[] });
  if (Array.isArray(record['otherwise'])) {
    blocks.push({ key: 'otherwise', body: record['otherwise'] as Statement[] });
  }
  if (statement.kind === 'parallel') {
    statement.branches.forEach((branch: Branch, index: number) => {
      blocks.push({ key: `branch:${branch.id ?? String(index)}`, body: branch.body });
    });
  }
  return blocks;
}

/**
 * Assigns a stable id to every statement: the source label when present,
 * otherwise `s<n>` in pre-order. Ids are the currency of the journal, of jump
 * targets and of the IR, so they must be reproducible from source alone.
 */
export function assignStatementIds(task: TaskAst): StatementIdMap {
  const byId = new Map<string, StatementRef>();
  const byStatement = new Map<Statement, StatementRef>();
  const order: StatementRef[] = [];
  let counter = 0;

  const visit = (
    statements: Statement[],
    parents: StatementRef[],
    clause: 'steps' | 'on_fault',
  ): void => {
    for (const statement of statements) {
      counter += 1;
      const label = statement.id;
      const id = label ?? `s${String(counter)}`;
      const ref: StatementRef = {
        id,
        clause,
        ...(label ? { label } : {}),
        statement,
        parents: parents.map((parent) => parent.statement),
        parentIds: parents.map((parent) => parent.id),
      };
      byStatement.set(statement, ref);
      order.push(ref);
      if (!byId.has(id)) byId.set(id, ref);
      visit(
        childBlocks(statement).flatMap((block) => block.body),
        [...parents, ref],
        clause,
      );
    }
  };

  visit(task.steps, [], 'steps');
  visit(task.onFault, [], 'on_fault');
  return { byId, byStatement, order };
}

/** Statements that can change the physical world or move the carrier. */
export function isActuating(statement: Statement): boolean {
  return (
    statement.kind === 'actuate' ||
    statement.kind === 'move' ||
    statement.kind === 'dock' ||
    statement.kind === 'return_to'
  );
}

/** Statements that request less energy or less capability, never more. */
export function isSafetyRequest(statement: Statement): boolean {
  return (
    statement.kind === 'safe_stop' ||
    statement.kind === 'park_tool' ||
    statement.kind === 'degrade_to'
  );
}
