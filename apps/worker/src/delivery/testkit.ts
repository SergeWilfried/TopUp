import { registerProvider, type DeliveryOutcome, type DeliveryRequest } from './index';

/**
 * Fake providers for local verification. Registered only outside production so
 * the delivery state machine can be exercised without a real airtime rail.
 */
let registered = false;

export function registerTestProviders() {
  // Idempotent: the dev routes call this per request, and a duplicate
  // registration would shadow the real provider list.
  if (registered) return;
  registered = true;

  const outcomeFor = (req: DeliveryRequest): DeliveryOutcome => {
    if (req.amount === 200) return { status: 'delivered', providerRef: `REF-${req.orderId}` };
    if (req.amount === 500) return { status: 'failed', reason: 'insufficient_float' };
    if (req.amount === 1500) return { status: 'unknown', providerRef: `REF-${req.orderId}`, reason: 'timeout' };
    return { status: 'pending', providerRef: `REF-${req.orderId}` };
  };

  registerProvider({
    name: 'testkit',
    // Scoped to fixture orders only. Registered first, so a catch-all here
    // would hijack every real delivery in the isolate the moment a dev route
    // was touched — which is exactly what happened the first time.
    supports: (req) => req.orderId.startsWith('TX-DEL'),
    deliver: async (req) => outcomeFor(req),
    // Resolves anything previously ambiguous, so the sweep has something to do.
    check: async (ref) => ({ status: 'delivered', providerRef: ref }),
  });
}
