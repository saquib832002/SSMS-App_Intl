/**
 * Any staff member: my visitors. Tell reception who is coming (they get a 6-digit pass code, shown once, to give the
 * visitor), see who has arrived / left, cancel a visit.
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, Modal, Platform, RefreshControl, Share } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../../context/AuthContext";
import KeyboardSheet, { SheetScroll } from "../../components/KeyboardSheet";
import { C, Card, Btn, Empty, Picker, Field } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import { getMyVisitors, expectVisitor, cancelExpected, newVisitCode, passCodeMessage, opts, STATUS_LABEL, hm } from "../../services/SafetyApi";
import { fmtDate, fmtTime } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";

const STATUS_COLOR = { expected: C.brand, in: C.ok, out: C.muted, no_show: C.warn };

export default function MyVisitorsScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);

  const load = useCallback(async () => {
    try { setData(await getMyVisitors(user)); setErr(null); } catch (e) { setErr(_tx(e.message)); }
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const names = form.name.split(/\n/).map((x) => x.trim()).filter(Boolean);
    if (!names.length) { Alert.alert(_t("My visitors"), _t("Enter the visitor's name.")); return; }
    setBusy(true);
    try {
      const r = await expectVisitor(user, { ...form, names, mine: 1 });
      setForm(null);
      setCode({ code: r.code, visit: r.visit, visits: r.visits ?? [r.visit] });
      load();
    } catch (e) { Alert.alert(_t("My visitors"), _tx(e.message)); } finally { setBusy(false); }
  };

  const cancel = (v) => Alert.alert(_t("Cancel the visit of {name}?", { name: v.name }), _t("Their pass code will stop working."), [
    { text: _t("Keep"), style: "cancel" },
    { text: _t("Cancel visit"), style: "destructive", onPress: async () => {
      try { await cancelExpected(user, v.id); load(); } catch (e) { Alert.alert(_t("My visitors"), _tx(e.message)); }
    } },
  ]);

  const regen = (v) => Alert.alert(_t("New pass code?"), _t("The old code will stop working."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("New code"), onPress: async () => {
      try { const r = await newVisitCode(user, v.id); setCode({ code: r.code, visit: r.visits?.[0] ?? v, visits: r.visits ?? [v] }); load(); } catch (e) { Alert.alert(_t("My visitors"), _tx(e.message)); }
    } },
  ]);

  const shareCode = () => {
    Share.share({ message: passCodeMessage(code.code, code.visits, { date: (x) => fmtDate(x), time: fmtTime }) }).catch(() => {});
  };

  if (err) return <View style={{ flex: 1, backgroundColor: C.bg }}><Empty icon="lock" text={err} /></View>;
  if (!data) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;

  const upcoming = data.visits.filter((v) => v.status === "expected");
  const past = data.visits.filter((v) => v.status !== "expected");

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        {!data.linked ? (
          <Empty icon="user-x" text={_t("Your account is not linked to a staff record, so visitors cannot be booked for you.")} />
        ) : (
          <>
            <Card>
              <Text style={s.meta}>{_t("Tell reception who is coming. The visitor gets a pass code for a quick sign-in, and you are told when they arrive.")}</Text>
              <Btn title={_t("Expect a visitor")} icon="user-plus" style={{ marginTop: 10 }}
                onPress={() => setForm({ name: "", phone: "", company: "", purpose: "meeting", date: data.today, time: "", note: "" })} />
            </Card>
            <Card title={_t("Expected")}>
              {!upcoming.length && <Text style={s.meta}>{_t("Nobody expected.")}</Text>}
              {upcoming.map((v) => <Row key={v.id} v={v} o={data.options} onCancel={() => cancel(v)} onCode={() => regen(v)} />)}
            </Card>
            <Card title={_t("Last 2 weeks")}>
              {!past.length && <Text style={s.meta}>{_t("No visitors.")}</Text>}
              {past.map((v) => <Row key={v.id} v={v} o={data.options} />)}
            </Card>
          </>
        )}
      </ScrollView>

      <KeyboardSheet visible={!!form} onClose={() => setForm(null)}>
            {!!form && (
              <SheetScroll>
                <Text style={s.big}>{_t("Expect a visitor")}</Text>
                <Field label={_t("Guest name(s) – one per line for a group")} value={form.name} onChangeText={(t) => set("name", t)} multiline style={{ minHeight: 70, textAlignVertical: "top" }} />
                <Field label={_t("Mobile number")} value={form.phone} onChangeText={(t) => set("phone", t)} keyboardType="phone-pad" maxLength={30} />
                <Field label={_t("Company / organisation")} value={form.company} onChangeText={(t) => set("company", t)} maxLength={120} />
                <Picker label={_t("Purpose")} value={form.purpose} options={opts(data.options?.purposes)} onChange={(v) => set("purpose", v)} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}><DateTimeField label={_t("Date")} value={form.date} onChange={(v) => set("date", v)} minimumDate={new Date(`${data.today}T00:00:00`)} /></View>
                  <View style={{ flex: 1 }}><DateTimeField label={_t("Time")} mode="time" value={form.time} onChange={(v) => set("time", v)} placeholder={_t("Any time")} /></View>
                </View>
                <Field label={_t("Note for reception")} value={form.note} onChangeText={(t) => set("note", t)} maxLength={500} />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Btn title={_t("Cancel")} kind="ghost" onPress={() => setForm(null)} style={{ flex: 1 }} />
                  <Btn title={_t("Save")} icon="check" busy={busy} onPress={save} style={{ flex: 1 }} />
                </View>
              </SheetScroll>
            )}
      </KeyboardSheet>

      <Modal visible={!!code} transparent animationType="fade" onRequestClose={() => setCode(null)}>
        <View style={[s.overlay, { justifyContent: "center", padding: 24 }]}>
          <View style={[s.sheet, { borderRadius: 16, alignItems: "center" }]}>
            <Text style={[s.big, { textAlign: "center" }]}>{(code?.visits ?? []).map((v) => v.name).join(", ")}</Text>
            <Text style={s.meta}>{code ? fmtDate(code.visit.date) : ""}{code?.visit?.expected_time ? ` · ${fmtTime(code.visit.expected_time)}` : ""}</Text>
            <Text style={s.code}>{code?.code}</Text>
            <Text style={[s.meta, { textAlign: "center" }]}>{_t("Send this pass code to the visitor. It is shown only now.")}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14, alignSelf: "stretch" }}>
              <Btn title={_t("Share")} icon="share-2" kind="ghost" onPress={shareCode} style={{ flex: 1 }} />
              <Btn title={_t("Done")} onPress={() => setCode(null)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ v, o, onCancel, onCode }) {
  const when = v.status === "in" ? _t("Arrived {time}", { time: fmtTime(hm(v.signed_in_at)) })
    : v.status === "out" ? _t("{in} – {out}", { in: fmtTime(hm(v.signed_in_at)), out: fmtTime(hm(v.signed_out_at)) })
      : v.expected_time ? fmtTime(v.expected_time) : "";
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.name}>{v.name}{v.company ? <Text style={s.meta}>{`  ${v.company}`}</Text> : null}</Text>
        <Text style={s.meta}>{fmtDate(v.date, "dayMonth")}{when ? ` · ${when}` : ""} · {_tx(o?.purposes?.[v.purpose] ?? v.purpose)}</Text>
        <Text style={[s.status, { color: STATUS_COLOR[v.status] ?? C.muted }]}>{STATUS_LABEL[v.status]?.() ?? v.status}</Text>
      </View>
      {onCancel && (
        <View style={{ gap: 6 }}>
          <Btn title={_t("New code")} kind="ghost" onPress={onCode} />
          <Btn title={_t("Cancel visit")} kind="ghost" onPress={onCancel} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 18, fontWeight: "800", color: C.ink, marginBottom: 4 },
  name: { fontSize: 14, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17, fontWeight: "400" },
  status: { fontSize: 12, fontWeight: "800", marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderColor: "#f1f5f9" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "92%" },
  code: { fontSize: 40, fontWeight: "900", letterSpacing: 8, color: C.brand, marginVertical: 12 },
});
