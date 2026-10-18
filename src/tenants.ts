import { createHash, randomBytes } from 'node:crypto';
import { type Db, run, tx } from './db.ts';
import { newId } from './ids.ts';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Creates a tenant with one API key. The plaintext key is returned once and never stored. */
export function createTenant(db: Db, name: string, now = new Date()): { tenantId: string; apiKey: string } {
  const tenantId = newId('ten');
  const apiKey = `ll_live_${randomBytes(24).toString('base64url')}`;
  const createdAt = now.toISOString();
  tx(db, () => {
    run(db, 'INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)', tenantId, name, createdAt);
    run(
      db,
      'INSERT INTO api_keys (id, tenant_id, key_hash, label, created_at) VALUES (?, ?, ?, ?, ?)',
      newId('key'),
      tenantId,
      hashApiKey(apiKey),
      'default',
      createdAt,
    );
  });
  return { tenantId, apiKey };
}
