import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { C, F, fmtN, redeemable } from '@topup/core';
import { useTranslation } from 'react-i18next';
import { Btn, Kicker, TabHeader, st } from '../ui';

export default function RewardsScreen({ points, onRedeem }) {
  const { t } = useTranslation();
  return (
    <ScrollView style={{ flex: 1 }}>
      <TabHeader title={t('rewards.title')} />

      <View style={{ backgroundColor: C.accent, padding: 20 }}>
        <Kicker light>{t('rewards.balance')}</Kicker>
        <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 52 }}>{fmtN(points)}</Text>
        <Text style={{ color: 'rgba(243,242,242,0.85)', fontSize: 12, fontFamily: F.body }}>
          {t('rewards.rule')}
        </Text>
      </View>

      <View style={{ padding: 20 }}>
        <View style={st.sectionRule}><Text style={st.sectionLabel}>{t('rewards.redeem')}</Text></View>
        {redeemable(t).map((r) => (
          <View key={r.name} style={st.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle}>{r.name}</Text>
              <Text style={st.subText}>{t('rewards.cost', { count: r.cost })}</Text>
            </View>
            <Btn variant="secondary" label={t('rewards.redeemCta')} disabled={points < r.cost} onPress={() => onRedeem(r.cost)} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
