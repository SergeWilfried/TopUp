import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { C, F, fmt, fmtN } from '@topup/core';
import { useTranslation } from 'react-i18next';
import { Brand, EmptyState, Kicker, StatusText, Tag, st } from '../ui';
import { NoHistory } from '../illustrations';

export default function HomeScreen({ points, history, deal, lastBuy, loading, onBuy, onDailyDeal, onRepeat, onVpn, onEsim, onOpenOrder, hasVpn, hasEsim, featureOn = () => true }) {
  const { t } = useTranslation();
  // A market can have one of these switched off — a distributor out of float,
  // an operator changing a bundle format. The worker refuses either way; hiding
  // the tile is what stops a customer walking into the refusal.
  const TILES = [
    { k: '₣', l: t('home.airtime'), svc: 'airtime' },
    { k: 'GB', l: t('home.data'), svc: 'data' },
  ].filter((tile) => featureOn(tile.svc));

  /**
   * Which single promo the slot shows.
   *
   * The deal outranks everything because it expires today. Otherwise the
   * eligible pitches — an eSIM for someone who has none, a VPN for someone who
   * has none — rotate by calendar day, so neither is buried for good and the
   * screen never stacks them. Nothing eligible means no slot at all.
   */
  const pitches = [
    !hasEsim && featureOn('esim') ? 'esim' : null,
    !hasVpn && featureOn('vpn') ? 'vpn' : null,
  ].filter(Boolean);
  const day = Math.floor(Date.now() / 86400000);
  const promo = deal ? 'deal' : pitches.length ? pitches[day % pitches.length] : null;
  return (
    <ScrollView style={{ flex: 1 }}>
      <View style={[st.header, st.rowBetween, { borderBottomWidth: 2, borderColor: C.divider }]}>
        <Brand />
        <Tag>{t('home.points', { count: fmtN(points) })}</Tag>
      </View>

      <View style={{ padding: 20 }}>
        <Kicker>{t('home.quickBuy')}</Kicker>
        <Text style={st.h1}>{t('home.title')}</Text>
        {TILES.length > 0 && (
        <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: C.text, marginTop: 20 }}>
          {TILES.map((tile, i) => (
            <Pressable
              key={tile.svc}
              onPress={() => onBuy(tile.svc)}
              accessibilityRole="button"
              accessibilityLabel={tile.l}
              style={({ pressed }) => [
                { flex: 1, padding: 16, gap: 22 },
                i === 0 && TILES.length > 1 && { borderRightWidth: 2, borderColor: C.text },
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
        )}
      </View>

      {/* The whole point of the account. This is a utility bought a few times a
          month, almost always the same pack for the same line — so the second
          purchase should cost one tap, not six. Sits above the deal because a
          known intent beats a promoted one. */}
      {lastBuy && featureOn(lastBuy.service) ? (
        <Pressable
          onPress={onRepeat}
          accessibilityRole="button"
          accessibilityLabel={`${t('home.usualKicker')}. ${lastBuy.label}, ${fmt(lastBuy.price)}. ${lastBuy.carrier}, ${lastBuy.recipient}`}
          style={({ pressed }) => [
            { marginHorizontal: 20, marginBottom: 20, borderWidth: 2, borderColor: C.text, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
            pressed && { backgroundColor: C.accent100, borderColor: C.accent },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Kicker>{t('home.usualKicker')}</Kicker>
            <Text style={{ fontFamily: F.heading, fontSize: 18, color: C.text }}>
              {/* Airtime packs are named by their price — "1 000 FCFA · 1 000 FCFA" read as a fault. */}
              {lastBuy.label === fmt(lastBuy.price) ? lastBuy.label : t('home.usualTitle', { pack: lastBuy.label, price: fmt(lastBuy.price) })}
            </Text>
            <Text style={st.subText}>
              {t('home.usualSub', { carrier: lastBuy.carrier, number: lastBuy.recipient })}
            </Text>
          </View>
          <Text style={st.arrow}>→</Text>
        </Pressable>
      ) : null}

      {/* One promo slot, not a stack.
          Usual + deal + eSIM + VPN cards pushed Activity below the fold on a
          small phone, and four pitches at once is none. The daily deal wins
          when there is one — it is the only time-limited thing here — and
          otherwise the eSIM and VPN promos take turns by day, so a customer
          who opens the app on Tuesday and Wednesday sees each once rather
          than one of them forever. A VPN the customer already owns is not a
          promo and gets a compact row below instead. */}
      {promo === 'deal' && (
        <Pressable
          onPress={onDailyDeal}
          accessibilityRole="button"
          accessibilityLabel={`${t('home.dealKicker')}. ${t('home.dealTitle', { name: deal.n, price: fmt(deal.p) })}`}
          style={({ pressed }) => [
            { marginHorizontal: 20, marginBottom: 20, backgroundColor: pressed ? C.accent600 : C.accent, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Kicker light>{t('home.dealKicker')}</Kicker>
            <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 18 }}>
              {/* Drawn from the catalogue line it actually buys, so the price
                  advertised is the price charged. */}
              {t('home.dealTitle', { name: deal.n, price: fmt(deal.p) })}
            </Text>
            <Text style={{ color: C.bg, fontSize: 12, fontFamily: F.body }}>
              {[deal.v, deal.b].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 20 }}>→</Text>
        </Pressable>
      )}

      {promo === 'esim' && (
        <Pressable
          onPress={onEsim}
          accessibilityRole="button"
          accessibilityLabel={`${t('home.esimPromoTitle')}. ${t('home.esimPromoSub')}`}
          style={({ pressed }) => [
            { marginHorizontal: 20, marginBottom: 20, backgroundColor: pressed ? C.accent600 : C.accent, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Kicker light>{t('home.esimPromoKicker')}</Kicker>
            <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 18 }}>
              {t('home.esimPromoTitle')}
            </Text>
            <Text style={{ color: C.bg, fontSize: 12, fontFamily: F.body }}>
              {t('home.esimPromoSub')}
            </Text>
          </View>
          <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 20 }}>→</Text>
        </Pressable>
      )}

      {/* Same red field as the deal and eSIM pitches: whatever the slot holds
          is the one promotion on the screen, and it should look like one. */}
      {promo === 'vpn' && (
        <Pressable
          onPress={onVpn}
          accessibilityRole="button"
          accessibilityLabel={`${t('home.vpnTitle')}. ${t('home.vpnSub')}`}
          style={({ pressed }) => [
            { marginHorizontal: 20, marginBottom: 20, backgroundColor: pressed ? C.accent600 : C.accent, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Kicker light>{t('home.vpnKicker')}</Kicker>
            <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 18 }}>{t('home.vpnTitle')}</Text>
            <Text style={{ color: C.bg, fontSize: 12, fontFamily: F.body }}>{t('home.vpnSub')}</Text>
          </View>
          <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 20 }}>→</Text>
        </Pressable>
      )}

      {/* Owned, not pitched: a shortcut row for a customer with a live VPN,
          styled like the activity rows so it reads as "yours" rather than
          "buy this". */}
      {hasVpn && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
          <Pressable
            onPress={onVpn}
            accessibilityRole="button"
            accessibilityLabel={`${t('home.vpnTitleActive')}. ${t('home.vpnSubActive')}`}
            style={({ pressed }) => [st.listRow, { borderTopWidth: 1, borderColor: C.rule }, pressed && { backgroundColor: C.accent100 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle}>{t('home.vpnTitleActive')}</Text>
              <Text style={st.subText}>{t('home.vpnSubActive')}</Text>
            </View>
            <Text style={st.arrow}>→</Text>
          </Pressable>
        </View>
      )}

      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <View style={st.sectionRule}><Text style={st.sectionLabel}>{t('home.activity')}</Text></View>
        {/* Compact here — the home screen already offers the ways out, so this
            only needs to say why the list is blank. */}
        {history.length === 0 ? (
          <EmptyState art={NoHistory} loading={loading} title={t('empty.historyTitle')} />
        ) : null}
        {history.slice(0, 3).map((h, i) => (
          <Pressable
            key={h.id ?? i}
            onPress={onOpenOrder ? () => onOpenOrder(h) : undefined}
            accessibilityRole="button"
            accessibilityLabel={`${h.desc}, ${h.amount}, ${h.status}`}
            style={({ pressed }) => [st.listRow, pressed && onOpenOrder && { backgroundColor: C.accent100 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle}>{h.desc}</Text>
              <Text style={st.subText}>{h.meta}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={st.packPrice}>{h.amount}</Text>
              <StatusText code={h.code} label={h.status} />
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
