import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth.ts';
import type { Db } from './db.ts';
import { registerErrorHandler } from './http.ts';
import type { PaymentProvider } from './provider.ts';
import { customerRoutes } from './routes/customers.ts';
import { invoiceRoutes } from './routes/invoices.ts';
import { paymentRoutes } from './routes/payments.ts';
import { reportRoutes } from './routes/reports.ts';

/** What every route module needs. `now` is injectable so tests control time. */
export type Deps = { db: Db; now: () => Date; provider: PaymentProvider };

export type AppOptions = {
  db: Db;
  provider: PaymentProvider;
  now?: () => Date;
  logger?: boolean | { level: string };
};

export function buildApp({ db, provider, now = () => new Date(), logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  registerErrorHandler(app);
  registerAuth(app, db);

  app.get('/health', { config: { public: true } }, async () => ({ ok: true }));

  const deps: Deps = { db, now, provider };
  customerRoutes(app, deps);
  invoiceRoutes(app, deps);
  paymentRoutes(app, deps);
  reportRoutes(app, deps);

  return app;
}
