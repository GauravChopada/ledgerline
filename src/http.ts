import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'invalid_request', z.prettifyError(result.error));
  return result.data;
}

export const IdParams = z.object({ id: z.string().min(1) });

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    // Fastify's own client errors (malformed JSON, oversized body, ...) carry a 4xx statusCode.
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });
}
