import React from 'react';
import { Image, Text, View } from 'react-native';
import { C, F } from '@topup/core';

/**
 * Operator logos, one per network per market.
 *
 * Metro needs a static `require` per file, so this is a hand-kept map rather
 * than a directory scan. Keys are `Network@CC` for a market-specific mark and a
 * bare `Network` for the general one; lookup tries the specific key first. A
 * network with no entry gets a monogram in its brand colour, so an operator we
 * add before we have its artwork still reads as something rather than nothing.
 *
 * Files live in ./assets/providers. Square marks, ≥ 400 px.
 */
// `zoom` crops a file's own margin: the Orange PNG carries a soft transparent
// border that renders as a ragged halo at 40 px, so it is scaled up until the
// orange square meets the frame. 1 = the file's full extent.
const ORANGE = { src: require('./assets/providers/orange-bf.png'), zoom: 1.16 };
const MOOV = { src: require('./assets/providers/moov-bf.png'), zoom: 1 };
const TELECEL = { src: require('./assets/providers/telecel-bf.jpeg'), zoom: 1 };

const LOGOS = {
  'Orange@BF': ORANGE,
  'Moov@BF': MOOV,
  'Telecel@BF': TELECEL,
  // Same marks stand in for the network's other markets until per-market
  // artwork lands — the Orange square is the group logo; Moov's is close.
  Orange: ORANGE,
  Moov: MOOV,
  Telecel: TELECEL,
};

/** Brand ink for the monogram fallback. Kept muted where a mark is missing. */
const BRAND = {
  Orange: '#FF7900',
  Moov: '#0072BC',
  Telecel: '#1D75BB',
  MTN: '#FFCC00',
  Airtel: '#ED1C24',
  Free: '#CD1E25',
  Safaricom: '#3E9B3D',
  Expresso: '#1B5FAA',
};

export const providerLogo = (network, country) =>
  LOGOS[`${network}@${String(country ?? '').toUpperCase()}`] ?? LOGOS[network] ?? null;

/**
 * A square operator mark, framed the way the app frames flags and codes.
 *
 * `size` is the box; the image fills it. Square art is the contract (see the
 * README in assets/providers) — a landscape file would be cropped, which is
 * the right failure: the box stays the box and the layout does not shift.
 */
export function ProviderLogo({ network, country, size = 36, style }) {
  const logo = providerLogo(network, country);
  const box = { width: size, height: size, borderWidth: 1.5, borderColor: C.text, backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' };
  if (logo) {
    const inner = size - 3;
    const img = Math.round(inner * logo.zoom);
    return (
      <View style={[box, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Image source={logo.src} style={{ width: img, height: img }} resizeMode="cover" />
      </View>
    );
  }
  const brand = BRAND[network] ?? C.text;
  // Yellow needs ink on it; every other brand carries light type.
  const onBrand = network === 'MTN' ? C.text : C.bg;
  return (
    <View style={[box, { backgroundColor: brand, alignItems: 'center', justifyContent: 'center' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={{ fontFamily: F.heading, fontSize: Math.round(size * 0.42), color: onBrand }}>
        {String(network ?? '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** Logo with the name beside it — the header badge on the pack step. */
export function ProviderBadge({ network, country, size = 22 }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <ProviderLogo network={network} country={country} size={size} />
      <Text style={{ fontFamily: F.heading, fontSize: 14, color: C.text }}>{network}</Text>
    </View>
  );
}
