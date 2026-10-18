import { randomBytes } from 'node:crypto';

export type IdPrefix = 'ten' | 'key' | 'cus' | 'inv' | 'lin' | 'pay' | 'ref';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}
