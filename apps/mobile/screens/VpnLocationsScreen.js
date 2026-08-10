import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F, VPN_LOCATIONS } from '@topup/core';
import { BackHeader, Kicker, Tag, st } from '../ui';

// Step 01 of setup. One WireGuard tunnel is one server, so the customer picks a
// location first and installs that config — then comes back for the next one.
export default function VpnLocationsScreen({ added = [], email, justPurchased, onBack, onSelect }) {
  const { t } = useTranslation();
  return (
    <ScrollView style={{ flex: 1 }}>
      <BackHeader onBack={onBack} label={t('vpn.locStep')} />

      {justPurchased && (
        <View style={{ backgroundColor: C.accent, padding: 20, paddingTop: 22 }}>
          <Kicker light>{t('vpn.liveKicker')}</Kicker>
          <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 38, letterSpacing: -1 }}>
            {t('vpn.liveTitle')}
          </Text>
          <Text style={{ color: 'rgba(243,242,242,0.85)', fontSize: 12, fontFamily: F.body, marginTop: 6 }}>
            {t('vpn.liveBody', { email })}
          </Text>
        </View>
      )}

      <View style={{ padding: 20, gap: 6 }}>
        <Text style={st.h2}>{t('vpn.locTitle')}</Text>
        <Text style={st.subText}>
          {t('vpn.locBody')}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
          {VPN_LOCATIONS.map((l) => (
            <Pressable
              key={l.code}
              onPress={() => onSelect(l)}
              style={({ pressed }) => [st.packRow, { paddingVertical: 16 }, pressed && { backgroundColor: C.accent100 }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                <View style={lx.badge}>
                  <Text style={lx.badgeText}>{l.code}</Text>
                </View>
                <View>
                  <Text style={st.rowTitle}>{l.name}</Text>
                  <Text style={st.subText}>{l.host}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {added.includes(l.code) ? <Tag>{t('vpn.added')}</Tag> : null}
                <Text style={st.arrow}>→</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        <Text style={st.subText}>
          {added.length
            ? t('vpn.locProgress', { done: added.length, total: VPN_LOCATIONS.length })
            : t('vpn.locHint')}
        </Text>
      </View>
    </ScrollView>
  );
}

const lx = StyleSheet.create({
  badge: { width: 34, height: 34, borderWidth: 1.5, borderColor: C.text, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: F.heading, fontSize: 11, color: C.text },
});
