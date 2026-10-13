/**
 * Date or time field: tap → native picker (Android dialog, iOS compact picker).
 * value: "YYYY-MM-DD" (mode="date") or "HH:MM" (mode="time").
 */
import React, { useState } from "react";
import { View, Text, TouchableOpacity, Platform, StyleSheet } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { ymd, hm, niceDate, niceTime } from "../services/StudentLeaveApi";
import { _t, _tx } from "../services/i18n";

const toDate = (value, mode) => {
  const d = new Date();
  if (!value) return d;
  if (mode === "time") {
    const [h, m] = value.split(":").map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  }
  const x = new Date(`${value}T00:00:00`);
  return isNaN(x) ? d : x;
};

export default function DateTimeField({ label, value, onChange, mode = "date", minimumDate, maximumDate, placeholder }) {
  const [show, setShow] = useState(false);
  const display = mode === "time" ? niceTime(value) : niceDate(value);
  const handle = (e, d) => {
    if (Platform.OS === "android") setShow(false);
    if (e?.type === "dismissed" || !d) return;
    onChange(mode === "time" ? hm(d) : ymd(d));
  };
  return (
    <View style={{ marginBottom: 10 }}>
      {!!label && <Text style={st.label}>{_tx(label)}</Text>}
      {Platform.OS === "ios" ? (
        <View style={st.iosRow}>
          <DateTimePicker value={toDate(value, mode)} mode={mode} display="compact" onChange={handle}
            minimumDate={minimumDate} maximumDate={maximumDate} />
        </View>
      ) : (
        <>
          <TouchableOpacity style={st.box} onPress={() => setShow(true)} activeOpacity={0.75}>
            <Feather name={mode === "time" ? "clock" : "calendar"} size={15} color="#64748b" />
            <Text style={[st.txt, !value && { color: "#94a3b8" }]}>{value ? _tx(display) : _tx(placeholder) || _t("Choose")}</Text>
          </TouchableOpacity>
          {show && (
            <DateTimePicker value={toDate(value, mode)} mode={mode} display="default" onChange={handle}
              minimumDate={minimumDate} maximumDate={maximumDate} />
          )}
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  box: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1",
         borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  txt: { fontSize: 14, color: "#0f172a", fontWeight: "500" },
  iosRow: { alignItems: "flex-start" },
});
