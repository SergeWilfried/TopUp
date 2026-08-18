import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Linking, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { C, F, configFileName, WG_APP_STORE } from '@topup/core';
import { BackHeader, Btn, Kicker, Tag, st } from '../ui';

const isIOS = Platform.OS === 'ios';

const Step = ({ n, children }) => (
  <View style={sx.step}>
    <Text style={sx.stepNum}>{n}</Text>
    <Text style={[st.subText, { flex: 1, fontSize: 13 }]}>{children}</Text>
  </View>
);

/**
 * Step 02 of setup — everything here is about one location's tunnel.
 *
 * `config` is the real WireGuard config the server issued for this device, and
 * the server returns it exactly once. There is no way to re-derive it here, so
 * the screen never regenerates it; losing it means provisioning again.
 */
export default function VpnSetupScreen({ config, loc, onBack, onExported, onAnother }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  // Writes a real .conf and hands it to the share sheet, which is how a
  // phone-only customer gets the file into WireGuard without a second screen.
  const downloadConfig = async () => {
    try {
      const file = new File(Paths.cache, configFileName(loc));
      file.create({ overwrite: true, intermediates: true });
      file.write(config);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'Open in WireGuard',
          UTI: 'public.data',
        });
      } else {
        Alert.alert(t('vpn.saved'), file.uri);
      }
      onExported(loc.code);
    } catch (e) {
      Alert.alert(t('vpn.exportError'), String(e.message || e));
    }
  };

  return (
    <ScrollView style={{ flex: 1 }}>
      <BackHeader onBack={onBack} label={t('vpn.installStep')} />

      <View style={{ padding: 20, paddingBottom: 14 }}>
        <View style={st.rowBetween}>
          <Kicker>{t('vpn.tunnelKicker', { name: loc.name })}</Kicker>
          <Tag kind="neutral">{loc.code}</Tag>
        </View>
        <Text style={st.h2}>{t('vpn.installTitle')}</Text>
        <Text style={[st.subText, { marginTop: 4 }]}>{loc.host}</Text>
      </View>

      <View style={{ paddingHorizontal: 20, gap: 14 }}>
        <View style={sx.qrFrame}>
          <QRCode value={config} size={216} backgroundColor="#ffffff" color="#201e1d" />
          <Text style={sx.qrCaption}>WIREGUARD · {loc.name.toUpperCase()}</Text>
        </View>

        <Btn label={t('vpn.downloadCta')} onPress={downloadConfig} />
        <Btn
          variant="secondary"
          label={copied ? t('vpn.configCopied') : t('vpn.copyConfig')}
          onPress={async () => {
            await Clipboard.setStringAsync(config);
            setCopied(true);
            onExported(loc.code);
            setTimeout(() => setCopied(false), 2000);
          }}
        />
      </View>

      <View style={{ padding: 20, gap: 16 }}>
        <View style={sx.card}>
          <View style={st.rowBetween}>
            <Kicker>{t('vpn.appKicker')}</Kicker>
            <Tag kind="neutral">{t('common.minutes', { count: 2 })}</Tag>
          </View>
          <Step n="1">{t('vpn.appStep1')}</Step>
          <Step n="2">{t('vpn.appStep2')}</Step>
          <Step n="3">{t('vpn.appStep3')}</Step>
          <Step n="4">{t('vpn.appStep4', { name: loc.name })}</Step>
          <Btn
            variant="secondary"
            label={t('vpn.getApp')}
            onPress={() => Linking.openURL(isIOS ? WG_APP_STORE.ios : WG_APP_STORE.android).catch(() => {})}
          />
        </View>

        {/* The iOS "no app needed" route is not wired: it needs the API to serve a
            signed .mobileconfig per peer, and no such endpoint exists yet. The
            card is left out rather than pointed at a URL that 404s. */}

        <Btn variant="secondary" label={t('vpn.anotherLocation')} onPress={onAnother} />
        <Text style={st.subText}>
          {t('vpn.newPhoneNote')}
        </Text>
      </View>
    </ScrollView>
  );
}

const sx = StyleSheet.create({
  // QR needs a true-white quiet zone to scan reliably off a phone screen.
  qrFrame: { borderWidth: 2, borderColor: C.text, backgroundColor: '#ffffff', alignItems: 'center', paddingVertical: 20, gap: 14 },
  qrCaption: { fontFamily: F.semi, fontSize: 10, letterSpacing: 1.2, color: C.muted },
  card: { borderWidth: 2, borderColor: C.text, padding: 16, gap: 10 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: { fontFamily: F.heading, fontSize: 12, color: C.accentText, width: 14, marginTop: 2 },
});
