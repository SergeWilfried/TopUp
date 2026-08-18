// Catalogue seed, expressed as translation keys rather than resolved strings.
//
// Once the catalogue lives in a database the rows must survive a language
// switch, so anything that is prose is stored as a key plus its interpolation
// params and resolved per request. Anything that is a unit ("150 MB", "1 GB",
// "500 FCFA") or a proper noun is stored literally — translating those would be
// wrong, not merely unnecessary.
import { CARRIERS, ESIM_DESTINATIONS, fmtN } from './data';

const HOME = 'Côte d’Ivoire';

const AIRTIME = [500, 1000, 2000, 5000, 10000];

const DATA = [
  { name: '150 MB', termsKey: 'packs.valid24h', price: 200 },
  { name: '1 GB', termsKey: 'packs.valid7d', price: 500 },
  { name: '3 GB', termsKey: 'packs.valid30d', price: 1500, bonus: '+500 MB' },
  { name: '5 GB', termsKey: 'packs.valid30d', price: 2500 },
  { name: '10 GB', termsKey: 'packs.valid30d', price: 5000, bonus: '+2 GB' },
  { nameKey: 'packs.night2gb', name: 'Night 2 GB', termsKey: 'packs.nightWindow', price: 300 },
];

const VPN = [
  { nameKey: 'vpn.plan7', name: '7 days', termsKey: 'vpn.planDevices2', price: 3000, days: 7 },
  { nameKey: 'vpn.plan30', name: '30 days', termsKey: 'vpn.planDevices2', price: 6000, days: 30, bonusKey: 'vpn.popular' },
  { nameKey: 'vpn.plan90', name: '90 days', termsKey: 'vpn.planDevices5', price: 15000, days: 90 },
  { nameKey: 'vpn.plan365', name: '1 year', termsKey: 'vpn.planDevices5', price: 45000, days: 365, bonusKey: 'vpn.bestValue' },
];

export const destinationSeed = () =>
  ESIM_DESTINATIONS.map((d, i) => ({
    code: d.code,
    name: d.name,
    kind: d.kind,
    coverageKey: d.coverageKey,
    sortOrder: i,
  }));

/**
 * Every sellable line. Airtime and data expand per carrier because the same
 * pack is a separate SKU on each network.
 */
export const catalogueSeed = () => {
  const rows = [];
  let order = 0;
  const push = (row) => rows.push({ currency: 'XOF', sortOrder: order++, ...row });

  for (const carrier of CARRIERS) {
    for (const amount of AIRTIME) {
      push({
        id: `air-${carrier.name}-${amount}`.toLowerCase(),
        type: 'airtime',
        name: `${fmtN(amount)} FCFA`,
        termsKey: 'packs.airtimeCredit',
        bonus: amount >= 5000 ? '+10% BONUS' : amount >= 1000 ? '+5% BONUS' : null,
        price: amount,
        country: HOME,
        network: carrier.name,
      });
    }
    for (const pack of DATA) {
      push({
        id: `data-${carrier.name}-${pack.name}`.toLowerCase().replace(/\s+/g, '-'),
        type: 'data',
        name: pack.name,
        nameKey: pack.nameKey ?? null,
        termsKey: pack.termsKey,
        bonus: pack.bonus ?? null,
        price: pack.price,
        country: HOME,
        network: carrier.name,
      });
    }
  }

  // eSIM plans are deliberately not seeded. They are the provider's plans,
  // pulled in by the sync with the provider plan id in `bundle_id`; a seeded
  // row has no such id and cannot be provisioned, so it would be a product in
  // the shop that fails after payment. The destinations are seeded; the plans
  // arrive with the first sync.

  for (const plan of VPN) {
    push({
      id: `vpn-${plan.days}d`,
      type: 'vpn',
      name: plan.name,
      nameKey: plan.nameKey,
      termsKey: plan.termsKey,
      bonusKey: plan.bonusKey ?? null,
      price: plan.price,
      days: plan.days,
      // VPN is sold against neither a country nor a network.
      country: null,
      network: null,
    });
  }

  return rows;
};
