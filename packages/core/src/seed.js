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

/** eSIM plans per destination, mirroring esimPlansFor. */
const esimFor = (dest) => {
  if (dest.kind === 'home')
    return [
      { name: 'Orange eSIM · 5 GB', termsKey: 'esim.localValid30', price: 3000, network: 'Orange' },
      { name: 'MTN eSIM · 10 GB', termsKey: 'esim.localValid30', price: 5000, network: 'MTN', bonus: '+1 GB' },
      { name: 'Moov eSIM · 3 GB', termsKey: 'esim.localValid30', price: 2000, network: 'Moov' },
    ];
  if (dest.code === 'WA')
    return [
      { name: 'West Africa · 5 GB', termsKey: 'esim.regionalValid', termsParams: { days: 15 }, price: 6500, network: 'Travel' },
      { name: 'West Africa · 10 GB', termsKey: 'esim.regionalValid', termsParams: { days: 30 }, price: 11000, network: 'Travel', bonusKey: 'esim.bestValue' },
    ];
  if (dest.code === 'GL')
    return [
      { name: 'Global · 3 GB', termsKey: 'esim.travelGlobal', termsParams: { days: 15 }, price: 9000, network: 'Travel' },
      { name: 'Global · 10 GB', termsKey: 'esim.travelGlobal', termsParams: { days: 30 }, price: 22000, network: 'Travel' },
    ];
  return [
    { name: `${dest.name} · 1 GB`, termsKey: 'esim.travelValid', termsParams: { days: 7 }, price: 3500, network: 'Travel' },
    { name: `${dest.name} · 3 GB`, termsKey: 'esim.travelValid', termsParams: { days: 15 }, price: 7500, network: 'Travel', bonusKey: 'esim.popular' },
    { name: `${dest.name} · 10 GB`, termsKey: 'esim.travelValid', termsParams: { days: 30 }, price: 16000, network: 'Travel' },
  ];
};

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

  for (const dest of ESIM_DESTINATIONS) {
    for (const plan of esimFor(dest)) {
      push({
        id: `esim-${dest.code}-${plan.name}`.toLowerCase().replace(/[\s·]+/g, '-'),
        type: 'esim',
        name: plan.name,
        termsKey: plan.termsKey,
        termsParams: plan.termsParams ?? null,
        bonus: plan.bonus ?? null,
        bonusKey: plan.bonusKey ?? null,
        price: plan.price,
        country: dest.name,
        network: plan.network,
      });
    }
  }

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
