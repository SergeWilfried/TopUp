import { now } from '../env';
import type { Env } from '../env';
import type { DeliveryOutcome, DeliveryProvider, DeliveryRequest } from './types';

/**
 * Stand-in for a real airtime distributor.
 *
 * LAfricaMobile reads fine with the current credentials — `GET /checkbundle`
 * returns live bundles — but sending rejects them, so nothing can actually be
 * delivered yet. This keeps the rest of the system exercisable end to end
 * meanwhile: orders move paid → delivering → delivered, the console shows real
 * figures, and the app's post-purchase screens have something to display.
 *
 * Enabled only by an explicit `MOCK_DELIVERY=1`. Deliberately not tied to
 * ENVIRONMENT, which is pinned to "production" even on a laptop and has already
 * caused one class of accident here.
 */
export const mockEnabled = (env: Env) => env.MOCK_DELIVERY === '1';

/**
 * Amounts that force an outcome, so the unhappy paths stay reachable without
 * waiting for a provider to misbehave. Everything else succeeds.
 */
const FORCED: Record<number, DeliveryOutcome> = {
  13: { status: 'failed', reason: 'mock_forced_failure' },
  17: { status: 'unknown', providerRef: 'MOCK-UNKNOWN', reason: 'mock_forced_timeout' },
};

export function mockProvider(env: Env): DeliveryProvider {
  return {
    name: 'mock',

    supports(req: DeliveryRequest) {
      if (!mockEnabled(env)) return false;
      // Same surface a real distributor would serve, so switching to one does
      // not change which orders are accepted.
      return req.product === 'airtime' || req.product === 'data';
    },

    async deliver(req: DeliveryRequest): Promise<DeliveryOutcome> {
      const forced = FORCED[req.amount];
      if (forced) {
        console.warn(`[mock] forcing ${forced.status} for ${req.orderId} (amount ${req.amount})`);
        return forced;
      }
      console.log(`[mock] delivered ${req.product} ${req.amount} to ${req.msisdn}`);
      return { status: 'delivered', providerRef: `MOCK-${req.orderId}-${now()}` };
    },

    /** A mock reference always resolves; nothing is genuinely in flight. */
    async check(providerRef: string): Promise<DeliveryOutcome> {
      return providerRef.startsWith('MOCK-UNKNOWN')
        ? { status: 'unknown', providerRef, reason: 'mock_still_unknown' }
        : { status: 'delivered', providerRef };
    },
  };
}
