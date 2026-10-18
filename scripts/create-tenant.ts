import { openDb } from '../src/db.ts';
import { createTenant } from '../src/tenants.ts';

const name = process.argv[2];
if (!name) {
  console.error('usage: npm run create-tenant -- "<tenant name>"');
  process.exit(1);
}

const db = openDb(process.env.DATABASE_PATH ?? 'ledgerline.db');
const { tenantId, apiKey } = createTenant(db, name);
console.log(`tenant   ${tenantId}`);
console.log(`api key  ${apiKey}  (shown once, store it somewhere safe)`);
db.close();
