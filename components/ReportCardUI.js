/**
 * Small shared UI for the grading / report card screens.
 */
import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, FlatList, StyleSheet, ActivityIndicator, TextInput,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { _t, _tx } from "../services/i18n";

export const C = {
  brand: "#5b21b6", brandSoft: "#ede9fe", ink: "#0f172a", muted: "#64748b",
  line: "#e2e8f0", bg: "#f8fafc", ok: "#15803d", warn: "#b45309", err: "#b91c1c",
};

export function Picker({ label, value, options, onChange, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const opts = Array.isArray(options) ? options : [];   // a denied lookup → empty, not a crash
  const sel = opts.find((o) => String(o.value) === String(value));
  return (
    <>
      {!!label && <Text style={u.label}>{_tx(label)}</Text>}
      <TouchableOpacity style={[u.picker, disabled && { opacity: 0.5 }]} onPress={() => !disabled && setOpen(true)} activeOpacity={0.75}>
        <Text style={[u.pickerTxt, !sel && { color: "#94a3b8" }]} numberOfLines={1}>{_tx(sel?.label) ?? _tx(placeholder) ?? _t("Select")}</Text>
        <Feather name="chevron-down" size={15} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={u.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={u.sheet}>
            <Text style={u.sheetTitle}>{_tx(label) || _tx(placeholder) || _t("Select")}</Text>
            <FlatList
              data={opts}
              keyExtractor={(o, i) => String(o.value) + i}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
              renderItem={({ item: o }) => {
                const act = String(o.value) === String(value);
                return (
                  <TouchableOpacity style={[u.opt, act && { backgroundColor: C.brandSoft }]} onPress={() => { onChange(o.value); setOpen(false); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[u.optTxt, act && { color: C.brand, fontWeight: "800" }]}>{_tx(o.label)}</Text>
                      {!!o.sub && <Text style={u.optSub}>{_tx(o.sub)}</Text>}
                    </View>
                    {act && <Feather name="check" size={15} color={C.brand} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export function Card({ title, right, children, style }) {
  return (
    <View style={[u.card, style]}>
      {(!!title || right) && (
        <View style={u.cardHead}>
          {!!title && <Text style={u.cardTitle}>{_tx(title)}</Text>}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Btn({ title, onPress, busy, kind = "primary", icon, disabled, style }) {
  const ghost = kind === "ghost";
  const danger = kind === "danger";
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy || disabled}
      activeOpacity={0.8}
      style={[u.btn, ghost && u.btnGhost, danger && { backgroundColor: "#fee2e2" }, (busy || disabled) && { opacity: 0.6 }, style]}
    >
      {busy ? <ActivityIndicator color={ghost || danger ? C.brand : "#fff"} /> : (
        <>
          {!!icon && <Feather name={icon} size={15} color={ghost ? C.brand : danger ? C.err : "#fff"} style={{ marginRight: 8 }} />}
          <Text style={[u.btnTxt, ghost && { color: C.brand }, danger && { color: C.err }]}>{_tx(title)}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function Field({ label, style, ...props }) {
  return (
    <>
      {!!label && <Text style={u.label}>{_tx(label)}</Text>}
      <TextInput placeholderTextColor="#94a3b8" style={[u.input, style]} {...props} />
    </>
  );
}

export function Toggle({ label, value, onChange, hint }) {
  return (
    <TouchableOpacity style={u.toggle} onPress={() => onChange(!value)} activeOpacity={0.75}>
      <View style={[u.box, value && { backgroundColor: C.brand, borderColor: C.brand }]}>
        {value && <Feather name="check" size={12} color="#fff" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={u.toggleTxt}>{_tx(label)}</Text>
        {!!hint && <Text style={u.hint}>{_tx(hint)}</Text>}
      </View>
    </TouchableOpacity>
  );
}

export function Empty({ icon = "inbox", text }) {
  return (
    <View style={{ alignItems: "center", padding: 28 }}>
      <Feather name={icon} size={30} color="#cbd5e1" />
      <Text style={[u.hint, { textAlign: "center", marginTop: 8 }]}>{_tx(text)}</Text>
    </View>
  );
}

export const u = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  picker: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1",
            borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 10 },
  pickerTxt: { flex: 1, fontSize: 14, color: C.ink, fontWeight: "500" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 14, maxHeight: "72%" },
  sheetTitle: { fontSize: 15, fontWeight: "800", color: C.ink, marginBottom: 8 },
  opt: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  optTxt: { fontSize: 14, color: C.ink },
  optSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.line },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  cardTitle: { fontSize: 13, fontWeight: "800", color: C.brand, textTransform: "uppercase", letterSpacing: 0.5 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: C.brand, borderRadius: 10,
         paddingVertical: 12, paddingHorizontal: 14, marginTop: 6 },
  btnGhost: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: C.brand },
  btnTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12,
           paddingVertical: 10, fontSize: 14, color: C.ink, marginBottom: 10 },
  toggle: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 8 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: "#94a3b8", alignItems: "center",
         justifyContent: "center", marginRight: 10, marginTop: 1 },
  toggleTxt: { fontSize: 14, color: C.ink, fontWeight: "600" },
  hint: { fontSize: 12, color: C.muted, marginTop: 2 },
});
