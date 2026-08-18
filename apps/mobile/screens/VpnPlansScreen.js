import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { C, F } from '@topup/core';
import { useTranslation } from 'react-i18next';
import { BackHeader, Btn, Kicker, PackGrid, st } from '../ui';
import { TourTarget } from '../tour';

// Plans and locations are both server-side facts: the console can reprice or
// retire either at any time, and checkout charges the stored price regardless
// of what the app last saw.
export default function VpnPlansScreen({ plans = [], locations = [], onBack, onSelect, onRestore }) {
  const { t } = useTranslation();
  return (
    <ScrollView style={{ flex: 1 }}>
      <BackHeader onBack={onBack} label={t('vpn.step')} />

      <View style={{ backgroundColor: C.text, padding: 20, paddingTop: 24 }}>
        <Kicker onDark>{t('vpn.premium')}</Kicker>
        <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 38, lineHeight: 40, letterSpacing: -1 }}>
          {t('vpn.heroTitle')}
        </Text>
        <Text style={{ color: 'rgba(243,242,242,0.7)', fontSize: 13, fontFamily: F.body, lineHeight: 19, marginTop: 8 }}>
          {t('vpn.heroBody')}
        </Text>
      </View>

      <View style={{ padding: 20, gap: 16 }}>
        <TourTarget name="plans">
          <PackGrid
            items={plans}
            onSelect={onSelect}
            title={t('empty.packsTitle')}
            body={t('empty.packsBody')}
          />
        </TourTarget>

        {/* Nothing to include yet — the card would otherwise read "0
            destinations" above an empty line. */}
        {locations.length > 0 ? (
          <View style={{ borderWidth: 2, borderColor: C.text, padding: 16, gap: 8 }}>
            <Kicker>{t('vpn.locationsIncluded', { count: locations.length })}</Kicker>
            <Text style={st.rowTitle}>{locations.map((l) => l.name).join(' · ')}</Text>
            <Text style={st.subText}>
              {t('vpn.locationsBody')}
            </Text>
          </View>
        ) : null}

        <Btn variant="secondary" label={t('vpn.restoreCta')} onPress={onRestore} />
      </View>
    </ScrollView>
  );
}
