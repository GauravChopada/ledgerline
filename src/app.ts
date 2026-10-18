import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth.ts';
import type { Db } from './db.ts';
import { registerErrorHandler } from './http.ts';
import { customerRoutes } from './routes/customers.ts';
import { invoiceRoutes } from './routes/invoices.ts';
import { paymentRoutes } from './routes/payments.ts';
import { reportRoutes } from './routes/reports.ts';
import { webhookRoutes } from './webhooks/routes.ts';

/** What every route module needs. `now` is injectable so tests control time. */
export type Deps = { db: Db; now: () => Date; webhookSecret?: string };

export type AppOptions = {
  db: Db;
  now?: () => Date;
  /** Shared secret for provider webhook signatures. */
  webhookSecret?: string;
  logger?: boolean | { level: string };
};

export function buildApp({ db, now = () => new Date(), webhookSecret, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  registerErrorHandler(app);
  registerAuth(app, db);

  app.get('/health', { config: { public: true } }, async () => ({ ok: true }));

  const deps: Deps = { db, now, webhookSecret };
  customerRoutes(app, deps);
  invoiceRoutes(app, deps);
  paymentRoutes(app, deps);
  reportRoutes(app, deps);
  webhookRoutes(app, deps);

  return app;
}
