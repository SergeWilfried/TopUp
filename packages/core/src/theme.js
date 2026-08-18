// Modernist design tokens — mirror of the design system's styles.css
export const C = {
  bg: '#f3f2f2', surface: '#eae9e9', text: '#201e1d', accent: '#ec3013',
  accent600: '#dd2b0f', accent700: '#ae1800', accent100: '#fff2ef', accent800: '#7c1405',
  /**
   * Small red type on a light ground — kickers, arrows, ghost buttons, status
   * labels, the active tab. `accent` (#ec3013) is 3.8:1 against `bg`, under
   * the 4.5:1 that text below ~19px needs; this deep red is 6.4:1 and is
   * already the system's "accent deep". `accent` stays for fills, borders,
   * highlights and display sizes, where 3:1 is the bar.
   */
  accentText: '#ae1800',
  neutral200: '#eae7e7', neutral800: '#444141',
  divider: 'rgba(32,30,29,0.4)', rule: 'rgba(32,30,29,0.25)',
  // 0.55 read as 3.7:1 on `bg` — every 12px caption in the app failed AA.
  // 0.68 is 5.4:1 on `bg` and 5.2:1 on `surface` while still clearly secondary.
  muted: 'rgba(32,30,29,0.68)', muted70: 'rgba(32,30,29,0.7)',
};
export const S = { s1: 4, s2: 8, s3: 12, s4: 16, s6: 24, s8: 32 };
// Radius is 0 everywhere by design — Modernist has no rounded corners.
export const R = 0;
export const F = { heading: 'Archivo_800ExtraBold', semi: 'Archivo_600SemiBold', body: 'Archivo_400Regular' };
