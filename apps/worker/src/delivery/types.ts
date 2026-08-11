/**
 * Order lifecycle and the delivery port.
 *
 * Paying for a top-up and receiving it are two different events, and until now
 * the code pretended they were one: capturing a payment wrote `delivered`
 * straight to the order, so every dashboard figure counted money we had taken
 * as goods we had shipped. Airtime delivery is a call to a third party that can
 * fail, be slow, or — the hard case — leave us genuinely unsure.
 */

export const ORDER_STATUSES = [
  'pending', // payment not settled yet
  'failed', // payment failed; nothing was taken
  'paid', // money captured, delivery not started
  'delivering', // handed to a delivery provider, awaiting outcome
  'delivered', // the customer has their airtime
  'delivery_failed', // provider said no; the customer is owed a refund
  'delivery_unknown', // see below
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * `delivery_unknown` is the state that exists because USSD will eventually be a
 * provider here. A dropped session after the PIN step is indistinguishable
 * between "sent" and "not sent", and the only safe response is to stop: never
 * auto-retry, never auto-refund, park it for reconciliation. An HTTP provider
 * reaches this state too — a timeout on the request is exactly the same
 * problem, and pretending otherwise is how a customer gets charged twice.
 */
export const NEEDS_RECONCILIATION: OrderStatus = 'delivery_unknown';

/**
 * Statuses where we are holding the customer's money.
 *
 * Revenue is cash captured, not parcels shipped — an order paid at 23:58 and
 * delivered at 00:02 belongs to the day it was paid. Kept as one list so the
 * console's totals cannot drift from the lifecycle as states are added.
 */
export const PAID_STATUSES: readonly OrderStatus[] = [
  'paid',
  'delivering',
  'delivered',
  'delivery_failed',
  'delivery_unknown',
];

/** Statuses where the customer actually received what they bought. */
export const FULFILLED_STATUSES: readonly OrderStatus[] = ['delivered'];

/** Money taken and not given back — what "revenue" means on the dashboard. */
export const REVENUE_STATUSES: readonly OrderStatus[] = PAID_STATUSES;

/** Orders needing a human: paid for, and not delivered. */
export const ATTENTION_STATUSES: readonly OrderStatus[] = ['delivery_failed', 'delivery_unknown'];

/** `status IN (…)` fragment. Values are from a closed list, never user input. */
export const sqlIn = (statuses: readonly OrderStatus[]) =>
  statuses.map((s) => `'${s}'`).join(', ');

// ── the provider port ───────────────────────────────────────────────────────

export type DeliveryRequest = {
  orderId: string;
  /** Airtime, data or eSIM — providers cover different subsets. */
  product: string;
  /** Catalogue line, so a provider can map to its own SKU. */
  sku: string | null;
  /** Face value in XOF. */
  amount: number;
  /** The line being topped up, normalised. */
  msisdn: string;
  /** ISO-2 of the recipient's country, which decides the provider. */
  country: string;
  network: string | null;
  /** Distributor's opaque id for a data bundle. Airtime has none. */
  bundleId: string | null;
};

/**
 * What a provider can tell us.
 *
 * `unknown` is a first-class answer rather than an error, because the honest
 * response to a timeout is "ask me later", and a provider that can only say
 * yes or no will say the wrong one.
 */
export type DeliveryOutcome =
  | { status: 'delivered'; providerRef: string }
  | { status: 'pending'; providerRef: string }
  | { status: 'failed'; reason: string }
  | { status: 'unknown'; providerRef: string | null; reason: string };

export interface DeliveryProvider {
  readonly name: string;
  /** Whether this provider serves that country and product at all. */
  supports(req: DeliveryRequest): boolean;
  /**
   * Attempt delivery. Implementations must send `orderId` as their own
   * idempotency key wherever the API allows it, so a retry of a request we
   * never saw the response to cannot deliver twice.
   */
  deliver(req: DeliveryRequest): Promise<DeliveryOutcome>;
  /**
   * Re-read an outcome by reference. This is what resolves `delivery_unknown`,
   * so a provider without it forces every ambiguous order to a human.
   */
  check?(providerRef: string): Promise<DeliveryOutcome>;
}
