import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F } from '@topup/core';
import { TabHeader, st } from '../ui';

export default function HistoryScreen({ history }) {
  const { t } = useTranslation();
  return (
    <ScrollView style={{ flex: 1 }}>
      <TabHeader title={t('history.title')} />
      <View style={{ padding: 20, paddingTop: 4 }}>
        {history.map((h, i) => (
          <View key={i} style={st.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle}>{h.desc}</Text>
              <Text style={st.subText}>{h.meta}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={st.packPrice}>{h.amount}</Text>
              <Text style={{ color: C.accent, fontSize: 10, letterSpacing: 1, fontFamily: F.semi }}>{h.status}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
