/**
 * Settings › Privacy requests (owner / admin)
 * Requests from parents, students and staff (or logged by the office): copies of data are made
 * automatically; corrections and deletions need a person. Each shows how many of the 30 days are left.
 * Deletion: review what is deleted and what must be kept → owner approves with the two-step code →
 * 7-day cancel window → personal details removed.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, ActivityIndicator, Modal, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getPrivacyRequests, getDeletionPlan, setPrivacyStatus, approveDeletion, logPrivacyRequest, downloadPrivacyCopy,
  REQUEST_LABEL, REQUEST_STATUS, niceWhen,
} from "../../services/SecurityApi";
import { getDay as getStaffDay } from "../../services/StaffAttendanceApi";
import { ymd } from "../../services/StudentLeaveApi";
import { C, Card, Btn, Field, Empty } from "../../components/ReportCardUI";
import StudentSearch from "../../components/StudentSearch";
import { _t, _tx } from "../../services/i18n";

export default function PrivacyRequestsScreen() {
  const { user } = useContext(AuthContext);
  const [tab, setTab]   = useState("open");
  const [data, setData] = useState(null);
  const [sel, setSel]   = useState(null);     // request
  const [plan, setPlan] = useState(null);
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog]   = useState(null);     // office form
  const [staff, setStaff] = useState(null);

  const load = useCallback(async () => {
    try { setData(await getPrivacyRequests(user, tab)); } catch (e) { Alert.alert(_t("Privacy requests"), _tx(e.message)); setData({ requests: [] }); }
  }, [user, tab]);
  useEffect(() => { setData(null); load(); }, [load]);

  const openReq = async (r) => {
    setSel(r); setPlan(null); setNote(""); setCode("");
    if (r.type === "delete") {
      try { setPlan(await getDeletionPlan(user, r.id)); } catch (e) { Alert.alert(_t("Deletion"), _tx(e.message)); }
    }
  };
  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); setSel(null); await load(); if (msg) Alert.alert(_t("Done"), _tx(msg)); }
    catch (e) { Alert.alert(_t("Privacy requests"), _tx(e.message)); } finally { setBusy(false); }
  };

  const openLog = async () => {
    setLog({ type: "export", subject_type: "student", subject: null, requester_name: "", details: "" });
    if (!staff) { try { setStaff((await getStaffDay(user, ymd(new Date()))).staff ?? []); } catch { setStaff([]); } }
  };
  const sendLog = () => act(async () => {
    if (!log.subject) throw new Error(_t("Choose who the request is about."));
    await logPrivacyRequest(user, { type: log.type, subject_type: log.subject_type, subject_id: log.subject.id,
      requester_name: log.requester_name, details: log.details });
    setLog(null);
  }, "Request logged.");

  const isOwner = !!data?.is_owner;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <View style={sx.tabs}>
          {[["open", "Open"], ["done", "Done"]].map(([k, l]) => (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={[sx.tab, tab === k && sx.tabOn]}>
              <Text style={[sx.tabTxt, tab === k && { color: C.brand }]}>{_tx(l)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!data ? <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} /> : !data.requests.length ? (
          <Card><Empty icon="inbox" text={tab === "open" ? _t("No open requests.") : _t("Nothing finished yet.")} /></Card>
        ) : (
          <Card>
            {data.requests.map((r) => {
              const st = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending;
              const left = r.days_left;
              const pct = Math.max(0, Math.min(100, ((30 - (left ?? 30)) / 30) * 100));
              return (
                <TouchableOpacity key={r.id} style={sx.row} onPress={() => openReq(r)} activeOpacity={0.75}>
                  <View style={sx.rowTop}>
                    <Text style={sx.title} numberOfLines={1}>{_tx(REQUEST_LABEL[r.type])} · {_tx(r.subject_name)}</Text>
                    {["pending", "in_review"].includes(r.status) && r.type !== "export" && left !== null ? (
                      <Text style={[sx.left, { color: left <= 5 ? C.err : C.warn }]}>{left < 0 ? _t("{v} days late", { v: -left }) : _t("{left} days left", { left })}</Text>
                    ) : <View style={[sx.pill, { backgroundColor: st.bg }]}><Text style={[sx.pillTxt, { color: st.fg }]}>{_tx(st.label)}</Text></View>}
                  </View>
                  {["pending", "in_review"].includes(r.status) && r.type !== "export" && (
                    <View style={sx.bar}><View style={[sx.barFill, { width: `${pct}%`, backgroundColor: left <= 5 ? C.err : "#f59e0b" }]} /></View>
                  )}
                  <Text style={sx.meta}>{r.channel === "office" ? _t("Logged by {requested_by}{v}", { requested_by: r.requested_by, v: r.requester_name ? ` ${_t("for {requester_name}", { requester_name: r.requester_name })}` : "" }) : _t("From {requested_by} in the app", { requested_by: r.requested_by })} · {niceWhen(r.created)}</Text>
                  {r.status === "scheduled" && <Text style={[sx.meta, { color: C.err }]}>{_t("Deletes on {delete_after} unless cancelled", { delete_after: niceWhen(r.delete_after) })}</Text>}
                </TouchableOpacity>
              );
            })}
          </Card>
        )}
        <Btn title={_t("Log a request received by e-mail / paper")} kind="ghost" icon="plus" onPress={openLog} />
      </ScrollView>

      {/* Request detail */}
      <Modal visible={!!sel} animationType="slide" onRequestClose={() => setSel(null)}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: Platform.OS === "ios" ? 60 : 24, backgroundColor: C.bg, flexGrow: 1 }}>
          {sel && (
            <>
              <Text style={sx.mTitle}>{_tx(REQUEST_LABEL[sel.type])} · {_tx(sel.subject_name)}</Text>
              <Text style={sx.meta}>{_t("#{id} · {label} · due {due_date}", { id: sel.id, label: (REQUEST_STATUS[sel.status] ?? {}).label, due_date: sel.due_date })}</Text>
              {!!sel.details && <Card style={{ marginTop: 12 }}><Text style={sx.body}>{_tx(sel.details)}</Text></Card>}
              {!!sel.decision_note && <Text style={[sx.meta, { marginTop: 8 }]}>{_t("Note: {decision_note}", { decision_note: sel.decision_note })}</Text>}

              {sel.type === "delete" && (!plan ? <ActivityIndicator color={C.brand} style={{ marginTop: 16 }} /> : (
                <>
                  {plan.blocker && <View style={sx.block}><Feather name="alert-triangle" size={14} color="#92400e" /><Text style={sx.blockTxt}>{_tx(plan.blocker)}</Text></View>}
                  <Card title={_t("Will be deleted")} style={{ marginTop: 12 }}>
                    {plan.will_delete.map((x) => <Item key={x} ic="×" color={C.err} text={_tx(x)} />)}
                  </Card>
                  <Card title={_t("Kept, with the name removed")}>
                    {plan.will_keep.map((x) => <Item key={x.what} ic="i" color={C.muted} text={`${_tx(x.what)} · ${_tx(x.why)}${x.years ? _t(", {years} years", { years: x.years }) : ""}`} />)}
                    <Text style={sx.meta}>{_t("Shown afterwards as “{name_after}”.", { name_after: plan.name_after })}</Text>
                  </Card>
                </>
              ))}

              {sel.status === "ready" && sel.has_file && sel.channel === "office" && (
                <Btn title={_t("Download the copy")} icon="download" busy={busy} onPress={() => act(() => downloadPrivacyCopy(user, sel))} />
              )}

              {["pending", "in_review"].includes(sel.status) && (
                <>
                  <Field label={_t("Note to the person (optional; required to say no)")} value={note} onChangeText={setNote} multiline style={{ minHeight: 60, textAlignVertical: "top", marginTop: 12 }} />
                  {sel.status === "pending" && <Btn title={_t("Mark as in review")} kind="ghost" icon="eye" onPress={() => act(() => setPrivacyStatus(user, sel.id, "in_review", note))} />}
                  {sel.type === "correction" && <Btn title={_t("Corrected – mark done")} icon="check" busy={busy} onPress={() => act(() => setPrivacyStatus(user, sel.id, "done", note), "Marked as done.")} />}
                  {sel.type === "delete" && (isOwner ? (
                    <>
                      {plan && !plan.blocker && user?.mfaEnabled && <Field label={_t("Your two-step code")} value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={9} placeholder="123456" />}
                      <Btn title={_t("Approve deletion")} kind="danger" icon="trash-2" busy={busy} disabled={!plan || !!plan.blocker}
                        onPress={() => Alert.alert(_t("Approve deletion"), _t("Personal details are removed after 7 days. You can cancel until then."), [
                          { text: _t("Cancel"), style: "cancel" },
                          { text: _t("Approve"), style: "destructive", onPress: () => act(() => approveDeletion(user, sel.id, code.trim()), "Scheduled – it runs in 7 days unless cancelled.") },
                        ])} />
                    </>
                  ) : <Text style={[sx.meta, { marginTop: 8 }]}>{_t("Only the school owner can approve a deletion.")}</Text>)}
                  <Btn title={_t("Say no (with a reason)")} kind="ghost" icon="x" onPress={() => act(() => setPrivacyStatus(user, sel.id, "rejected", note))} />
                </>
              )}
              {sel.status === "scheduled" && (
                <Btn title={_t("Cancel the deletion")} kind="ghost" icon="rotate-ccw" busy={busy} onPress={() => act(() => setPrivacyStatus(user, sel.id, "cancelled", note || "Cancelled by the school"), "Deletion cancelled.")} />
              )}
              <Btn title={_t("Close")} kind="ghost" onPress={() => setSel(null)} />
            </>
          )}
        </ScrollView>
      </Modal>

      {/* Office log */}
      <Modal visible={!!log} animationType="slide" onRequestClose={() => setLog(null)}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: Platform.OS === "ios" ? 60 : 24, backgroundColor: C.bg, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={sx.mTitle}>{_t("Log a request")}</Text>
          <Text style={sx.meta}>{_t("For requests that came by e-mail, letter or in person. Check who is asking before you log it.")}</Text>
          <Text style={sx.label}>{_t("What do they ask for?")}</Text>
          <View style={sx.tabs}>
            {["export", "correction", "delete"].map((t) => (
              <TouchableOpacity key={t} onPress={() => setLog({ ...log, type: t })} style={[sx.tab, log?.type === t && sx.tabOn]}>
                <Text style={[sx.tabTxt, log?.type === t && { color: C.brand }]}>{_tx(REQUEST_LABEL[t])}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={sx.label}>{_t("About")}</Text>
          <View style={sx.tabs}>
            {[["student", "A student"], ["staff", "A staff member"]].map(([k, l]) => (
              <TouchableOpacity key={k} onPress={() => setLog({ ...log, subject_type: k, subject: null })} style={[sx.tab, log?.subject_type === k && sx.tabOn]}>
                <Text style={[sx.tabTxt, log?.subject_type === k && { color: C.brand }]}>{_tx(l)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {log?.subject ? (
            <TouchableOpacity onPress={() => setLog({ ...log, subject: null })} style={sx.chosen}>
              <Text style={sx.title}>{_tx(log.subject.name)}</Text><Text style={sx.link}>{_t("Change")}</Text>
            </TouchableOpacity>
          ) : log?.subject_type === "student" ? (
            <StudentSearch user={user} value={null} onChange={(s) => s && setLog({ ...log, subject: { id: String(s.enrollment_id), name: s.student_name } })} />
          ) : (
            <Card>
              {(staff ?? []).map((s) => (
                <TouchableOpacity key={s.staff_id} style={sx.pRow} onPress={() => setLog({ ...log, subject: { id: String(s.staff_id), name: s.staff_name } })}>
                  <Text style={sx.body}>{_tx(s.staff_name)}</Text>
                </TouchableOpacity>
              ))}
              {!staff?.length && <Text style={sx.meta}>{_t("No staff found.")}</Text>}
            </Card>
          )}
          <Field label={_t("Who asked (name, how)")} placeholder={_t("e.g. Mrs Sen, by e-mail")} value={log?.requester_name ?? ""} onChangeText={(v) => setLog({ ...log, requester_name: v })} />
          <Field label={_t("Details")} value={log?.details ?? ""} onChangeText={(v) => setLog({ ...log, details: v })} multiline style={{ minHeight: 60, textAlignVertical: "top" }} />
          <Btn title={_t("Log request")} icon="save" busy={busy} onPress={sendLog} />
          <Btn title={_t("Cancel")} kind="ghost" onPress={() => setLog(null)} />
        </ScrollView>
      </Modal>
    </View>
  );
}

function Item({ ic, color, text }) {
  return (
    <View style={sx.item}>
      <View style={[sx.ic, { backgroundColor: color }]}><Text style={sx.icTxt}>{_tx(ic)}</Text></View>
      <Text style={sx.body}>{_tx(text)}</Text>
    </View>
  );
}

const sx = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 6, marginBottom: 10 },
  tab: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 10, paddingVertical: 9, alignItems: "center", backgroundColor: "#fff" },
  tabOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  tabTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 4 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: "700", color: C.ink },
  left: { fontSize: 11, fontWeight: "800" },
  bar: { height: 6, borderRadius: 3, backgroundColor: "#e2e8f0", overflow: "hidden" },
  barFill: { height: 6 },
  meta: { fontSize: 12, color: C.muted, lineHeight: 17 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { fontSize: 11, fontWeight: "800" },
  mTitle: { fontSize: 19, fontWeight: "800", color: C.ink, marginBottom: 4 },
  body: { fontSize: 13, color: C.ink, flex: 1, lineHeight: 18 },
  block: { flexDirection: "row", gap: 8, backgroundColor: "#fef3c7", borderRadius: 10, padding: 10, marginTop: 12 },
  blockTxt: { flex: 1, fontSize: 12, color: "#92400e", fontWeight: "600" },
  item: { flexDirection: "row", gap: 8, alignItems: "flex-start", paddingVertical: 5 },
  ic: { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  icTxt: { color: "#fff", fontWeight: "900", fontSize: 11 },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginTop: 10, marginBottom: 6 },
  chosen: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 10 },
  pRow: { paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  link: { color: C.brand, fontWeight: "700", fontSize: 13 },
});
