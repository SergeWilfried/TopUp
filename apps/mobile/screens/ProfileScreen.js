import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F, fmtDate, flagFor, toE164 } from '@topup/core';
import { methodsFor } from '../payment';
import { LANGS } from '../i18n';
import { TabHeader, st } from '../ui';

export default function ProfileScreen({ carrier, phone, country, esims, vpn, onEsims, onVpn, onLanguage, onHelp, supportChannel, onSignOut, featureOn = () => true }) {
  const { t, i18n } = useTranslation();
  const methods = methodsFor(country)
    .methods.map((m) => m.title)
    .join(' · ');

  /**
   * A switched-off feature disappears — unless the customer already owns one.
   *
   * The switch stops new purchases; it does not repossess what someone paid
   * for. Hiding the row from a customer with a live subscription would strand
   * them without the configs they bought, which is a worse failure than showing
   * a service that cannot currently be bought again.
   */
  const rows = [
    {
      show: featureOn('esim') || esims.length > 0,
      name: t('profile.esims'),
      sub: t('profile.esimsSub', { total: esims.length, active: esims.filter((e) => String(e.statusQr ?? '').toLowerCase() === 'enabled').length }),
      go: onEsims,
    },
    {
      show: featureOn('vpn') || Boolean(vpn),
      name: t('profile.vpn'),
      sub: vpn
        ? t('profile.vpnActive', { plan: vpn.plan, date: fmtDate(vpn.expiresAt) })
        : t('profile.vpnInactive'),
      go: onVpn,
    },
    {
      name: t('profile.payment'),
      // The rails this market can actually be charged on. It previously read
      // "Visa •••• 4921" for everyone — an invented card number on an account
      // that has never stored a payment method.
      sub: methods.length ? t('profile.paymentSub', { methods }) : t('profile.paymentNone'),
    },
    // Informational until there is a screen behind them: no arrow, no press
    // state, so they stop looking like doors that do not open.
    { name: t('profile.notifications'), sub: t('profile.notificationsSub') },
    {
      name: t('profile.language'),
      sub: (LANGS.find((l) => l.code === i18n.language) || LANGS[0]).name,
      go: onLanguage,
    },
    { name: t('profile.help'), sub: supportChannel ? t('profile.helpVia', { channel: supportChannel }) : t('profile.helpSub'), go: onHelp },
    { name: t('profile.signOut'), sub: t('profile.signOutSub'), go: onSignOut, destructive: true },
  ];

  return (
    <ScrollView style={{ flex: 1 }}>
      <TabHeader title={t('profile.title')} />

      <View style={{ padding: 20, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        {/* The account has a number, not a name — "Kouassi A." and its initials
            were comp fixtures shown to every user. The flag is something we
            actually know. */}
        <View style={{ width: 52, height: 52, borderWidth: 2, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 24 }}>{flagFor(country) ?? '☎'}</Text>
        </View>
        <View>
          {/* Signed out, there is no number to show — an empty heading looked
              like a rendering fault. */}
          <Text style={{ fontFamily: F.heading, fontSize: 18, color: C.text }}>
            {toE164(phone, country) ?? phone ?? ''}
            {!phone ? t('profile.signedOut') : ''}
          </Text>
          <Text style={st.subText}>{phone ? carrier : t('profile.signedOutSub')}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 }}>
        <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
          {rows.filter((r) => r.show !== false).map((r) => (
            <Pressable
              key={r.name}
              onPress={r.go}
              disabled={!r.go}
              accessibilityRole={r.go ? 'button' : 'text'}
              accessibilityLabel={`${r.name}. ${r.sub}`}
              style={({ pressed }) => [
                st.listRow,
                { paddingVertical: 15 },
                // Sign out is the one row that undoes something: a heavier rule
                // above it separates it from the navigation list.
                r.destructive && { borderTopWidth: 2, borderColor: C.divider, marginTop: 8 },
                pressed && r.go && { backgroundColor: C.accent100 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[st.rowTitle, r.destructive && { color: C.accentText }]}>{r.name}</Text>
                <Text style={st.subText}>{r.sub}</Text>
              </View>
              {r.go ? <Text style={st.arrow}>→</Text> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
