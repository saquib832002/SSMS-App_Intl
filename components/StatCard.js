import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Layout } from "../styles/AppStyles";
import { _tx } from "../services/i18n";

export default function StatCard({ title, number, color }) {
  // keep one Animated.Value and run the intro animation once (not on every render)
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 6,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: color, width: Layout.cardWidth, transform: [{ scale }] },
      ]}
    >
      <Text style={styles.title}>{_tx(title)}</Text>
      <Text style={styles.number}>{_tx(number)}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: 20,
    marginBottom: 15,
  },
  title: { color: "white", fontSize: 14 },
  number: { color: "white", fontSize: 22, fontWeight: "bold", marginTop: 8 },
});