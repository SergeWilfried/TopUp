// Shared Modernist primitives and the single stylesheet every screen draws from.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C, S, F, fmt } from '@topup/core';

export const Kicker = ({ children, light }) => (
  <Text style={[st.kicker, light && { color: 'rgba(243,242,242,0.85)' }]}>{children}</Text>
);

export const Btn = ({ label, onPress, variant = 'primary', disabled, style }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      st.btn,
      variant === 'primary' && { backgroundColor: pressed ? C.accent600 : C.accent },
      variant === 'secondary' && { borderWidth: 1, borderColor: C.divider, backgroundColor: pressed ? 'rgba(32,30,29,0.07)' : 'transparent' },
      variant === 'ghost' && { paddingHorizontal: S.s1, backgroundColor: pressed ? 'rgba(236,48,19,0.1)' : 'transparent' },
      disabled && { opacity: 0.45 },
      style,
    ]}
  >
    <Text style={[st.btnLabel, variant === 'primary' && { color: C.bg }, variant === 'ghost' && { color: C.accent }]}>{label}</Text>
  </Pressable>
);

export const Tag = ({ children, kind = 'accent' }) => (
  <Text style={[st.tag, kind === 'accent' ? { backgroundColor: C.accent100, color: C.accent800 } : { backgroundColor: C.neutral200, color: C.neutral800 }]}>
    {children}
  </Text>
);

export const BackHeader = ({ onBack, label }) => (
  <View style={st.backHeader}>
    <Btn variant="ghost" label="←" onPress={onBack} />
    <Text style={st.stepLabel}>{label}</Text>
  </View>
);

// Two-up card grid for bundles. Each card carries its own frame and the cards
// sit apart, so a tap target reads as one object.
export const PackGrid = ({ items, onSelect }) => {
  return (
    <View style={st.grid}>
      {items.map((p) => (
        <Pressable
          key={p.n}
          onPress={() => onSelect(p)}
          style={({ pressed }) => [st.gridCell, pressed && { backgroundColor: C.accent100, borderColor: C.accent }]}
        >
          <View style={{ minHeight: 20 }}>{p.b ? <Tag>{p.b}</Tag> : null}</View>
          <View>
            <Text style={st.packName}>{p.n}</Text>
            <Text style={st.subText}>{p.v}</Text>
          </View>
          <View style={[st.rowBetween, { marginTop: 12 }]}>
            {/* Airtime packs are named by their price — don't print it twice. */}
            <Text style={st.packPrice}>{p.n === fmt(p.p) ? '' : fmt(p.p)}</Text>
            <Text style={st.arrow}>→</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
};

export const SummaryRow = ({ k, v, bold }) => (
  <View style={st.sumRow}>
    <Text style={[st.sumKey, bold && st.sumBold]}>{k}</Text>
    <Text style={[st.sumVal, bold && st.sumBold]}>{v}</Text>
  </View>
);

export const Toggle2 = ({ opts, value, onChange }) => (
  <View style={st.toggleWrap}>
    {opts.map((o) => (
      <Pressable key={String(o.val)} onPress={() => onChange(o.val)} style={[st.toggleOpt, o.val === value && { backgroundColor: C.text }]}>
        <Text style={[st.toggleLabel, o.val === value && { color: C.bg }]}>{o.label}</Text>
      </Pressable>
    ))}
  </View>
);

// Screen title bar used by the tab pages.
export const TabHeader = ({ title, right }) => (
  <View style={[st.header, st.rowBetween, { borderBottomWidth: 2, borderColor: C.divider }]}>
    {typeof title === 'string' ? <Text style={st.h2}>{title}</Text> : title}
    {right}
  </View>
);

export const Brand = () => (
  <Text style={st.brand}>TOPUP<Text style={{ color: C.accent }}>.</Text></Text>
);

// Bottom tab bar. `insetBottom` keeps labels clear of the home indicator
// while the bar's background still bleeds to the physical screen edge.
export const TabBar = ({ items, value, onChange, insetBottom = 0 }) => (
  <View style={{ flexDirection: 'row', borderTopWidth: 2, borderColor: C.divider, paddingBottom: insetBottom }}>
    {items.map((n) => (
      <Pressable
        key={n.val}
        onPress={() => onChange(n.val)}
        style={{ flex: 1, paddingVertical: 14, alignItems: 'center', borderTopWidth: 3, borderColor: value === n.val ? C.accent : 'transparent' }}
      >
        <Text style={{ fontFamily: F.heading, fontSize: 10, letterSpacing: 1.5, color: value === n.val ? C.accent : 'rgba(32,30,29,0.5)' }}>{n.label}</Text>
      </Pressable>
    ))}
  </View>
);

export const st = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingVertical: 14 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontFamily: F.heading, fontSize: 20, color: C.text, letterSpacing: -0.2 },
  poster: { color: C.bg, fontFamily: F.heading, fontSize: 44, lineHeight: 46, letterSpacing: -1 },
  slideGlyph: { fontFamily: F.heading, fontSize: 96, lineHeight: 100, letterSpacing: -3 },
  h1: { fontFamily: F.heading, fontSize: 32, lineHeight: 35, color: C.text, letterSpacing: -0.6, marginTop: 8 },
  h2: { fontFamily: F.heading, fontSize: 24, color: C.text, letterSpacing: -0.4 },
  kicker: { fontFamily: F.semi, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: C.accent, marginBottom: 4 },
  subText: { fontFamily: F.body, fontSize: 12, color: C.muted, lineHeight: 17 },
  rowTitle: { fontFamily: F.semi, fontSize: 14, color: C.text },
  tileLabel: { fontFamily: F.heading, fontSize: 14, letterSpacing: 0.8, color: C.text },
  btn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnLabel: { fontFamily: F.heading, fontSize: 14, color: C.text, letterSpacing: 0.3 },
  tag: { fontFamily: F.semi, fontSize: 11, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  backHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderColor: C.divider },
  stepLabel: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1.4, color: C.text },
  fieldLabel: { fontFamily: F.body, fontSize: 12, color: C.muted70, marginBottom: 6 },
  // letterSpacing must be explicit: without it iOS renders the placeholder
  // massively tracked out when a custom font is set.
  input: { minHeight: 48, backgroundColor: C.surface, borderWidth: 1, borderColor: C.divider, paddingHorizontal: 12, fontFamily: F.semi, fontSize: 16, letterSpacing: 0, color: C.text },
  toggleWrap: { flexDirection: 'row', borderWidth: 1, borderColor: C.divider },
  toggleOpt: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  toggleLabel: { fontFamily: F.heading, fontSize: 13, letterSpacing: 0.8, color: 'rgba(32,30,29,0.65)' },
  carrierCell: { flex: 1, borderWidth: 1, borderColor: C.divider, paddingVertical: 12, alignItems: 'center', gap: 2 },
  packRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 14, paddingHorizontal: 2, borderBottomWidth: 1, borderColor: C.rule },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  // 48% + the 12pt gap keeps two cards on a row at every phone width.
  gridCell: { width: '48%', borderWidth: 2, borderColor: C.text, padding: 14, gap: 6, justifyContent: 'space-between', minHeight: 132 },
  packName: { fontFamily: F.heading, fontSize: 16, color: C.text },
  packPrice: { fontFamily: F.heading, fontSize: 14, color: C.text },
  arrow: { color: C.accent, fontFamily: F.heading, fontSize: 16 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderColor: C.rule },
  sumKey: { fontFamily: F.body, fontSize: 14, color: 'rgba(32,30,29,0.6)' },
  sumVal: { fontFamily: F.semi, fontSize: 14, color: C.text },
  sumBold: { fontFamily: F.heading, color: C.text },
  payOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: C.divider },
  radioDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: C.text },
  customBox: { borderWidth: 2, borderColor: C.text, padding: 14, gap: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.rule },
  sectionRule: { borderBottomWidth: 2, borderColor: C.divider, paddingBottom: 8, marginBottom: 4 },
  sectionLabel: { fontFamily: F.semi, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
});
