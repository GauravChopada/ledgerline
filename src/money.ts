import { z } from 'zod';

/** All amounts are integer minor units (cents). Floats never touch money. */
export const Cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be an ISO 4217 code such as USD');

export function lineTotal(quantity: number, unitAmountCents: number): number {
  const total = quantity * unitAmountCents;
  if (!Number.isSafeInteger(total)) throw new RangeError('line total overflows');
  return total;
}

export function sumCents(amounts: Iterable<number>): number {
  let total = 0;
  for (const amount of amounts) total += amount;
  if (!Number.isSafeInteger(total)) throw new RangeError('sum overflows');
  return total;
}
