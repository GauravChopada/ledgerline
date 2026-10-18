import type { SQLInputValue } from 'node:sqlite';
import { type Db, all } from '../db.ts';
import { type Cursor, type Page, decodeCursor, toPage } from '../pagination.ts';

export type Filter = { sql: string; params: SQLInputValue[] };

export const eq = (column: string, value: SQLInputValue): Filter => ({ sql: `${column} = ?`, params: [value] });

export const oneOf = (column: string, values: readonly SQLInputValue[]): Filter => ({
  sql: `${column} IN (${values.map(() => '?').join(', ')})`,
  params: [...values],
});

export type PageRequest = { cursor?: string; limit: number };

/**
 * Keyset pagination shared by every list endpoint: newest first, `limit` rows per page.
 * `table` and `columns` are fixed identifiers supplied by the repositories, never request input.
 */
export function paginate<T extends { created_at: string; id: string }>(
  db: Db,
  table: string,
  columns: string,
  filters: Filter[],
  page: PageRequest,
): Page<T> {
  const clauses = filters.map((f) => f.sql);
  const params = filters.flatMap((f) => f.params);

  if (page.cursor) {
    const cursor = tryDecodeCursor(page.cursor);
    // A stale or truncated cursor (old app builds, hand-edited URLs) ends the list instead of erroring.
    if (!cursor) return { items: [], next_cursor: null };
    clauses.push('created_at < ?');
    params.push(cursor.createdAt);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = all<T>(
    db,
    `SELECT ${columns} FROM ${table} ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ...params,
    page.limit + 1,
  );
  return toPage(rows, page.limit);
}

function tryDecodeCursor(raw: string): Cursor | null {
  try {
    return decodeCursor(raw);
  } catch {
    return null;
  }
}
