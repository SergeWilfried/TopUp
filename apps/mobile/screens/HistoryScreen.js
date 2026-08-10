import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F } from '@topup/core';
import { EmptyState, TabHeader, st } from '../ui';
import { NoHistory } from '../illustrations';

export default function HistoryScreen({ history, loading, onBuy }) {
  const { t } = useTranslation();
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
      <TabHeader title={t('history.title')} />
      {/* An account with no orders is the normal first-run state, not an
          error — and it must not look identical to orders still loading. */}
      {history.length === 0 ? (
        <EmptyState
          art={NoHistory}
          loading={loading}
          title={t('empty.historyTitle')}
          body={t('empty.historyBody')}
          cta={onBuy ? t('empty.historyCta') : null}
          onCta={onBuy}
        />
      ) : null}
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
