/**
 * Settings › Consents
 *  Report (staff): who said yes / no / hasn't answered for one consent, grouped by class
 *                  (teachers see their own classes) – e.g. check "Photos" before an event.
 *  Settings (owner / admin): what the school asks; editing the wording makes a new version and
 *                  everyone is asked again. Record an answer from a paper form.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, ActivityIndicator, Modal, Platform } from "react-native";
import { AuthContext } from "../../context/AuthContext";
import { getConsentReport, getConsentTypes, saveConsentType, recordPaperConsent } from "../../services/SecurityApi";
import { C, Card, Btn, Field, Toggle, Empty } from "../../components/ReportCardUI";
import StudentSearch from "../../components/StudentSearch";
import { _t, _tx } from "../../services/i18n";

export default function ConsentsScreen() {
  const { user } = useContext(AuthContext);
  const role = (user?.ssmsUserRole ?? "").toLowerCase();
  const isAdmin = ["owner", "admin"].includes(role);
  const [tab, setTab] = useState("report");
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {isAdmin && (
        <View style={[sx.tabs, { padding: 16, paddingBottom: 0 }]}>
          {[["report", "Report"], ["settings", "What we ask"]].map(([k, l]) => (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={[sx.tab, tab === k && sx.tabOn]}>
              <Text style={[sx.tabTxt, tab === k && { color: C.brand }]}>{_tx(l)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {tab === "report" ? <Report user={user} isAdmin={isAdmin} /> : <Settings user={user} />}
    </View>
  );
}

function Report({ user, isAdmin }) {
  const [types, setTypes] = useState([]);
  const [typeId, setTypeId] = useState(null);
  const [rep, setRep] = useState(null);
  const [show, setShow] = useState("no");
  const [paper, setPaper] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (tid) => {
    try {
      const r = await getConsentReport(user, tid ? { typeId: tid } : {});
      setTypes(r.types ?? []);
      if (!tid) { const d = r.default_type ?? r.types?.[0]?.id; setTypeId(d); if (d) return load(d); }
      setRep(r.report);
    } catch (e) { Alert.alert(_t("Consents"), _tx(e.message)); setRep({ yes: [], no: [], unanswered: [], outdated: [] }); }
  }, [user]);
  useEffect(() => { load(null); }, [load]);

  const groups = useMemo(() => {
    const list = rep?.[show] ?? [];
    const g = {};
    list.forEach((p) => { (g[p.class || "—"] = g[p.class || "—"] || []).push(p); });
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [rep, show]);

  const savePaper = async () => {
    if (!paper.subject) { Alert.alert(_t("Paper form"), _t("Choose the student.")); return; }
    setBusy(true);
    try {
      await recordPaperConsent(user, { subject_id: paper.subject.enrollment_id, type_id: typeId, granted: paper.granted ? 1 : 0, given_by: paper.given_by, note: paper.note });
      setPaper(null); await load(typeId);
    } catch (e) { Alert.alert(_t("Paper form"), _tx(e.message)); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(typeId)} />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sx.chips}>
        {types.map((t) => (
          <TouchableOpacity key={t.id} onPress={() => { setTypeId(t.id); setRep(null); load(t.id); }} style={[sx.chip, typeId === t.id && sx.chipOn]}>
            <Text style={[sx.chipTxt, typeId === t.id && { color: C.brand }]}>{_tx(t.title)}{t.audience === "staff" ? (" " + _t("(staff)") + "") : ""}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {!rep ? <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} /> : (
        <>
          <Card>
            <View style={{ flexDirection: "row" }}>
              {[["yes", "Yes", C.ok], ["no", "No", C.err], ["unanswered", "Not answered", C.muted]].map(([k, l, c]) => (
                <TouchableOpacity key={k} style={[sx.stat, show === k && sx.statOn]} onPress={() => setShow(k)}>
                  <Text style={[sx.statN, { color: c }]}>{_tx(rep[k]?.length) ?? 0}</Text>
                  <Text style={sx.statL}>{_tx(l)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!!rep.outdated?.length && <Text style={sx.meta}>{_t("{length} answered an older wording and will be asked again.", { length: rep.outdated.length })}</Text>}
          </Card>
          {!groups.length ? <Card><Empty icon="users" text={_t("Nobody in this list.")} /></Card> : groups.map(([cls, list]) => (
            <Card key={cls} title={_tx(cls)}>
              {list.map((p) => (
                <View key={p.subject_id} style={sx.pRow}>
                  <Text style={sx.pName}>{_tx(p.name)}</Text>
                  {!!p.since && <Text style={sx.meta}>{_t("since {since}", { since: p.since })}</Text>}
                </View>
              ))}
            </Card>
          ))}
          {isAdmin && rep?.type?.audience === "parent" && (
            <Btn title={_t("Record a paper form")} kind="ghost" icon="file-text" onPress={() => setPaper({ subject: null, granted: true, given_by: "", note: "" })} />
          )}
        </>
      )}

      <Modal visible={!!paper} animationType="slide" onRequestClose={() => setPaper(null)}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: Platform.OS === "ios" ? 60 : 24, backgroundColor: C.bg, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <Text style={sx.mTitle}>{_t("Paper form · {title}", { title: rep?.type?.title })}</Text>
          <StudentSearch user={user} value={paper?.subject} onChange={(s) => setPaper({ ...paper, subject: s })} />
          <Toggle label={_t("The parent agreed")} value={!!paper?.granted} onChange={(v) => setPaper({ ...paper, granted: v })} />
          <Field label={_t("Signed by")} placeholder={_t("e.g. Mrs Sen (mother)")} value={paper?.given_by ?? ""} onChangeText={(v) => setPaper({ ...paper, given_by: v })} />
          <Field label={_t("Note (optional)")} value={paper?.note ?? ""} onChangeText={(v) => setPaper({ ...paper, note: v })} />
          <Btn title={_t("Save")} busy={busy} onPress={savePaper} />
          <Btn title={_t("Cancel")} kind="ghost" onPress={() => setPaper(null)} />
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

function Settings({ user }) {
  const [types, setTypes] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setTypes((await getConsentTypes(user)).types); } catch (e) { Alert.alert(_t("Consents"), _tx(e.message)); setTypes([]); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try { await saveConsentType(user, edit); setEdit(null); await load(); }
    catch (e) { Alert.alert(_t("Consent"), _tx(e.message)); } finally { setBusy(false); }
  };

  if (!types) return <ActivityIndicator style={{ marginTop: 30 }} color={C.brand} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {["parent", "staff"].map((aud) => (
        <Card key={aud} title={aud === "parent" ? _t("Asked to parents") : _t("Asked to staff")}>
          {types.filter((t) => t.audience === aud).map((t) => (
            <TouchableOpacity key={t.id} style={sx.pRow} onPress={() => setEdit({ ...t })}>
              <View style={{ flex: 1 }}>
                <Text style={[sx.pName, !t.active && { color: C.muted }]}>{_tx(t.title)}</Text>
                <Text style={sx.meta}>{_t("v{version}{v}{v2}", { version: t.version, v: t.required ? (" " + _t("· required") + "") : "", v2: !t.active ? (" " + _t("· not asked") + "") : "" })}</Text>
              </View>
              <Text style={sx.link}>{_t("Edit")}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      ))}
      <Btn title={_t("Add a consent")} kind="ghost" icon="plus" onPress={() => setEdit({ title: "", body: "", audience: "parent", required: false, active: true })} />
      <Text style={sx.meta}>{_t("Changing the title or text creates a new version: everyone is asked again the next time they open the app. Every answer is kept.")}</Text>

      <Modal visible={!!edit} animationType="slide" onRequestClose={() => setEdit(null)}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: Platform.OS === "ios" ? 60 : 24, backgroundColor: C.bg, flexGrow: 1 }}>
          <Text style={sx.mTitle}>{edit?.id ? _t("Edit consent") : _t("New consent")}</Text>
          {!edit?.id && (
            <View style={sx.tabs}>
              {[["parent", "Parents"], ["staff", "Staff"]].map(([k, l]) => (
                <TouchableOpacity key={k} onPress={() => setEdit({ ...edit, audience: k })} style={[sx.tab, edit?.audience === k && sx.tabOn]}>
                  <Text style={[sx.tabTxt, edit?.audience === k && { color: C.brand }]}>{_tx(l)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Field label={_t("Title")} value={edit?.title ?? ""} onChangeText={(v) => setEdit({ ...edit, title: v })} />
          <Field label={_t("What people agree to")} value={edit?.body ?? ""} onChangeText={(v) => setEdit({ ...edit, body: v })} multiline style={{ minHeight: 120, textAlignVertical: "top" }} />
          <Toggle label={_t("Required to use the app")} value={!!edit?.required} onChange={(v) => setEdit({ ...edit, required: v })} />
          <Toggle label={_t("Ask this")} value={edit?.active !== false} onChange={(v) => setEdit({ ...edit, active: v })} />
          <Btn title={_t("Save")} busy={busy} onPress={save} />
          <Btn title={_t("Cancel")} kind="ghost" onPress={() => setEdit(null)} />
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

const sx = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 6, marginBottom: 10 },
  tab: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 10, paddingVertical: 9, alignItems: "center", backgroundColor: "#fff" },
  tabOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  tabTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  chips: { flexDirection: "row", gap: 6, marginBottom: 10 },
  chip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  stat: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10 },
  statOn: { backgroundColor: C.bg },
  statN: { fontSize: 22, fontWeight: "900" },
  statL: { fontSize: 11, color: C.muted, fontWeight: "600" },
  meta: { fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 17 },
  pRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 8 },
  pName: { fontSize: 14, fontWeight: "600", color: C.ink },
  link: { color: C.brand, fontWeight: "700", fontSize: 13 },
  mTitle: { fontSize: 19, fontWeight: "800", color: C.ink, marginBottom: 10 },
});
