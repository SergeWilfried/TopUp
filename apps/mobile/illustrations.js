import React from 'react';
import Svg, { Circle, Line, Path, Rect, G } from 'react-native-svg';
import { C } from '@topup/core';

/**
 * Empty-state illustrations.
 *
 * Drawn rather than picked from an icon set, because an icon at 96px reads as a
 * mistake — a scaled-up glyph with the wrong stroke weight sitting in a screen
 * that is otherwise all hairlines. These follow the same rules as the rest of
 * the system: square corners, 2px structural strokes, one accent, no fill.
 *
 * Each is a plain component taking `size`, so they compose like text.
 */

const STROKE = C.text;
const ACCENT = C.accent;
const MUTED = C.divider;

/** No purchases yet — a receipt with nothing printed on it. */
export const NoHistory = ({ size = 104 }) => (
  <Svg width={size} height={size} viewBox="0 0 104 104" fill="none">
    {/* torn receipt */}
    <Path
      d="M26 14h52v66l-8-5-8 5-8-5-8 5-8-5-8 5V14z"
      stroke={STROKE}
      strokeWidth={2}
      strokeLinejoin="round"
    />
    <Line x1="38" y1="32" x2="66" y2="32" stroke={MUTED} strokeWidth={2} />
    <Line x1="38" y1="44" x2="58" y2="44" stroke={MUTED} strokeWidth={2} />
    <Line x1="38" y1="56" x2="62" y2="56" stroke={MUTED} strokeWidth={2} />
    {/* the accent marks where an amount would be */}
    <Line x1="38" y1="68" x2="48" y2="68" stroke={ACCENT} strokeWidth={2} />
  </Svg>
);

/** Nothing on sale — an empty shelf grid. */
export const NoPacks = ({ size = 104 }) => (
  <Svg width={size} height={size} viewBox="0 0 104 104" fill="none">
    <Rect x="16" y="20" width="30" height="30" stroke={STROKE} strokeWidth={2} />
    <Rect x="58" y="20" width="30" height="30" stroke={MUTED} strokeWidth={2} />
    <Rect x="16" y="58" width="30" height="30" stroke={MUTED} strokeWidth={2} />
    <Rect x="58" y="58" width="30" height="30" stroke={STROKE} strokeWidth={2} />
    {/* one slot deliberately struck through: sold out, not broken */}
    <Line x1="58" y1="20" x2="88" y2="50" stroke={ACCENT} strokeWidth={2} />
  </Svg>
);

/** No eSIM profiles — a SIM outline with an empty chip. */
export const NoEsim = ({ size = 104 }) => (
  <Svg width={size} height={size} viewBox="0 0 104 104" fill="none">
    <Path d="M28 16h34l14 14v58H28V16z" stroke={STROKE} strokeWidth={2} strokeLinejoin="round" />
    <Path d="M62 16v14h14" stroke={STROKE} strokeWidth={2} strokeLinejoin="round" />
    <Rect x="40" y="46" width="26" height="24" stroke={ACCENT} strokeWidth={2} />
    <Line x1="40" y1="54" x2="66" y2="54" stroke={MUTED} strokeWidth={2} />
    <Line x1="40" y1="62" x2="66" y2="62" stroke={MUTED} strokeWidth={2} />
    <Line x1="53" y1="46" x2="53" y2="70" stroke={MUTED} strokeWidth={2} />
  </Svg>
);

/** No VPN locations — a globe with no pin dropped. */
export const NoLocations = ({ size = 104 }) => (
  <Svg width={size} height={size} viewBox="0 0 104 104" fill="none">
    <Circle cx="52" cy="52" r="30" stroke={STROKE} strokeWidth={2} />
    <Line x1="22" y1="52" x2="82" y2="52" stroke={MUTED} strokeWidth={2} />
    <Path d="M52 22c10 10 10 50 0 60-10-10-10-50 0-60z" stroke={MUTED} strokeWidth={2} />
    <Path d="M30 34c12 7 32 7 44 0M30 70c12-7 32-7 44 0" stroke={MUTED} strokeWidth={2} />
    {/* the pin that is not there yet */}
    <Circle cx="52" cy="52" r="5" stroke={ACCENT} strokeWidth={2} />
  </Svg>
);

/** Cannot reach the API — a broken link, not a sad face. */
export const Offline = ({ size = 104 }) => (
  <Svg width={size} height={size} viewBox="0 0 104 104" fill="none">
    <G>
      <Path d="M44 34l-10 10a14 14 0 0020 20l4-4" stroke={STROKE} strokeWidth={2} strokeLinecap="round" />
      <Path d="M60 70l10-10a14 14 0 00-20-20l-4 4" stroke={STROKE} strokeWidth={2} strokeLinecap="round" />
      <Line x1="30" y1="30" x2="74" y2="74" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" />
    </G>
  </Svg>
);

/** Search returned nothing — a lens over blank rules. */
export const NoResults = ({ size = 104 }) => (
  <Svg width={size} height={size} viewBox="0 0 104 104" fill="none">
    <Line x1="22" y1="26" x2="82" y2="26" stroke={MUTED} strokeWidth={2} />
    <Line x1="22" y1="38" x2="66" y2="38" stroke={MUTED} strokeWidth={2} />
    <Circle cx="46" cy="58" r="18" stroke={STROKE} strokeWidth={2} />
    <Line x1="59" y1="71" x2="78" y2="90" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
