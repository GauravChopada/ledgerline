import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Deps } from '../app.ts';
import { get, run, tx } from '../db.ts';
import { HttpError, notFound, parse } from '../http.ts';
import { newId } from '../ids.ts';
import { hashApiKey } from '../tenants.ts';

const TenantParams = z.object({ tenantId: z.string().min(1) });

/**
 * Operator endpoints, authenticated with the ADMIN_TOKEN shared secret instead of a tenant key.
 * Disabled entirely when no admin token is configured.
 */
export function adminRoutes(app: FastifyInstance, { db, now, adminToken }: Deps): void {
  if (!adminToken) return;

  app.post('/admin/tenants/:tenantId/api-keys/rotate', { config: { public: true } }, async (req, reply) => {
    const header = req.headers.authorization ?? '';
    if (header !== `Bearer ${adminToken}`) throw new HttpError(401, 'unauthorized', 'invalid admin token');

    const { tenantId } = parse(TenantParams, req.params);
    if (!get(db, 'SELECT 1 FROM tenants WHERE id = ?', tenantId)) throw notFound('tenant');

    const apiKey = `ll_live_${randomBytes(24).toString('base64url')}`;
    const timestamp = now().toISOString();
    tx(db, () => {
      run(db, 'UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL', timestamp, tenantId);
      run(
        db,
        'INSERT INTO api_keys (id, tenant_id, key_hash, label, created_at) VALUES (?, ?, ?, ?, ?)',
        newId('key'),
        tenantId,
        hashApiKey(apiKey),
        'rotated',
        timestamp,
      );
    });
    return reply.code(201).send({ tenant_id: tenantId, api_key: apiKey });
  });
}
