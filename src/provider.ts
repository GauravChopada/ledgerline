import { HttpError } from './http.ts';

export type ChargeRequest = {
  amountCents: number;
  currency: string;
  /** Tokenised card from the client-side SDK, e.g. `tok_visa`. */
  source: string;
  description: string;
};

export type PaymentProvider = {
  charge(request: ChargeRequest): Promise<{ chargeId: string }>;
  refund(chargeId: string, amountCents: number): Promise<void>;
};

/**
 * Test-mode gateway used in development and tests. Records every call; any source starting with
 * `tok_fail` is declined.
 */
export function sandboxProvider() {
  const charges: (ChargeRequest & { chargeId: string })[] = [];
  const refunds: { chargeId: string; amountCents: number }[] = [];
  const latency = () => new Promise((resolve) => setTimeout(resolve, 5));

  const provider: PaymentProvider & { charges: typeof charges; refunds: typeof refunds } = {
    charges,
    refunds,
    async charge(request) {
      await latency();
      if (request.source.startsWith('tok_fail')) throw new HttpError(402, 'card_declined', 'the card was declined');
      const chargeId = `ch_sandbox_${charges.length + 1}`;
      charges.push({ ...request, chargeId });
      return { chargeId };
    },
    async refund(chargeId, amountCents) {
      await latency();
      refunds.push({ chargeId, amountCents });
    },
  };
  return provider;
}
