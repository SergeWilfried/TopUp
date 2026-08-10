import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F, fmtDate } from '@topup/core';
import { LANGS } from '../i18n';
import { TabHeader, st } from '../ui';

export default function ProfileScreen({ carrier, phone, esims, momoName, vpn, onEsims, onVpn, onLanguage, onSignOut }) {
  const { t, i18n } = useTranslation();

  const rows = [
    {
      name: t('profile.esims'),
      sub: t('profile.esimsSub', { total: esims.length, active: esims.filter((e) => e.status === 'active').length }),
      go: onEsims,
    },
    {
      name: t('profile.vpn'),
      sub: vpn
        ? t('profile.vpnActive', { plan: vpn.plan, date: fmtDate(vpn.expiresAt) })
        : t('profile.vpnInactive'),
      go: onVpn,
    },
    { name: t('profile.payment'), sub: t('profile.paymentSub', { provider: momoName }) },
    { name: t('profile.notifications'), sub: t('profile.notificationsSub') },
    {
      name: t('profile.language'),
      sub: (LANGS.find((l) => l.code === i18n.language) || LANGS[0]).name,
      go: onLanguage,
    },
    { name: t('profile.help'), sub: t('profile.helpSub') },
    { name: t('profile.signOut'), sub: t('profile.signOutSub'), go: onSignOut },
  ];

  return (
    <ScrollView style={{ flex: 1 }}>
      <TabHeader title={t('profile.title')} />

      <View style={{ padding: 20, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View style={{ width: 52, height: 52, borderWidth: 2, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.heading, fontSize: 18, color: C.text }}>KA</Text>
        </View>
        <View>
          <Text style={{ fontFamily: F.heading, fontSize: 18, color: C.text }}>Kouassi A.</Text>
          <Text style={st.subText}>{carrier} · {phone}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 }}>
        <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
          {rows.map((r) => (
            <Pressable
              key={r.name}
              onPress={r.go}
              style={({ pressed }) => [st.listRow, { paddingVertical: 15 }, pressed && r.go && { backgroundColor: C.accent100 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>{r.name}</Text>
                <Text style={st.subText}>{r.sub}</Text>
              </View>
              <Text style={st.arrow}>→</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
