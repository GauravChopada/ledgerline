import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { type Db, get, run } from './db.ts';
import { HttpError } from './http.ts';

export type StoredResponse = { status: number; body: unknown };

export function idempotencyKey(req: FastifyRequest): string | undefined {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (key === undefined) return undefined;
  if (key.length === 0 || key.length > 255) {
    throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must be 1-255 characters');
  }
  return key;
}

/**
 * Makes a mutating request safe to retry. The first request with a given key runs `handler` and
 * its response is stored; a retry with the same key and the same request gets the stored response
 * back instead of running `handler` again. Server errors are not stored, so they can be retried.
 */
export async function withIdempotency(
  db: Db,
  tenantId: string,
  key: string | undefined,
  request: unknown,
  now: () => Date,
  handler: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  if (key === undefined) return { ...(await handler()), replayed: false };

  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const previous = get<{ fingerprint: string; status: number; body: string }>(
    db,
    'SELECT fingerprint, status, body FROM idempotency_keys WHERE tenant_id = ? AND key = ?',
    tenantId,
    key,
  );
  if (previous) {
    if (previous.fingerprint !== fingerprint) {
      throw new HttpError(422, 'idempotency_key_reused', 'this Idempotency-Key was already used for a different request');
    }
    return { status: previous.status, body: JSON.parse(previous.body), replayed: true };
  }

  const response = await handler();
  if (response.status < 500) {
    run(
      db,
      'INSERT INTO idempotency_keys (tenant_id, key, fingerprint, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      tenantId,
      key,
      fingerprint,
      response.status,
      JSON.stringify(response.body),
      now().toISOString(),
    );
  }
  return { ...response, replayed: false };
}
