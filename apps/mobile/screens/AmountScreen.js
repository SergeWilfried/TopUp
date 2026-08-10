import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F, fmtN } from '@topup/core';
import { BackHeader, Btn, Kicker, Tag, st } from '../ui';

export const MIN_AMOUNT = 100;
export const MAX_AMOUNT = 500000;

// Purpose-built keypad — the OS number pad can't be styled and its
// return key has no meaning here.
// Archivo has no ⌫ glyph, so the delete key is spelled out and translated.
const DEL = 'del';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', DEL];
const QUICK = [500, 1000, 2000, 5000];

export default function AmountScreen({ carrier, onBack, onConfirm }) {
  const { t } = useTranslation();
  const [digits, setDigits] = useState('');
  const amount = Number(digits || 0);
  const tooHigh = amount > MAX_AMOUNT;
  const valid = amount >= MIN_AMOUNT && !tooHigh;
  const bonus = amount >= 5000 ? 10 : amount >= 1000 ? 5 : 0;

  const press = (k) => {
    if (k === DEL) return setDigits((d) => d.slice(0, -1));
    setDigits((d) => {
      const next = (d + k).replace(/^0+/, '');
      return next.length > 6 ? d : next;
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <BackHeader onBack={onBack} label={t('amount.step')} />

      <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 4 }}>
        <View style={st.rowBetween}>
          <Kicker>{t('amount.kicker')}</Kicker>
          <Tag kind="neutral">{carrier}</Tag>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={[kp.amount, !digits && { color: C.rule }]}>{digits ? fmtN(amount) : '0'}</Text>
          <Text style={kp.unit}>FCFA</Text>
        </View>
        <Text style={[st.subText, tooHigh && { color: C.accent700, fontFamily: F.semi }]}>
          {tooHigh
            ? t('amount.hintTooHigh', { max: fmtN(MAX_AMOUNT) })
            : bonus
              ? t('amount.hintBonus', { bonus })
              : t('amount.hintRange', { min: fmtN(MIN_AMOUNT), max: fmtN(MAX_AMOUNT) })}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, padding: 20, paddingBottom: 0 }}>
        {QUICK.map((q) => (
          <Pressable
            key={q}
            onPress={() => setDigits(String(q))}
            style={({ pressed }) => [kp.quick, pressed && { backgroundColor: C.accent100, borderColor: C.accent }]}
          >
            <Text style={kp.quickLabel}>{fmtN(q)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 20, gap: 16 }}>
        <View style={kp.pad}>
          {KEYS.map((k) => (
            <Pressable
              key={k}
              onPress={() => press(k)}
              style={({ pressed }) => [kp.key, pressed && { backgroundColor: C.accent100 }]}
            >
              <Text style={[kp.keyLabel, k === DEL && { color: C.accent, fontSize: 15, letterSpacing: 1 }]}>{k === DEL ? t('amount.del') : k}</Text>
            </Pressable>
          ))}
        </View>
        <Btn
          label={valid ? t('amount.continueWith', { amount: fmtN(amount) }) : t('common.continue')}
          disabled={!valid}
          onPress={() => onConfirm(amount)}
        />
      </View>
    </View>
  );
}

const kp = StyleSheet.create({
  amount: { fontFamily: F.heading, fontSize: 56, lineHeight: 60, letterSpacing: -1.5, color: C.text },
  unit: { fontFamily: F.heading, fontSize: 18, color: C.muted },
  quick: { flex: 1, borderWidth: 1, borderColor: C.divider, paddingVertical: 10, alignItems: 'center' },
  quickLabel: { fontFamily: F.semi, fontSize: 13, color: C.text },
  // 1px gaps over a dark ground read as hairline rules between keys.
  pad: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.divider, gap: 1, borderWidth: 1, borderColor: C.divider },
  key: { width: '33.333%', flexGrow: 1, flexBasis: '30%', paddingVertical: 16, alignItems: 'center', backgroundColor: C.bg },
  keyLabel: { fontFamily: F.heading, fontSize: 24, color: C.text },
});
