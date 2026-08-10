import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F } from '@topup/core';
import { BackHeader, Btn, Kicker, st } from '../ui';

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// The "I got a new phone" path — the single page that absorbs most support load.
export default function VpnRecoverScreen({ signedOut, onBack, onOpenConfigs }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <ScrollView style={{ flex: 1 }}>
      <BackHeader onBack={onBack} label={t('vpn.recoverStep')} />

      <View style={{ padding: 20, gap: 18 }}>
        {!sent ? (
          <>
            <View style={{ gap: 6 }}>
              <Text style={st.h2}>{t('vpn.recoverTitle')}</Text>
              <Text style={st.subText}>
                {t('vpn.recoverBody')}
              </Text>
              {signedOut && (
                <Text style={st.subText}>
                  {t('vpn.recoverSignedOut')}
                </Text>
              )}
            </View>
            <View>
              <Text style={st.fieldLabel}>{t('vpn.emailLabel')}</Text>
              <TextInput
                style={st.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder={t('vpn.emailPlaceholder')}
              />
            </View>
            <Btn
              label={sending ? t('vpn.sending') : t('vpn.sendLink')}
              disabled={!looksLikeEmail(email) || sending}
              onPress={() => {
                setSending(true);
                setTimeout(() => { setSending(false); setSent(true); }, 900);
              }}
            />
            <Text style={st.subText}>
              {t('vpn.linkNote')}
            </Text>
          </>
        ) : (
          <>
            <View style={{ backgroundColor: C.accent, padding: 20 }}>
              <Kicker light>{t('vpn.checkInbox')}</Kicker>
              <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 34, letterSpacing: -0.8 }}>{t('vpn.linkSent')}</Text>
              <Text style={{ color: 'rgba(243,242,242,0.85)', fontSize: 13, fontFamily: F.body, marginTop: 6 }}>
                {t('vpn.linkSentBody', { email: email.trim() })}
              </Text>
            </View>
            <Text style={st.subText}>
              {t('vpn.spamNote')}
            </Text>
            {/* Stands in for the deep link the emailed magic link would open. */}
            <Btn label={t('vpn.openedLink')} onPress={() => onOpenConfigs(email.trim())} />
            <Btn variant="secondary" label={t('vpn.sendAgain')} onPress={() => setSent(false)} />
          </>
        )}
      </View>
    </ScrollView>
  );
}
