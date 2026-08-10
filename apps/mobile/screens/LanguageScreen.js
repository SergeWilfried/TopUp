import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F } from '@topup/core';
import { LANGS, setLanguage } from '../i18n';
import { BackHeader, Tag, st } from '../ui';

export default function LanguageScreen({ onBack }) {
  const { t, i18n } = useTranslation();

  return (
    <ScrollView style={{ flex: 1 }}>
      <BackHeader onBack={onBack} label={t('language.step')} />

      <View style={{ padding: 20, gap: 6 }}>
        <Text style={st.h2}>{t('language.title')}</Text>
        <Text style={st.subText}>{t('language.body')}</Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
          {LANGS.map((l) => {
            const on = i18n.language === l.code;
            return (
              <Pressable
                key={l.code}
                // Applied immediately, then straight back — no save step to forget.
                onPress={() => { setLanguage(l.code); onBack(); }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [st.packRow, { paddingVertical: 16 }, pressed && { backgroundColor: C.accent100 }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                  <View
                    style={{
                      width: 34, height: 34, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
                      borderColor: on ? C.accent : C.text,
                      backgroundColor: on ? C.accent : 'transparent',
                    }}
                  >
                    <Text style={{ fontFamily: F.heading, fontSize: 11, color: on ? C.bg : C.text }}>{l.label}</Text>
                  </View>
                  <View>
                    <Text style={st.rowTitle}>{l.name}</Text>
                    <Text style={st.subText}>{l.english}</Text>
                  </View>
                </View>
                {on ? <Tag>{t('common.active')}</Tag> : <Text style={st.arrow}>→</Text>}
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}
