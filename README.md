# ledgerline

> **About this repository.** I built ledgerline to evaluate [Codzee](https://www.codzee.io) for its
> first-round assessment. Pull requests #1–#5 and #7 contain bugs I planted on purpose (#6 is a clean control); the answer key was
> hashed into `main` before any PR was opened. Results and product feedback: **[EVALUATION.md](EVALUATION.md)**.

A small invoicing and payments API for freelancers and small studios: customers, invoices with
line items, payments against invoices, and a monthly revenue report. Multi-tenant, one API key per
tenant.

Built with Node.js (TypeScript run natively, no build step), Fastify, Zod and the built-in
`node:sqlite` module.

## Quick start

```bash
npm install
npm run create-tenant -- "Acme Studio"   # prints an API key once
npm start                                # http://127.0.0.1:3000
```

```bash
KEY=ll_live_...   # from create-tenant

curl -s localhost:3000/customers -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"name":"Ada Lovelace","email":"ada@example.com"}'

curl -s localhost:3000/invoices -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"customer_id":"cus_...","currency":"USD","lines":[{"description":"Design sprint","quantity":1,"unit_amount_cents":150000}]}'
```

Configuration is read from the environment (see `.env.example`): `PORT`, `HOST`, `DATABASE_PATH`,
`LOG_LEVEL`.

## API

Every endpoint except `/health` needs `Authorization: Bearer <api key>`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | public |
| `POST` | `/customers` | `{ name, email }` |
| `GET` | `/customers` | paginated |
| `GET` | `/customers/:id` | |
| `PATCH` | `/customers/:id` | `{ name?, email? }` |
| `GET` | `/customers/:id/invoices` | all of a customer's invoices, any status |
| `POST` | `/invoices` | `{ customer_id, currency, due_at?, lines: [{ description, quantity, unit_amount_cents }] }`, created as `draft` |
| `GET` | `/invoices` | paginated, optional `?status=draft\|open\|paid\|void` |
| `GET` | `/invoices/:id` | includes lines |
| `POST` | `/invoices/:id/finalize` | `draft` → `open` |
| `POST` | `/invoices/:id/void` | only without recorded payments |
| `POST` | `/invoices/:id/payments` | `{ amount_cents, method }`; the invoice becomes `paid` once fully covered |
| `GET` | `/payments` | paginated |
| `GET` | `/reports/revenue?year=2026` | cash received per UTC month and currency |

Errors always look like `{ "error": "<code>", "message": "<human readable>" }`.

## Design notes

- **Money is integer cents.** Amounts are validated as safe integers on the way in and never pass
  through floating point.
- **Tenant isolation.** API keys are stored as SHA-256 hashes. Every query is scoped by
  `tenant_id`; a resource owned by another tenant is reported as `404`, not `403`.
- **Cursor pagination.** Lists are ordered by `(created_at, id)` descending and the cursor encodes
  both, so rows sharing a timestamp are never skipped or repeated. Pages are `{ items, next_cursor }`.
- **Transactions.** `node:sqlite` is synchronous, so a `tx()` block runs to completion before
  anything else touches the connection. Read-check-write sequences live inside one.
- **Migrations** are plain SQL files in `migrations/`, applied in order at startup.

## Development

Requires Node.js 24 or newer.

```bash
npm test            # node --test
npm run typecheck   # tsc --noEmit
npm run dev         # restart on change
```

Tests run against an in-memory database with an injected clock (`buildApp({ db, now })`).

## Roadmap

- Idempotency keys for payment endpoints, and refunds
- Ingest payment-provider webhooks
- Pull data access out of route handlers into a repository layer
- Cut query count on reports and list endpoints
- Container image and preview deployments
- CSV export for accountants

## License

MIT
