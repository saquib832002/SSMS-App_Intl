/**
 * Full-screen QR scanner (expo-camera). Calls onScan(text) once, then closes.
 * Only render it when hasCamera() is true.
 */
import React, { useRef } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { CameraModule } from "../services/DeviceSensors";
import { _tx } from "../services/i18n";

export default function QrScanner({ visible, onScan, onClose, title = "Scan the code on the office screen" }) {
  const done = useRef(false);
  const Cam = CameraModule();
  if (!visible || !Cam) return null;
  const { CameraView } = Cam;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} onShow={() => { done.current = false; }}>
      <View style={sx.wrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (done.current || !data) return;
            done.current = true;
            onScan(String(data));
          }}
        />
        <View style={sx.top}>
          <Text style={sx.title}>{_tx(title)}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}><Feather name="x" size={26} color="#fff" /></TouchableOpacity>
        </View>
        <View style={sx.frame} pointerEvents="none" />
      </View>
    </Modal>
  );
}

const sx = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", top: Platform.OS === "ios" ? 54 : 24, left: 16, right: 16, flexDirection: "row",
         alignItems: "center", justifyContent: "space-between" },
  title: { color: "#fff", fontSize: 16, fontWeight: "800", flex: 1, marginRight: 12 },
  frame: { position: "absolute", alignSelf: "center", top: "28%", width: 250, height: 250, borderWidth: 3,
           borderColor: "#a5b4fc", borderRadius: 20 },
});
