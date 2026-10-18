import { z } from 'zod';
import { HttpError } from './http.ts';

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export type Cursor = { createdAt: string; id: string };

export type Page<T> = { items: T[]; next_cursor: string | null };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string') {
      return { createdAt: value[0], id: value[1] };
    }
  } catch {
    // fall through to the 400 below
  }
  throw new HttpError(400, 'invalid_cursor', 'cursor is malformed');
}

/** Rows must be fetched newest first with `limit + 1` rows so we can tell whether another page exists. */
export function toPage<T extends { created_at: string; id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const hasMore = rows.length > limit;
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}
