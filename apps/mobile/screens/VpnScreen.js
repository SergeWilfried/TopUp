import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F, VPN_LOCATIONS, fmtDate } from '@topup/core';
import { BackHeader, Btn, Kicker, Tag, SummaryRow, st } from '../ui';

export default function VpnScreen({ vpn, onBack, onSetup, onBuy, onRestore }) {
  const { t } = useTranslation();
  if (!vpn) {
    return (
      <ScrollView style={{ flex: 1 }}>
        <BackHeader onBack={onBack} label={t('vpn.manageStep')} />
        <View style={{ padding: 20, gap: 16 }}>
          <Text style={st.h2}>{t('vpn.noneTitle')}</Text>
          <Text style={st.subText}>
            {t('vpn.noneBody')}
          </Text>
          <Btn label={t('vpn.seePlans')} onPress={onBuy} />
          <Btn variant="secondary" label={t('vpn.restoreFromEmail')} onPress={onRestore} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      <BackHeader onBack={onBack} label={t('vpn.manageStep')} />

      <View style={{ padding: 20, gap: 16 }}>
        <View style={{ borderWidth: 2, borderColor: C.text, padding: 16 }}>
          <View style={[st.rowBetween, { marginBottom: 6 }]}>
            <Kicker>{t('vpn.subscription')}</Kicker>
            <Tag>{t('common.active')}</Tag>
          </View>
          <Text style={{ fontFamily: F.heading, fontSize: 24, color: C.text }}>{vpn.plan}</Text>
          <View style={{ marginTop: 10 }}>
            <SummaryRow k={t('vpn.renews')} v={fmtDate(vpn.expiresAt)} />
            <SummaryRow k={t('vpn.locations')} v={String(VPN_LOCATIONS.length)} />
            <SummaryRow k={t('vpn.account')} v={vpn.email} />
          </View>
        </View>

        <Btn label={t('vpn.setUpLocation')} onPress={onSetup} />
        <Btn variant="secondary" label={t('vpn.extend')} onPress={onBuy} />

        <View style={{ borderWidth: 1, borderColor: C.divider, padding: 14, gap: 6 }}>
          <Kicker>{t('vpn.newPhoneKicker')}</Kicker>
          <Text style={st.subText}>
            {t('vpn.newPhoneBody')}
          </Text>
          <Btn variant="ghost" label={t('vpn.recoveryCta')} onPress={onRestore} style={{ alignSelf: 'flex-start' }} />
        </View>
      </View>
    </ScrollView>
  );
}
