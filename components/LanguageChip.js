/**
 * Language chip for the sign-in screen: change the app language before signing in.
 * The choice is kept for the account after sign-in (My language).
 */
import React, { useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { _t, LANGUAGES, useLanguage } from "../services/i18n";
import { pickLanguageBeforeSignIn } from "../services/Locale";

export default function LanguageChip({ style }) {
  const lang = useLanguage();
  const [open, setOpen] = useState(false);
  const cur = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  return (
    <>
      <TouchableOpacity style={[s.chip, style]} onPress={() => setOpen(true)} accessibilityLabel={_t("Language")}>
        <Feather name="globe" size={14} color="#1d4ed8" />
        <Text style={s.chipTxt}>{cur.native}</Text>
        <Feather name="chevron-down" size={14} color="#1d4ed8" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.sheet}>
            <Text style={s.head}>{_t("Language")}</Text>
            {LANGUAGES.map((l) => (
              <TouchableOpacity key={l.code} style={s.opt} onPress={() => { setOpen(false); if (l.code !== lang) pickLanguageBeforeSignIn(l.code); }}>
                <Text style={[s.optTxt, l.code === lang && s.on]}>{l.native}</Text>
                {l.native !== l.name && <Text style={s.optSub}>{l.name}</Text>}
                {l.code === lang && <Feather name="check" size={16} color="#1d4ed8" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", backgroundColor: "#fff", borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipTxt: { fontSize: 13, fontWeight: "700", color: "#1d4ed8" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 28 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 14 },
  head: { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 6, paddingHorizontal: 6 },
  opt: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  optTxt: { fontSize: 15, color: "#0f172a", fontWeight: "600" },
  optSub: { flex: 1, fontSize: 12, color: "#64748b" },
  on: { color: "#1d4ed8", fontWeight: "800" },
});
