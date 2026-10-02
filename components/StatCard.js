import React from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Layout } from "../styles/AppStyles";

export default function StatCard({ title, number, color }) {
  const scale = new Animated.Value(0.9);

  Animated.spring(scale, {
    toValue: 1,
    friction: 6,
    useNativeDriver: true,
  }).start();

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: color, width: Layout.cardWidth, transform: [{ scale }] },
      ]}
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.number}>{number}</Text>
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