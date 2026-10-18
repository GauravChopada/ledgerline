import type { FastifyInstance } from 'fastify';
import { type Db, get } from './db.ts';
import { hashApiKey } from './tenants.ts';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

/** Every route requires `Authorization: Bearer <api key>` unless it is registered with `config: { public: true }`. */
export function registerAuth(app: FastifyInstance, db: Db): void {
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (req, reply) => {
    if (req.routeOptions.config.public) return;

    const header = req.headers.authorization;
    const key = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
    if (!key) return reply.code(401).send({ error: 'unauthorized', message: 'missing API key' });

    const row = get<{ tenant_id: string }>(
      db,
      'SELECT tenant_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
      hashApiKey(key),
    );
    if (!row) return reply.code(401).send({ error: 'unauthorized', message: 'invalid API key' });

    req.tenantId = row.tenant_id;
  });
}
