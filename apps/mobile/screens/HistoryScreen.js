import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '@topup/core';
import { EmptyState, StatusText, TabHeader, st } from '../ui';
import { NoHistory } from '../illustrations';

export default function HistoryScreen({ history, loading, onBuy, onOpen }) {
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
        {/* Each row opens the order: reference, amounts, what happened, and a
            way to reach support — the things a customer wants when a top-up
            has not arrived, and previously nowhere to be found in the app. */}
        {history.map((h, i) => (
          <Pressable
            key={h.id ?? i}
            onPress={onOpen ? () => onOpen(h) : undefined}
            accessibilityRole="button"
            accessibilityLabel={`${h.desc}, ${h.amount}, ${h.status}`}
            style={({ pressed }) => [st.listRow, pressed && onOpen && { backgroundColor: C.accent100 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle}>{h.desc}</Text>
              <Text style={st.subText}>{h.meta}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={st.packPrice}>{h.amount}</Text>
              <StatusText code={h.code} label={h.status} />
            </View>
            {onOpen ? <Text style={[st.arrow, { marginLeft: 6 }]}>→</Text> : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
