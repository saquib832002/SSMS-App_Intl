/**
 * Teacher: my cover periods – where, when, for whom, the office's note. Accept, or say "I can't" (the office is told).
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Alert, Modal, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Empty, Field } from "../../components/ReportCardUI";
import { getMyCovers, respondCover, niceDay } from "../../services/CoverApi";
import { scheduleClassReminders, getLeadTime } from "../../services/NotificationService";
import { _t, _tx } from "../../services/i18n";

export default function MyCoversScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [decline, setDecline] = useState(null);   // { cover, note }

  const load = useCallback(async () => {
    setLoading(true);
    try { setD(await getMyCovers(user)); setErr(null); } catch (e) { setErr(e.message); } finally { setLoading(false); }
    // today's class reminders follow the covers (added, cancelled, declined)
    getLeadTime().then((m) => scheduleClassReminders(user, m)).catch(() => {});
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const answer = async (x, accept, note = "") => {
    setBusy(x.id);
    try {
      await respondCover(user, x.id, accept, note);
      setDecline(null);
      await load();
      if (!accept) Alert.alert(_t("Thank you"), _t("The office has been told and will find someone else."));
    } catch (e) { Alert.alert(_t("Cover"), _tx(e.message)); } finally { setBusy(null); }
  };

  const list = d?.covers ?? [];
  const upcoming = list.filter((x) => !x.past);
  const past = list.filter((x) => x.past);

  const item = (x) => {
    const declined = x.status === "declined";
    return (
      <Card key={x.id} style={(x.past || declined) && { opacity: 0.65 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <Feather name={declined ? "x-circle" : x.status === "accepted" ? "check-circle" : "clock"} size={18} color={declined ? C.err : x.status === "accepted" ? C.ok : C.brand} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{x.class_label}{x.subject ? ` · ${_tx(x.subject)}` : ""}</Text>
            <Text style={s.meta}>{niceDay(x.date)}{x.date === d.today ? ` ${_t("(today)")}` : ""} · {_tx(x.period_name) || _t("Period {n}", { n: x.period_number })}{x.start ? ` · ${x.start}${x.end ? `–${x.end}` : ""}` : ""}</Text>
            <Text style={s.meta}>{_t("For {teacher}", { teacher: x.for })}{x.room ? ` · ${_t("Room {room}", { room: x.room })}` : ""}</Text>
            {!!x.note && <Text style={[s.meta, { color: C.ink }]}>{_t("Office: {note}", { note: x.note })}</Text>}
            {declined && <Text style={[s.meta, { color: C.err }]}>{_t("You said you can't take it.")}{x.response_note ? ` “${x.response_note}”` : ""}</Text>}
            {x.status === "accepted" && <Text style={[s.meta, { color: C.ok }]}>{_t("Accepted")}</Text>}
          </View>
        </View>
        {!x.past && !declined && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            {x.status !== "accepted" && <Btn title={_t("Accept")} icon="check" busy={busy === x.id} onPress={() => answer(x, true)} style={{ flex: 1 }} />}
            {d.allow_decline && <Btn title={_t("I can't")} icon="x" kind="ghost" disabled={busy === x.id} onPress={() => setDecline({ cover: x, note: "" })} style={{ flex: 1 }} />}
          </View>
        )}
      </Card>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={loading && !!d} onRefresh={load} />}>
        {!d && !err && <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}
        {!!err && <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>}
        {d && !d.linked && <Card><Empty icon="user-x" text={_t("Your account isn't linked to a staff record, so no cover periods can be shown. Ask the office to link it.")} /></Card>}
        {d && d.linked && !list.length && <Card><Empty icon="coffee" text={_t("No cover periods for you.")} /></Card>}
        {upcoming.map(item)}
        {past.length > 0 && <Text style={s.section}>{_t("Earlier")}</Text>}
        {past.map(item)}
      </ScrollView>

      <Modal visible={!!decline} transparent animationType="slide" onRequestClose={() => setDecline(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.overlay}>
          <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Text style={[s.title, { flex: 1 }]}>{_t("Can't take this period?")}</Text>
              <TouchableOpacity onPress={() => setDecline(null)} hitSlop={10}><Feather name="x" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            {decline && <Text style={s.meta}>{decline.cover.class_label} · {niceDay(decline.cover.date)} · {_tx(decline.cover.period_name)}</Text>}
            <Field label={_t("Reason for the office (optional)")} value={decline?.note ?? ""} onChangeText={(v) => setDecline({ ...decline, note: v })} placeholder={_t("e.g. Parent meeting at that time")} maxLength={255} />
            <Btn title={_t("Tell the office")} icon="send" kind="danger" busy={!!decline && busy === decline.cover.id} onPress={() => answer(decline.cover, false, decline.note)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 17 },
  section: { fontSize: 12, fontWeight: "800", color: C.muted, textTransform: "uppercase", marginVertical: 8 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
});
