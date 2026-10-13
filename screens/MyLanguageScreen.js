/**
 * My language – each person chooses the language of their own app, notifications and e-mails.
 * "Same as the school" follows Setup › Region & formats (the school's language).
 */
import React, { useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, I18nManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { C, Card } from "../components/ReportCardUI";
import { _t, LANGUAGES } from "../services/i18n";
import { getUserLanguage, schoolLanguage, saveMyLanguage, setUserLanguage } from "../services/Locale";

export default function MyLanguageScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [chosen, setChosen] = useState(getUserLanguage());
  const [busy, setBusy] = useState(null);
  const school = LANGUAGES.find((l) => l.code === schoolLanguage()) ?? LANGUAGES[0];

  const pick = async (code) => {
    if (code === chosen || busy !== null) return;
    setBusy(code);
    try {
      const r = await saveMyLanguage(user, code);
      const own = r.user_language || "";
      const next = own || schoolLanguage();
      const flip = !!LANGUAGES.find((l) => l.code === next)?.rtl !== I18nManager.isRTL;
      setChosen(own);
      Alert.alert(_t("Language changed"),
        _t("Your app, notifications and e-mails will use this language. Other people in the school are not affected.")
          + (flip ? "\n\n" + _t("Close and reopen the app to finish changing the screen direction.") : ""),
        [{ text: _t("OK"), onPress: () => setUserLanguage(own) }]);   // the screens are re-drawn in the new language
    } catch (e) {
      Alert.alert(_t("Language"), e.message);
    } finally {
      setBusy(null);
    }
  };

  const Row = ({ code, title, sub }) => {
    const on = chosen === code;
    return (
      <TouchableOpacity style={[s.row, on && s.rowOn]} activeOpacity={0.8} onPress={() => pick(code)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, on && { color: C.brand }]}>{title}</Text>
          {!!sub && <Text style={s.sub}>{sub}</Text>}
        </View>
        {busy === code ? <ActivityIndicator color={C.brand} /> : <Feather name={on ? "check-circle" : "circle"} size={20} color={on ? C.brand : "#cbd5e1"} />}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>
      <Card>
        <Text style={s.meta}>{_t("Choose the language for your own app, notifications and e-mails. Names, notices and other text typed by the school are not translated.")}</Text>
      </Card>
      <Card>
        <Row code="" title={_t("Same as the school")} sub={`${school.native}${school.native !== school.name ? ` · ${school.name}` : ""}`} />
        {LANGUAGES.map((l) => (
          <Row key={l.code} code={l.code} title={l.native} sub={l.native !== l.name ? l.name : null} />
        ))}
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  meta: { fontSize: 13, color: C.muted, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: "transparent", marginBottom: 4 },
  rowOn: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" },
  title: { fontSize: 15, fontWeight: "700", color: C.ink },
  sub: { fontSize: 12, color: C.muted, marginTop: 2 },
});
