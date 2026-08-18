import { EUR_PEG } from '@topup/core';
import type { Env } from '../env';
import { checkBalance } from './lafricamobile';
import { balance as yesimBalance, yesimConfigured } from './yesim';
import { marginPct } from './esim-plans';

/**
 * What is left to sell with, on every rail at once.
 *
 * Distribution does not fail by breaking; it fails by running out of money.
 * The APIs stay up, the app keeps taking orders, and every delivery returns an
 * insufficient-funds error the customer reads as "your app is broken". Both
 * rails prepay — airtime float at the distributor, a euro wallet at Yesim — so
 * these two numbers are the ones worth watching daily.
 *
 * Each rail reports its own status and no rail can fail the call. A dead
 * distributor must not hide a healthy eSIM wallet: an operations screen that
 * goes blank when one thing breaks is worse than one that says which thing.
 */

export type RailBalance = {
  rail: 'lafricamobile' | 'yesim';
  label: string;
  status: 'ok' | 'not_configured' | 'error';
  error?: string;
  /** Airtime float, per country, already in XOF. */
  balances?: Array<{ country: string; balance: number }>;
  /** A wallet balance in the provider's own currency. */
  amount?: number;
  currency?: string;
  /** The same money in XOF, so one screen speaks one currency. */
  xof?: number;
  /**
   * Roughly how many more sales this covers at what we are currently selling.
   * A euro figure means nothing at a glance; "eleven more eSIMs" is a decision.
   */
  covers?: number | null;
};

/**
 * What one eSIM costs us on average, in EUR.
 *
 * Derived from the shelf rather than stored: `products.price` is the retail XOF
 * we set, and pricing is a pure function of the wholesale cost, so the cost is
 * recoverable by running that function backwards. This keeps the estimate true
 * when the margin changes, which a stored average would not.
 */
async function avgEsimCostEur(env: Env): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT AVG(price) AS avg FROM products WHERE type = 'esim' AND enabled = 1 AND price > 0`,
  ).first<{ avg: number | null }>();
  const avgXof = Number(row?.avg ?? 0);
  if (!Number.isFinite(avgXof) || avgXof <= 0) return null;
  return avgXof / (1 + marginPct(env) / 100) / EUR_PEG;
}

async function airtimeFloat(env: Env): Promise<RailBalance> {
  const label = 'Airtime float · LAfricaMobile';
  const res = await checkBalance(env);
  if (!res.ok) {
    return {
      rail: 'lafricamobile',
      label,
      status: res.error === 'not_configured' ? 'not_configured' : 'error',
      error: res.error,
    };
  }
  const total = res.balances.reduce((sum, b) => sum + (Number(b.balance) || 0), 0);
  return {
    rail: 'lafricamobile',
    label,
    status: 'ok',
    balances: res.balances,
    amount: total,
    currency: 'XOF',
    xof: total,
  };
}

async function esimWallet(env: Env): Promise<RailBalance> {
  const label = 'eSIM wallet · Yesim';
  if (!yesimConfigured(env)) return { rail: 'yesim', label, status: 'not_configured', error: 'not_configured' };

  const res = await yesimBalance(env);
  if (!res.ok) return { rail: 'yesim', label, status: 'error', error: res.error };

  // The field arrives as a string on some responses and a number on others.
  const amount = Number(res.data?.balance ?? 0);
  if (!Number.isFinite(amount)) return { rail: 'yesim', label, status: 'error', error: 'bad_balance' };

  const currency = res.data?.currency || 'EUR';
  const cost = await avgEsimCostEur(env);
  return {
    rail: 'yesim',
    label,
    status: 'ok',
    amount,
    currency,
    // Only the euro peg is a fact; anything else would need a rate we do not have.
    xof: currency.toUpperCase() === 'EUR' ? Math.round(amount * EUR_PEG) : undefined,
    covers: cost && cost > 0 ? Math.floor(amount / cost) : null,
  };
}

/** Both rails, in parallel, neither able to fail the other. */
export async function providerBalances(env: Env): Promise<{ rails: RailBalance[] }> {
  const rails = await Promise.all([airtimeFloat(env), esimWallet(env)]);
  return { rails };
}
