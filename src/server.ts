import { buildApp } from './app.ts';
import { openDb } from './db.ts';
import { sandboxProvider } from './provider.ts';

const db = openDb(process.env.DATABASE_PATH ?? 'ledgerline.db');
// Card payments run in test mode until a live gateway adapter lands.
const app = buildApp({ db, provider: sandboxProvider(), logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    db.close();
  });
}
