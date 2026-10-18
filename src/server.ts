import { buildApp } from './app.ts';
import { openDb } from './db.ts';

const db = openDb(process.env.DATABASE_PATH ?? 'ledgerline.db');
const app = buildApp({
  db,
  adminToken: process.env.ADMIN_TOKEN,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    db.close();
  });
}
