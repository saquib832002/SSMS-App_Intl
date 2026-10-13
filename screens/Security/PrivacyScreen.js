/**
 * My account › Privacy (parents, students, staff)
 * Your consent choices (change any time), and your data: download a copy, ask for a correction,
 * or ask for deletion. Requests are answered by the school within 30 days.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, ActivityIndicator, Modal, Switch } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getMyPrivacy, answerConsents, askPrivacy, withdrawPrivacy, downloadPrivacyCopy, REQUEST_LABEL, REQUEST_STATUS, niceWhen,
} from "../../services/SecurityApi";
import { C, Card, Btn, Field, Empty } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";

export default function PrivacyScreen() {
  const { user } = useContext(AuthContext);
  const [d, setD]       = useState(null);
  const [form, setForm] = useState(null);   // { type, subject_id, details }
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try { setD(await getMyPrivacy(user)); } catch (e) { Alert.alert(_t("Privacy"), _tx(e.message)); setD({ consents: [], requests: [], subjects: [] }); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;

  const setChoice = async (s, t, v) => {
    if (t.required && !v) {
      Alert.alert(_tx(t.title), _t("This is needed to use the app. If you no longer agree, please contact the school."));
      return;
    }
    try { await answerConsents(user, [{ subject_id: s.subject_id, type_id: t.id, granted: v }]); await load(); }
    catch (e) { Alert.alert(_t("Privacy"), _tx(e.message)); }
  };

  const ask = (type, subject) => setForm({ type, subject_id: subject?.subject_id ?? "", subject_name: subject?.name ?? "", details: "" });
  const send = async () => {
    setBusy(true);
    try {
      const r = await askPrivacy(user, { type: form.type, subject_id: form.subject_id, details: form.details });
      setForm(null); await load();
      Alert.alert(_tx(REQUEST_LABEL[r.type]), r.type === "export" && r.status === "ready"
        ? _t("Your copy is ready. Tap Download in “My requests”.") : _t("Sent to the school. They will reply within 30 days."));
    } catch (e) { Alert.alert(_t("Request"), _tx(e.message)); } finally { setBusy(false); }
  };
  const download = async (r) => {
    setBusy(true);
    try { await downloadPrivacyCopy(user, r); } catch (e) { Alert.alert(_t("Download"), _tx(e.message)); } finally { setBusy(false); }
  };

  const subjects = d.subjects?.length ? d.subjects : [];
  const isStaff = d.is_staff;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      {d.consents.map((s) => (
        <Card key={s.subject_id} title={s.subject_type === "staff" ? _t("My choices") : _t("Choices for {name}", { name: s.name })}>
          {s.types.map((t) => (
            <View key={t.id} style={sx.cRow}>
              <View style={{ flex: 1 }}>
                <TouchableOpacity onPress={() => setOpen(open === `${s.subject_id}${t.id}` ? null : `${s.subject_id}${t.id}`)}>
                  <Text style={sx.cTitle}>{_tx(t.title)}{t.required ? <Text style={sx.req}>{" "}{_t("· required")}</Text> : null}</Text>
                  <Text style={sx.meta}>{t.granted === null ? _t("Not answered") : _t("{v} since {answered}", { v: t.granted ? _t("Yes") : _t("No"), answered: niceWhen(t.answered) })}{t.outdated ? (" " + _t("· wording changed") + "") : ""}</Text>
                </TouchableOpacity>
                {open === `${s.subject_id}${t.id}` && <Text style={sx.body}>{_tx(t.body)}</Text>}
              </View>
              <Switch value={!!t.granted} onValueChange={(v) => setChoice(s, t, v)} trackColor={{ true: "#c4b5fd", false: "#e2e8f0" }} thumbColor={t.granted ? C.brand : "#94a3b8"} />
            </View>
          ))}
        </Card>
      ))}

      <Card title={isStaff ? _t("My data") : _t("Your child's data")}>
        {(isStaff ? [{ subject_id: "", name: "me" }] : subjects).map((s) => (
          <View key={s.subject_id || "me"} style={{ marginBottom: 6 }}>
            {!isStaff && subjects.length > 1 && <Text style={sx.who}>{_tx(s.name)}</Text>}
            {[
              ["export", "download", "Download a copy", "Profile, attendance, marks, fees, leave and consents"],
              ["correction", "edit-3", "Ask for a correction", "Something in the records is wrong"],
              ["delete", "trash-2", "Ask to delete data", isStaff ? "When you leave the school" : "When your child leaves the school"],
            ].map(([type, icon, title, sub]) => (
              <TouchableOpacity key={type} style={sx.aRow} onPress={() => ask(type, isStaff ? null : s)}>
                <Feather name={icon} size={17} color={type === "delete" ? C.err : C.brand} />
                <View style={{ flex: 1 }}><Text style={sx.aTitle}>{_tx(title)}</Text><Text style={sx.meta}>{_tx(sub)}</Text></View>
                <Feather name="chevron-right" size={16} color="#cbd5e1" />
              </TouchableOpacity>
            ))}
          </View>
        ))}
        {!isStaff && !subjects.length && <Empty icon="user" text={_t("No children linked to your account.")} />}
      </Card>

      <Card title={_t("My requests")}>
        {!d.requests.length ? <Empty icon="inbox" text={_t("No requests yet.")} /> : d.requests.map((r) => {
          const st = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending;
          return (
            <View key={r.id} style={sx.rRow}>
              <View style={{ flex: 1 }}>
                <Text style={sx.aTitle}>{_tx(REQUEST_LABEL[r.type])} · {_tx(r.subject_name)}</Text>
                <Text style={sx.meta}>{_t("Sent {created}{v}", { created: niceWhen(r.created), v: r.decision_note ? ` · ${r.decision_note}` : "" })}</Text>
                {r.status === "ready" && r.file_expires && <Text style={sx.meta}>{_t("Download until {file_expires}", { file_expires: niceWhen(r.file_expires) })}</Text>}
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <View style={[sx.pill, { backgroundColor: st.bg }]}><Text style={[sx.pillTxt, { color: st.fg }]}>{_tx(st.label)}</Text></View>
                {r.has_file && <TouchableOpacity onPress={() => download(r)} disabled={busy}><Text style={sx.link}>{_t("Download")}</Text></TouchableOpacity>}
                {["pending", "in_review", "scheduled"].includes(r.status) && (
                  <TouchableOpacity onPress={() => Alert.alert(_t("Withdraw request"), _t("Cancel this request?"), [
                    { text: _t("No"), style: "cancel" },
                    { text: _t("Withdraw"), onPress: async () => { try { await withdrawPrivacy(user, r.id); await load(); } catch (e) { Alert.alert(_t("Withdraw"), _tx(e.message)); } } },
                  ])}><Text style={[sx.link, { color: C.muted }]}>{_t("Withdraw")}</Text></TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </Card>

      <Modal visible={!!form} transparent animationType="fade" onRequestClose={() => setForm(null)}>
        <View style={sx.overlay}><View style={sx.sheet}>
          <Text style={sx.mTitle}>{form && _tx(REQUEST_LABEL[form.type])}{form?.subject_name && !isStaff ? ` · ${_tx(form.subject_name)}` : ""}</Text>
          <Text style={sx.meta}>
            {form?.type === "export" ? _t("We'll make a file with the records the school holds. You can download it for 7 days. One copy per 30 days.")
              : form?.type === "correction" ? _t("Tell the school what is wrong and what it should be.")
              : _t("The school removes personal details once the student has left. Some records must be kept by law (for example fee receipts) – they stay, without the name. The owner approves and there is a 7-day window to cancel.")}
          </Text>
          {form?.type !== "export" && (
            <Field label={form?.type === "correction" ? _t("What should be corrected") : _t("Anything the school should know (optional)")}
              value={form?.details ?? ""} onChangeText={(v) => setForm({ ...form, details: v })} multiline style={{ minHeight: 80, textAlignVertical: "top" }} />
          )}
          <Btn title={form?.type === "export" ? _t("Make my copy") : _t("Send request")} busy={busy} onPress={send} />
          <Btn title={_t("Cancel")} kind="ghost" onPress={() => setForm(null)} />
        </View></View>
      </Modal>
    </ScrollView>
  );
}

const sx = StyleSheet.create({
  cRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  cTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  req: { fontSize: 11, color: C.muted, fontWeight: "500" },
  body: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  who: { fontSize: 12, fontWeight: "800", color: C.brand, marginTop: 6 },
  aRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  aTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  rRow: { flexDirection: "row", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { fontSize: 11, fontWeight: "800" },
  link: { color: C.brand, fontWeight: "700", fontSize: 13 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 18 },
  mTitle: { fontSize: 18, fontWeight: "800", color: C.ink, marginBottom: 6 },
});
