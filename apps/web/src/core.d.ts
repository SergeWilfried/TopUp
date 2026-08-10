// @topup/core is plain ESM JavaScript; this declares just the surface the web
// app consumes so `tsc` can typecheck against it.
declare module '@topup/core' {
  export type Translate = (key: string, vars?: Record<string, string | number>) => string;
  export type Pack = { n: string; v: string; p: number; b?: string | null; days?: number };
  export type VpnLocation = { name: string; code: string; host: string };

  export const VPN_LOCATIONS: VpnLocation[];
  export const fmt: (n: number) => string;
  export const fmtN: (n: number) => string;
  export const airtimePacks: (t: Translate) => Pack[];
  export const dataPacks: (t: Translate) => Pack[];
  export const vpnPlans: (t: Translate) => Pack[];
}

declare module '@topup/core/locales/en' {
  const resource: Record<string, unknown>;
  export default resource;
}
declare module '@topup/core/locales/fr' {
  const resource: Record<string, unknown>;
  export default resource;
}
