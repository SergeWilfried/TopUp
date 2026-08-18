import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform, Linking, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { C, F, flagFor } from '@topup/core';
import { BackHeader, Btn, EmptyState, Kicker, Tag, SummaryRow, st } from '../ui';
import { NoEsim } from '../illustrations';

/**
 * eSIM screens, driven by what the provider actually issued.
 *
 * An eSIM here is a profile Yesim provisioned: an ICCID, an LPA activation
 * code (which is what a QR encodes), a one-tap install link for iOS, and a
 * web "passport" page for status and re-installs. The app used to invent one
 * of these locally after payment; now every field on these screens comes
 * from /me/esims or from the delivered order.
 */

const isIOS = Platform.OS === 'ios';

/** "501.76" → "502 MB", "20480" → "20 GB". */
export const fmtData = (mb) => {
  const n = Number(mb);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${Math.round(n)} MB`;
  const gb = n / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
};

/**
 * One state a customer can act on.
 *
 * `status_qr` is about the profile (installed on a phone or not); the plan's
 * expiry is about the data. Both matter, and expiry wins: an installed profile
 * with a dead plan is "expired", not "active".
 */
export const esimState = (e) => {
  const expired = e?.planExpiredAt && new Date(e.planExpiredAt.replace(' ', 'T') + 'Z').getTime() < Date.now();
  if (expired) return 'expired';
  const q = String(e?.statusQr ?? '').toLowerCase();
  if (q === 'deleted') return 'removed';
  if (q === 'enabled' || q === 'installed' || q === 'downloaded') return 'installed';
  return 'notInstalled';
};

const fmtWhen = (s, lang) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const StateTag = ({ e }) => {
  const { t } = useTranslation();
  const s = esimState(e);
  return <Tag kind={s === 'installed' ? 'accent' : 'neutral'}>{t(`esim.state.${s}`)}</Tag>;
};

/** Data left as a rule — the app's idiom, not a rounded progress bar. */
const DataRule = ({ e }) => {
  const total = Number(e?.dataPackageMb) || 0;
  const left = Number(e?.dataLeftMb) || 0;
  const pct = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  return (
    <View style={{ height: 4, backgroundColor: C.rule }}>
      <View style={{ height: 4, width: `${Math.round(pct * 100)}%`, backgroundColor: C.accent }} />
    </View>
  );
};

/**
 * Everything needed to get the profile onto a phone. Used on the success
 * screen right after purchase and again on the detail screen, so a customer
 * who skipped the install can come back to exactly the same instructions.
 */
export function EsimInstallCard({ esim, compact = false }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!esim) return null;
  const canTap = isIOS && Boolean(esim.iosTapLink);

  return (
    <View style={{ gap: 14 }}>
      {esim.qrcode ? (
        <View style={sx.qrFrame}>
          {/* A true-white quiet zone: phones scan a QR off another screen and
              a tinted background costs read distance. */}
          <QRCode value={esim.qrcode} size={compact ? 180 : 216} backgroundColor="#ffffff" color="#201e1d" />
          <Text style={sx.qrCaption}>ESIM · {String(esim.iccid ?? '').replace(/(\d{4})(?=\d)/g, '$1 ')}</Text>
        </View>
      ) : null}

      {canTap ? (
        <Btn
          label={t('esim.addToPhone')}
          onPress={() => Linking.openURL(esim.iosTapLink).catch(() => {})}
        />
      ) : null}

      {esim.qrcode ? (
        <View style={{ gap: 6 }}>
          <Text style={st.fieldLabel}>{t('esim.codeLabel')}</Text>
          <View style={[st.rowBetween, { backgroundColor: C.surface, borderWidth: 1, borderColor: C.divider, padding: 12, gap: 8 }]}>
            <Text style={{ fontFamily: F.semi, fontSize: 12, color: C.text, flex: 1 }} selectable numberOfLines={2}>{esim.qrcode}</Text>
            <Btn
              variant="ghost"
              label={copied ? t('esim.codeCopied') : t('esim.copyCode')}
              onPress={async () => {
                await Clipboard.setStringAsync(esim.qrcode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            />
          </View>
        </View>
      ) : null}

      <View style={sx.card}>
        <Kicker>{t('esim.installKicker')}</Kicker>
        <Text style={st.subText}>{isIOS ? t('esim.iosSteps') : t('esim.androidSteps')}</Text>
        <Text style={st.subText}>{t('esim.otherPhone')}</Text>
      </View>

      {esim.passportUrl ? (
        <View style={{ gap: 6 }}>
          <Btn variant="secondary" label={t('esim.openPassport')} onPress={() => Linking.openURL(esim.passportUrl).catch(() => {})} />
          <Text style={st.subText}>{t('esim.passportNote')}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function EsimListScreen({ esims, onBack, onNew, onOpen, onTopUp }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.slice(0, 2);
  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
      <View style={[st.backHeader, { justifyContent: 'space-between' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Btn variant="ghost" label="←" accessibilityLabel={t('common.backLabel')} onPress={onBack} />
          <Text style={st.h2}>{t('esim.title')}</Text>
        </View>
        <Btn label={t('esim.newCta')} onPress={onNew} style={{ minHeight: 36 }} />
      </View>
      <View style={{ padding: 20, gap: 12 }}>
        {esims.length === 0 ? (
          <EmptyState art={NoEsim} title={t('empty.esimTitle')} body={t('empty.esimBody')} cta={t('empty.esimCta')} onCta={onNew} />
        ) : null}
        {esims.map((e) => {
          const state = esimState(e);
          const label = e.label || e.orderDetail || t('esim.genericLabel');
          return (
            <Pressable
              key={e.iccid}
              onPress={() => onOpen(e)}
              accessibilityRole="button"
              accessibilityLabel={`${label}. ${t(`esim.state.${state}`)}`}
              style={({ pressed }) => [{ borderWidth: 2, borderColor: C.text, padding: 14, gap: 10 }, pressed && { backgroundColor: C.accent100 }]}
            >
              <View style={st.rowBetween}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View style={{ width: 30, height: 30, borderWidth: 1.5, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
                    {flagFor(e.country) ? <Text style={{ fontSize: 17, lineHeight: 22 }}>{flagFor(e.country)}</Text> : <Text style={{ fontFamily: F.heading, fontSize: 11 }}>{e.country ?? '?'}</Text>}
                  </View>
                  <Text style={{ fontFamily: F.heading, fontSize: 16, color: C.text, flex: 1 }} numberOfLines={1}>{label}</Text>
                </View>
                <StateTag e={e} />
              </View>
              <DataRule e={e} />
              <View style={st.rowBetween}>
                <Text style={st.subText}>
                  {e.dataPackageMb ? t('esim.dataLeftOf', { left: fmtData(e.dataLeftMb), total: fmtData(e.dataPackageMb) }) : t('esim.noPlanYet')}
                </Text>
                <Text style={st.subText}>
                  {e.planExpiredAt ? t(state === 'expired' ? 'esim.expiredOn' : 'esim.expires', { date: fmtWhen(e.planExpiredAt, lang) }) : ''}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 4 }}>
                <Btn variant="ghost" label={t('esim.topUp')} onPress={() => onTopUp(e)} />
                <Btn variant="secondary" label={state === 'notInstalled' ? t('esim.install') : t('esim.showQr')} onPress={() => onOpen(e)} />
              </View>
            </Pressable>
          );
        })}
        {esims.length ? <Text style={st.subText}>{t('esim.note')}</Text> : null}
      </View>
    </ScrollView>
  );
}

export function EsimDetailScreen({ esim, onBack, onTopUp }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.slice(0, 2);
  if (!esim) return null;
  const state = esimState(esim);
  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
      <BackHeader onBack={onBack} label={t('esim.detailStep')} />
      <View style={{ padding: 20, gap: 16 }}>
        <View style={[st.rowBetween, { alignItems: 'flex-start', gap: 12 }]}>
          <View style={{ flex: 1 }}>
            <Kicker>{flagFor(esim.country) ? `${flagFor(esim.country)}  ${esim.country}` : t('esim.title')}</Kicker>
            <Text style={st.h2}>{esim.label || esim.orderDetail || t('esim.genericLabel')}</Text>
          </View>
          <View style={{ paddingTop: 8 }}><StateTag e={esim} /></View>
        </View>

        <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
          <SummaryRow k={t('esim.dataLeftLabel')} v={esim.dataPackageMb ? `${fmtData(esim.dataLeftMb)} / ${fmtData(esim.dataPackageMb)}` : '—'} bold />
          <SummaryRow k={t('esim.activated')} v={fmtWhen(esim.planActivatedAt, lang)} />
          <SummaryRow k={state === 'expired' ? t('esim.expiredLabel') : t('esim.expiresLabel')} v={fmtWhen(esim.planExpiredAt, lang)} />
          <SummaryRow k="ICCID" v={String(esim.iccid ?? '')} />
        </View>
        <DataRule e={esim} />

        <EsimInstallCard esim={esim} />

        <Btn variant="secondary" label={t('esim.topUpCta')} onPress={() => onTopUp(esim)} />
      </View>
    </ScrollView>
  );
}

const sx = StyleSheet.create({
  qrFrame: { borderWidth: 2, borderColor: C.text, backgroundColor: '#ffffff', alignItems: 'center', paddingVertical: 20, gap: 14 },
  qrCaption: { fontFamily: F.semi, fontSize: 10, letterSpacing: 1.2, color: C.muted },
  card: { borderWidth: 2, borderColor: C.text, padding: 16, gap: 8 },
});
