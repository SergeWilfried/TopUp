import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { C, F, fmt, fmtN } from '@topup/core';
import { useTranslation } from 'react-i18next';
import { Brand, EmptyState, Kicker, Tag, st } from '../ui';
import { NoHistory } from '../illustrations';

export default function HomeScreen({ points, history, deal, lastBuy, loading, onBuy, onDailyDeal, onRepeat, onVpn, hasVpn }) {
  const { t } = useTranslation();
  const TILES = [
    { k: '₣', l: t('home.airtime'), svc: 'airtime' },
    { k: 'GB', l: t('home.data'), svc: 'data' },
  ];
  return (
    <ScrollView style={{ flex: 1 }}>
      <View style={[st.header, st.rowBetween, { borderBottomWidth: 2, borderColor: C.divider }]}>
        <Brand />
        <Tag>{t('home.points', { count: fmtN(points) })}</Tag>
      </View>

      <View style={{ padding: 20 }}>
        <Kicker>{t('home.quickBuy')}</Kicker>
        <Text style={st.h1}>{t('home.title')}</Text>
        <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: C.text, marginTop: 20 }}>
          {TILES.map((tile, i) => (
            <Pressable
              key={tile.svc}
              onPress={() => onBuy(tile.svc)}
              style={({ pressed }) => [
                { flex: 1, padding: 16, gap: 22 },
                i === 0 && { borderRightWidth: 2, borderColor: C.text },
                pressed && { backgroundColor: C.accent100 },
              ]}
            >
              <Text style={{ fontFamily: F.heading, fontSize: 22, color: C.text }}>{tile.k}</Text>
              <View style={st.rowBetween}>
                <Text style={st.tileLabel}>{tile.l}</Text>
                <Text style={st.tileLabel}>→</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      {/* The whole point of the account. This is a utility bought a few times a
          month, almost always the same pack for the same line — so the second
          purchase should cost one tap, not six. Sits above the deal because a
          known intent beats a promoted one. */}
      {lastBuy ? (
        <Pressable
          onPress={onRepeat}
          style={({ pressed }) => [
            { marginHorizontal: 20, marginBottom: 20, borderWidth: 2, borderColor: C.text, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
            pressed && { backgroundColor: C.accent100, borderColor: C.accent },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Kicker>{t('home.usualKicker')}</Kicker>
            <Text style={{ fontFamily: F.heading, fontSize: 18, color: C.text }}>
              {t('home.usualTitle', { pack: lastBuy.label, price: fmt(lastBuy.price) })}
            </Text>
            <Text style={st.subText}>
              {t('home.usualSub', { carrier: lastBuy.carrier, number: lastBuy.recipient })}
            </Text>
          </View>
          <Text style={st.arrow}>→</Text>
        </Pressable>
      ) : null}

      {/* Drawn from the catalogue line it actually buys. The copy used to be a
          fixed "2 Go pour 800 FCFA" while the button charged whichever pack
          carried a bonus — advertising one price and taking another. There is
          no former price in the catalogue, so none is shown. */}
      {deal && (
        <Pressable
          onPress={onDailyDeal}
          style={({ pressed }) => [
            { marginHorizontal: 20, marginBottom: 20, backgroundColor: pressed ? C.accent600 : C.accent, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Kicker light>{t('home.dealKicker')}</Kicker>
            <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 18 }}>
              {t('home.dealTitle', { name: deal.n, price: fmt(deal.p) })}
            </Text>
            <Text style={{ color: 'rgba(243,242,242,0.85)', fontSize: 12, fontFamily: F.body }}>
              {[deal.v, deal.b].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 20 }}>→</Text>
        </Pressable>
      )}

      <Pressable
        onPress={onVpn}
        style={({ pressed }) => [
          { marginHorizontal: 20, marginBottom: 20, borderWidth: 2, borderColor: C.text, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
          pressed && { backgroundColor: C.accent100, borderColor: C.accent },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Kicker>{t('home.vpnKicker')}</Kicker>
          <Text style={{ fontFamily: F.heading, fontSize: 18, color: C.text }}>
            {hasVpn ? t('home.vpnTitleActive') : t('home.vpnTitle')}
          </Text>
          <Text style={st.subText}>
            {hasVpn ? t('home.vpnSubActive') : t('home.vpnSub')}
          </Text>
        </View>
        <Text style={st.arrow}>→</Text>
      </Pressable>

      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <View style={st.sectionRule}><Text style={st.sectionLabel}>{t('home.activity')}</Text></View>
        {/* Compact here — the home screen already offers the ways out, so this
            only needs to say why the list is blank. */}
        {history.length === 0 ? (
          <EmptyState art={NoHistory} loading={loading} title={t('empty.historyTitle')} />
        ) : null}
        {history.slice(0, 3).map((h, i) => (
          <View key={i} style={st.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle}>{h.desc}</Text>
              <Text style={st.subText}>{h.meta}</Text>
            </View>
            <Text style={st.packPrice}>{h.amount}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
