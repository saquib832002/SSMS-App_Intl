/**
 * components/FeatureLock.js
 *
 * Lock icons on menu tiles / tabs for paid features that are not active
 * (not in the plan, or the subscription / free trial has expired).
 * Tapping a locked option shows the "Upgrade required" pop-up instead of
 * opening the screen. Indian (legacy) schools are never locked.
 *
 *   const { isLocked, guard } = useFeatureLock();
 *   <TouchableOpacity onPress={guard("Attendance", () => navigation.navigate("Attendance"))}>
 *     ...icon...
 *     {isLocked("Attendance") && <LockBadge />}
 */
import React, { useContext, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { ROUTE_FEATURES } from "../constants/RouteFeatures";

export function useFeatureLock() {
  const { hasFeature, showUpgradePrompt } = useContext(AuthContext);

  /** Feature key for a screen (route) name, or undefined if it is free. */
  const featureOf = useCallback((screen) => ROUTE_FEATURES[screen], []);

  /** true when the screen belongs to a paid feature this school can't use now. */
  const isLocked = useCallback((screen) => {
    const f = ROUTE_FEATURES[screen];
    return !!f && !hasFeature(f);
  }, [hasFeature]);

  /** Returns an onPress: locked → upgrade pop-up, otherwise run `go`. */
  const guard = useCallback((screen, go) => () => {
    const f = ROUTE_FEATURES[screen];
    if (f && !hasFeature(f)) showUpgradePrompt(f);
    else go?.();
  }, [hasFeature, showUpgradePrompt]);

  return { featureOf, isLocked, guard, showUpgradePrompt };
}

/** Small lock badge – place inside a tile's icon box (top-right corner). */
export function LockBadge({ size = 10, style }) {
  return (
    <View style={[s.badge, style]} pointerEvents="none">
      <Feather name="lock" size={size} color="#fff" />
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    position: "absolute", top: -5, right: -5,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: "#dc2626", borderWidth: 2, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
});
