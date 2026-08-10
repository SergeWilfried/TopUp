import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { C, F, vpnPlans, VPN_LOCATIONS } from '@topup/core';
import { useTranslation } from 'react-i18next';
import { BackHeader, Btn, Kicker, PackGrid, st } from '../ui';

export default function VpnPlansScreen({ onBack, onSelect, onRestore }) {
  const { t } = useTranslation();
  return (
    <ScrollView style={{ flex: 1 }}>
      <BackHeader onBack={onBack} label={t('vpn.step')} />

      <View style={{ backgroundColor: C.text, padding: 20, paddingTop: 24 }}>
        <Kicker>{t('vpn.premium')}</Kicker>
        <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 38, lineHeight: 40, letterSpacing: -1 }}>
          {t('vpn.heroTitle')}
        </Text>
        <Text style={{ color: 'rgba(243,242,242,0.7)', fontSize: 13, fontFamily: F.body, lineHeight: 19, marginTop: 8 }}>
          {t('vpn.heroBody')}
        </Text>
      </View>

      <View style={{ padding: 20, gap: 16 }}>
        <PackGrid items={vpnPlans(t)} onSelect={onSelect} />

        <View style={{ borderWidth: 2, borderColor: C.text, padding: 16, gap: 8 }}>
          <Kicker>{t('vpn.locationsIncluded', { count: VPN_LOCATIONS.length })}</Kicker>
          <Text style={st.rowTitle}>{VPN_LOCATIONS.map((l) => l.name).join(' · ')}</Text>
          <Text style={st.subText}>
            {t('vpn.locationsBody')}
          </Text>
        </View>

        <Btn variant="secondary" label={t('vpn.restoreCta')} onPress={onRestore} />
      </View>
    </ScrollView>
  );
}
