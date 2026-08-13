import React, { createContext, startTransition, useCallback, useContext, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, F } from '@topup/core';

/**
 * A spotlight tour for teaching the app.
 *
 * Built here rather than pulled in, for one reason that outweighs the rest: the
 * cutout is a hard-edged rectangle with a 2px border, which is four plain views
 * around a hole. Every library renders a soft, rounded, shadowed spotlight and
 * would have to be fought back to this — more work than the whole component,
 * and a dependency at the end of it.
 *
 * Targets are found by measuring real views, not by hardcoding coordinates, so
 * the tour follows the layout across screen sizes and locales rather than
 * drifting off whatever it was aligned to on one handset.
 */

const TourContext = createContext(null);

/**
 * Holds the registry of things a step can point at.
 *
 * Context rather than cloneElement: children are ordinary elements here, and
 * cloning breaks the moment one is wrapped, lazy, or inside another component.
 */
export function TourProvider({ children }) {
  // A ref, not state: registering a target must not re-render the tree, and the
  // registry is only read at the moment a step is measured.
  const targets = useRef(new Map());

  const register = useCallback((name, node) => {
    if (node) targets.current.set(name, node);
    else targets.current.delete(name);
  }, []);

  return <TourContext.Provider value={{ targets, register }}>{children}</TourContext.Provider>;
}

/** Marks a view as something a tour step can point at. */
export function TourTarget({ name, children, style }) {
  const ctx = useContext(TourContext);
  return (
    <View
      // Measured on demand rather than on layout: a position captured at layout
      // time is stale by the time a list above it has loaded and pushed it down.
      ref={(node) => ctx?.register(name, node)}
      collapsable={false}
      style={style}
    >
      {children}
    </View>
  );
}

const PAD = 6; // breathing room between the highlight and the content
const GAP = 12; // between the highlight and the tooltip

/** Measures one target, or null when it is not on screen. */
function measure(node) {
  return new Promise((resolve) => {
    if (!node?.measureInWindow) return resolve(null);
    node.measureInWindow((x, y, width, height) => {
      if ([x, y, width, height].some((n) => typeof n !== 'number' || Number.isNaN(n)) || width === 0) {
        return resolve(null);
      }
      resolve({ x, y, width, height });
    });
    // measureInWindow never fires for an unmounted node, so nothing would
    // resolve and the tour would hang on a step that cannot be shown.
    setTimeout(() => resolve(null), 400);
  });
}

/**
 * The overlay itself.
 *
 * `steps` are `{ name, title, body }`. A step whose target is missing is
 * skipped rather than shown floating: a market with a feature switched off has
 * no tile to point at, and a tour that highlights empty space teaches nothing.
 */
export function TourOverlay({ steps, visible, onDone }) {
  const { t } = useTranslation();
  const ctx = useContext(TourContext);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  // Steps confirmed present, resolved when the tour opens.
  const [live, setLive] = useState([]);

  const finish = useCallback(() => {
    setIndex(0);
    setRect(null);
    setLive([]);
    onDone?.();
  }, [onDone]);

  // Resolve which steps actually have something to point at, once per opening.
  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const found = [];
      for (const step of steps) {
        const r = await measure(ctx?.targets.current.get(step.name));
        if (r) found.push({ ...step, rect: r });
      }
      if (cancelled) return;
      if (found.length === 0) return finish(); // nothing to teach
      setLive(found);
      setIndex(0);
      setRect(found[0].rect);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, steps, ctx, finish]);

  if (!visible || live.length === 0 || !rect) return null;

  const step = live[index];
  const last = index === live.length - 1;
  const { height: screenH, width: screenW } = Dimensions.get('window');

  const advance = () => {
    if (last) return finish();
    const next = index + 1;
    // A panel swap, so it belongs in a transition — keeps the press responsive
    // and lets React interrupt it if the tour is dismissed mid-step.
    startTransition(() => {
      setIndex(next);
      setRect(live[next].rect);
    });
  };

  // Below the highlight when there is room, otherwise above. A tooltip that
  // runs off the bottom is the usual failure of a fixed placement.
  const below = rect.y + rect.height + GAP + 160 < screenH;
  const top = below ? rect.y + rect.height + GAP : Math.max(24, rect.y - GAP - 160);

  const dim = { position: 'absolute', backgroundColor: 'rgba(32,30,29,0.82)' };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish} statusBarTranslucent>
      {/* Four panels around the target rather than a masked overlay: the cutout
          is a plain rectangle, so this needs no SVG and cannot mis-render. */}
      <Pressable style={{ flex: 1 }} onPress={advance}>
        <View style={[dim, { top: 0, left: 0, right: 0, height: Math.max(0, rect.y - PAD) }]} />
        <View style={[dim, { top: rect.y + rect.height + PAD, left: 0, right: 0, bottom: 0 }]} />
        <View style={[dim, { top: rect.y - PAD, left: 0, width: Math.max(0, rect.x - PAD), height: rect.height + PAD * 2 }]} />
        <View style={[dim, { top: rect.y - PAD, left: rect.x + rect.width + PAD, right: 0, height: rect.height + PAD * 2 }]} />

        {/* The highlight border, in the app's own idiom. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: rect.y - PAD,
            left: rect.x - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderWidth: 2,
            borderColor: C.accent,
          }}
        />

        <View
          style={{
            position: 'absolute',
            top,
            left: 20,
            width: Math.min(screenW - 40, 340),
            backgroundColor: C.bg,
            borderWidth: 2,
            borderColor: C.text,
            padding: 16,
            gap: 10,
          }}
        >
          <Text style={{ fontFamily: F.heading, fontSize: 11, letterSpacing: 1.2, color: C.accent }}>
            {t('tour.progress', { current: index + 1, total: live.length })}
          </Text>
          <Text style={{ fontFamily: F.heading, fontSize: 18, color: C.text }}>{step.title}</Text>
          <Text style={{ fontFamily: F.body, fontSize: 13, color: C.text, opacity: 0.8 }}>{step.body}</Text>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <Pressable onPress={finish} hitSlop={10}>
              <Text style={{ fontFamily: F.heading, fontSize: 12, letterSpacing: 1, color: C.text, opacity: 0.6 }}>
                {t('tour.skip')}
              </Text>
            </Pressable>
            <Pressable
              onPress={advance}
              hitSlop={10}
              style={({ pressed }) => [
                { backgroundColor: pressed ? C.accent600 : C.accent, paddingHorizontal: 16, paddingVertical: 10 },
              ]}
            >
              <Text style={{ fontFamily: F.heading, fontSize: 12, letterSpacing: 1, color: C.bg }}>
                {last ? t('tour.done') : t('tour.next')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
