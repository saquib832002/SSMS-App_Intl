/**
 * A pop-up form that is never hidden by the keyboard and always scrolls to its last button.
 *
 * Shown as a layer over the screen (not a separate Android window): inside an Android Modal the app is not told
 * about the keyboard (edge-to-edge), so the form stayed behind it. On the screen itself the keyboard events arrive:
 *  - keyboard closed: a sheet at the bottom, clear of the navigation bar (or a centred box with `center`);
 *  - keyboard open: the sheet ends just above the keyboard and scrolls; <SheetScroll> brings the field being
 *    typed in into view;
 *  - if the keyboard size is still unknown while a field is focused, extra space is added under the form so it
 *    can always be scrolled up far enough to reach the buttons.
 * The Android back button closes the keyboard first, then the form (onClose).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { View, ScrollView, Keyboard, Platform, StyleSheet, TextInput, Dimensions, BackHandler, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SheetCtx = createContext({ spacer: 0 });

/** Top edge of the keyboard (window / screen coordinates), or null when it is closed. */
function useKeyboardTop(active) {
  const [top, setTop] = useState(null);
  useEffect(() => {
    if (!active) { setTop(null); return undefined; }
    const screenH = () => Dimensions.get("screen").height;
    const onShow = (e) => {
      const c = e?.endCoordinates ?? {};
      if (!(c.height > 0)) return;
      setTop(c.screenY > 0 && c.screenY < screenH() ? c.screenY : screenH() - c.height);
    };
    const subs = [
      Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", onShow),
      Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidChangeFrame", onShow),
      Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setTop(null)),
    ];
    if (Keyboard.isVisible?.()) onShow({ endCoordinates: Keyboard.metrics?.() });
    return () => subs.forEach((s) => s.remove());
  }, [active]);
  return top;
}

/** Is a text field focused right now? (fallback when no keyboard event arrives) */
function useFieldFocused(active) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!active) { setFocused(false); return undefined; }
    const t = setInterval(() => setFocused(!!TextInput.State?.currentlyFocusedInput?.()), 300);
    return () => clearInterval(t);
  }, [active]);
  return focused;
}

export default function KeyboardSheet({ visible, onClose, children, center = false, style }) {
  const insets = useSafeAreaInsets();
  const kbTop = useKeyboardTop(visible);
  const focused = useFieldFocused(visible);
  const box = useRef(null);
  const [frame, setFrame] = useState(null);   // { y, h } of this layer in the window

  const measure = useCallback(() => {
    box.current?.measureInWindow?.((x, y, w, h) => { if (h > 0) setFrame({ y, h }); });
  }, []);
  useEffect(() => {
    if (!visible || kbTop === null) return undefined;
    const t = setTimeout(measure, 60);
    return () => clearTimeout(t);
  }, [visible, kbTop, measure]);

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (Keyboard.isVisible?.()) { Keyboard.dismiss(); return true; }
      onClose?.();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  const open = kbTop !== null;
  // Android's navigation bar (gesture bar or 3 buttons) – the inset can be reported as 0, keep a safe minimum
  const navBar = Math.max(insets.bottom, Platform.OS === "android" ? 48 : 0);
  const kbCover = open && frame ? Math.max(0, frame.y + frame.h - kbTop) : 0;
  const bottom = open ? kbCover + 8 : navBar + (center ? 24 : 12);
  // a field is focused but no keyboard size is known: let the form scroll far enough anyway
  const spacer = focused && !open ? Math.round(Dimensions.get("window").height * 0.5) : 0;

  return (
    <View ref={box} onLayout={measure} style={[StyleSheet.absoluteFill, st.layer]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => Keyboard.dismiss()} accessible={false} />
      <View pointerEvents="box-none" style={[st.fill, { paddingTop: 8, paddingBottom: bottom, paddingHorizontal: center ? (open ? 16 : 24) : 0,
        justifyContent: center && !open ? "center" : "flex-end" }]}>
        <View style={[st.sheet, (open || center) && st.round, style]}>
          <SheetCtx.Provider value={{ spacer }}>{children}</SheetCtx.Provider>
        </View>
      </View>
    </View>
  );
}

/** ScrollView for a KeyboardSheet: shrinks to the sheet and scrolls the field being typed in into view. */
export function SheetScroll({ children, style, onScroll, contentContainerStyle, ...props }) {
  const { spacer } = useContext(SheetCtx);
  const ref = useRef(null);
  const y = useRef(0);
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => {
      // wait for the sheet to shrink, then check where the focused field is
      setTimeout(() => {
        const input = TextInput.State?.currentlyFocusedInput?.();
        const sv = ref.current;
        if (!input?.measureInWindow || !sv) return;
        const host = sv.getNativeScrollRef?.() ?? sv;
        host.measureInWindow?.((sx, sy, sw, sh) => {
          input.measureInWindow((ix, iy, iw, ih) => {
            const below = iy + ih - (sy + sh) + 12;
            const above = sy - iy + 12;
            if (below > 12) sv.scrollTo({ y: y.current + below, animated: true });
            else if (above > 12) sv.scrollTo({ y: Math.max(0, y.current - above), animated: true });
          });
        });
      }, Platform.OS === "ios" ? 320 : 180);
    });
    return () => sub.remove();
  }, []);
  return (
    <ScrollView ref={ref} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} showsVerticalScrollIndicator nestedScrollEnabled {...props}
      style={[{ flexShrink: 1 }, style]} contentContainerStyle={[{ paddingBottom: 24 + spacer }, contentContainerStyle]}
      onScroll={(e) => { y.current = e.nativeEvent.contentOffset.y; onScroll?.(e); }}>
      {children}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  layer: { zIndex: 1000, elevation: 1000, backgroundColor: "rgba(0,0,0,0.4)" },
  fill: { flex: 1 },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 8, overflow: "hidden", flexShrink: 1 },
  round: { borderRadius: 16 },
});
