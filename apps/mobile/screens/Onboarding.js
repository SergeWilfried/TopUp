import React, { useRef, useState } from 'react';
import { Animated, View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, onboardingSlides } from '@topup/core';
import { Brand, Btn, st } from '../ui';

const PAGER_GAP = 6;

export default function Onboarding({ onDone }) {
  const { t } = useTranslation();
  const ONBOARDING = onboardingSlides(t);
  const { width } = useWindowDimensions();
  const pager = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [i, setI] = useState(0);
  const [barW, setBarW] = useState(0);
  const last = i === ONBOARDING.length - 1;
  const goTo = (n) => {
    setI(n);
    pager.current?.scrollTo({ x: width * n, animated: true });
  };
  // One segment of the progress track, so the accent bar can ride the scroll.
  const segW = barW ? (barW - PAGER_GAP * (ONBOARDING.length - 1)) / ONBOARDING.length : 0;

  return (
    <View style={{ flex: 1 }}>
      <View style={[st.header, st.rowBetween, { borderBottomWidth: 2, borderColor: C.divider }]}>
        <Brand />
        <Btn variant="ghost" label={t('common.skip')} onPress={onDone} style={{ minHeight: 32 }} />
      </View>

      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1 }}
      >
        {ONBOARDING.map((s, n) => {
          // Glyph and copy trail the page at different rates — depth on swipe.
          const range = [(n - 1) * width, n * width, (n + 1) * width];
          const lag = (factor) => ({
            transform: [{
              translateX: scrollX.interpolate({
                inputRange: range,
                outputRange: [-width * factor, 0, width * factor],
                extrapolate: 'clamp',
              }),
            }],
          });
          const fade = { opacity: scrollX.interpolate({ inputRange: range, outputRange: [0, 1, 0], extrapolate: 'clamp' }) };
          return (
            <View key={s.key} style={{ width, padding: 20 }}>
              <View
                style={[
                  { flex: 1, backgroundColor: s.bg, padding: 20, justifyContent: 'space-between', overflow: 'hidden' },
                  s.bordered && { borderWidth: 2, borderColor: C.text },
                ]}
              >
                <Animated.Text style={[st.slideGlyph, { color: s.fg }, lag(0.45), fade]}>{s.glyph}</Animated.Text>
                <Animated.View style={[{ gap: 10 }, lag(0.16), fade]}>
                  <Text style={[st.kicker, { color: s.kick, marginBottom: 0 }]}>{s.kicker}</Text>
                  <Text style={[st.poster, { color: s.fg, fontSize: 38, lineHeight: 40 }]}>{s.title}</Text>
                  <Text style={[st.subText, { color: s.dim, fontSize: 13, lineHeight: 19 }]}>{s.body}</Text>
                </Animated.View>
              </View>
            </View>
          );
        })}
      </Animated.ScrollView>

      <View style={{ padding: 20, paddingTop: 0, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: PAGER_GAP }} onLayout={(e) => setBarW(e.nativeEvent.layout.width)}>
          {ONBOARDING.map((s, n) => (
            <Pressable key={s.key} onPress={() => goTo(n)} hitSlop={12} style={{ flex: 1 }}>
              <View style={{ height: 4, backgroundColor: C.rule }} />
            </Pressable>
          ))}
          {segW > 0 && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute', left: 0, top: 0, height: 4, width: segW, backgroundColor: C.accent,
                transform: [{
                  translateX: scrollX.interpolate({
                    inputRange: [0, width * (ONBOARDING.length - 1)],
                    outputRange: [0, (segW + PAGER_GAP) * (ONBOARDING.length - 1)],
                    extrapolate: 'clamp',
                  }),
                }],
              }}
            />
          )}
        </View>
        <Btn
          label={last ? t('onboarding.getStarted') : t('common.next')}
          onPress={() => (last ? onDone() : goTo(i + 1))}
          // The accent slide would swallow a red CTA — go dark against it.
          style={ONBOARDING[i].bg === C.accent && { backgroundColor: C.text }}
        />
        <Text style={[st.subText, { textAlign: 'center' }]}>{t('onboarding.trust')}</Text>
      </View>
    </View>
  );
}
