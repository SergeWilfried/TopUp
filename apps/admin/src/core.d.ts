// @topup/core is plain ESM JavaScript; this declares just the surface the admin
// app consumes so `tsc` can typecheck against it.
declare module '@topup/core' {
  export type Translate = (key: string, vars?: Record<string, string | number>) => string;
  export type Pack = { n: string; v: string; p: number; b?: string | null; days?: number; carrier?: string };
  export type VpnLocation = { name: string; code: string; host: string };
  export type EsimCountry = { name: string; code: string; sub: string; type: string };

  export const VPN_LOCATIONS: VpnLocation[];
  export const CARRIERS: { name: string; prefix: string }[];
  export const fmt: (n: number) => string;
  export const fmtN: (n: number) => string;
  export const fmtDate: (ms: number) => string;
  export const airtimePacks: (t: Translate) => Pack[];
  export const dataPacks: (t: Translate) => Pack[];
  export const vpnPlans: (t: Translate) => Pack[];
  export const esimCountries: (t: Translate) => EsimCountry[];
  /** Flag emoji for a two-letter code, or null when one cannot be formed. */
  export const flagFor: (code: string | null | undefined) => string | null;
  /** Markets a customer can pay from, in the order they are offered. */
  export const PAYABLE_COUNTRIES: { code: string; dial: string; nameKey: string }[];
}

declare module '@topup/core/locales/en' {
  const resource: Record<string, unknown>;
  export default resource;
}
