/**
 * Settings › Audit log (owner, or people given "Privacy & audit · view")
 * Read-only timeline of sign-ins, security changes, money, marks and personal data.
 * Tap an entry for details (what changed, from where). "Check integrity" re-verifies the hash chain.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Alert, Modal, TouchableOpacity, ActivityIndicator, ScrollView, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { getAuditLog, getAuditEntry, verifyAudit, exportAuditCsv, AUDIT_COLOR, niceWhen } from "../../services/SecurityApi";
import { C, Btn, Field, Empty } from "../../components/ReportCardUI";
import { _t, _tx } from "../../services/i18n";

const RANGES = [{ k: 7, l: "7 days" }, { k: 30, l: "30 days" }, { k: 90, l: "90 days" }, { k: 0, l: "All" }];
const CATS = [["", "All"], ["security", "Security"], ["access", "Access"], ["money", "Money"], ["records", "Records"], ["privacy", "Privacy"], ["settings", "Settings"]];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function AuditLogScreen() {
  const { user } = useContext(AuthContext);
  const [range, setRange] = useState(7);
  const [cat, setCat]     = useState("");
  const [q, setQ]         = useState("");
  const [rows, setRows]   = useState(null);
  const [page, setPage]   = useState(1);
  const [more, setMore]   = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy]   = useState(false);

  const filters = useCallback((p) => ({
    from: range ? ymd(new Date(Date.now() - range * 86400000)) : "", category: cat, q: q.trim(), page: p,
  }), [range, cat, q]);

  const load = useCallback(async (p = 1) => {
    try {
      const r = await getAuditLog(user, filters(p));
      setRows((prev) => (p === 1 ? r.entries : [...(prev ?? []), ...r.entries]));
      setPage(p); setMore(r.more); setCanExport(!!r.can_export);
    } catch (e) { Alert.alert(_t("Audit log"), _tx(e.message)); setRows([]); }
  }, [user, filters]);
  useEffect(() => { setRows(null); load(1); }, [range, cat]);   // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (id) => {
    try { setDetail(await getAuditEntry(user, id)); } catch (e) { Alert.alert(_t("Audit log"), _tx(e.message)); }
  };
  const check = async () => {
    setBusy(true);
    try {
      const v = await verifyAudit(user);
      Alert.alert(_t("Integrity check"), v.ok ? _t("All {checked} entries are intact.", { checked: v.checked }) : _t("The record was changed outside the app at entry #{broken_at}. Tell platform support.", { broken_at: v.broken_at }));
    } catch (e) { Alert.alert(_t("Integrity check"), _tx(e.message)); } finally { setBusy(false); }
  };
  const doExport = async () => {
    setBusy(true);
    try { await exportAuditCsv(user, filters(1)); } catch (e) { Alert.alert(_t("Export"), _tx(e.message)); } finally { setBusy(false); }
  };

  const header = (
    <View style={{ padding: 16, paddingBottom: 4 }}>
      <View style={sx.chips}>
        {RANGES.map((r) => (
          <TouchableOpacity key={r.k} onPress={() => setRange(r.k)} style={[sx.chip, range === r.k && sx.chipOn]}>
            <Text style={[sx.chipTxt, range === r.k && { color: C.brand }]}>{_tx(r.l)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sx.chips}>
        {CATS.map(([k, l]) => (
          <TouchableOpacity key={k} onPress={() => setCat(k)} style={[sx.chip, cat === k && sx.chipOn]}>
            {!!k && <View style={[sx.dot, { backgroundColor: AUDIT_COLOR[k] }]} />}
            <Text style={[sx.chipTxt, cat === k && { color: C.brand }]}>{_tx(l)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Field placeholder={_t("Search name, receipt, student…")} value={q} onChangeText={setQ} returnKeyType="search" onSubmitEditing={() => { setRows(null); load(1); }} />
        </View>
        <TouchableOpacity style={sx.iconBtn} onPress={() => { setRows(null); load(1); }}><Feather name="search" size={18} color={C.brand} /></TouchableOpacity>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn title={_t("Check integrity")} kind="ghost" icon="check-circle" onPress={check} busy={busy} style={{ flex: 1 }} />
        {canExport && <Btn title={_t("Export CSV")} kind="ghost" icon="download" onPress={doExport} disabled={busy} style={{ flex: 1 }} />}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        data={rows ?? []}
        keyExtractor={(e) => String(e.id)}
        ListHeaderComponent={header}
        ListEmptyComponent={rows === null ? <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} /> : <Empty icon="list" text={_t("Nothing recorded for these filters.")} />}
        onEndReached={() => more && load(page + 1)}
        onEndReachedThreshold={0.4}
        renderItem={({ item: e }) => (
          <TouchableOpacity style={sx.ev} onPress={() => open(e.id)} activeOpacity={0.7}>
            <View style={[sx.evDot, { backgroundColor: AUDIT_COLOR[e.category] ?? C.muted }]} />
            <View style={{ flex: 1 }}>
              <Text style={sx.evTitle} numberOfLines={2}>{_tx(e.summary) || _tx(e.event)}</Text>
              <Text style={sx.evMeta}>{_tx(e.actor) || "system"}{e.actor_role ? ` (${_tx(e.actor_role)})` : ""} · {niceWhen(e.created)}{e.ip ? ` · ${_tx(e.ip)}` : ""}</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#cbd5e1" />
          </TouchableOpacity>
        )}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: Platform.OS === "ios" ? 60 : 24, backgroundColor: C.bg, flexGrow: 1 }}>
          {detail && (
            <>
              <Text style={sx.dTitle}>{_tx(detail.summary) || _tx(detail.event)}</Text>
              <View style={sx.kv}>
                {[["Who", `${detail.actor || "system"}${detail.actor_role ? ` (${detail.actor_role})` : ""}`], ["When", detail.created],
                  ["Kind", `${detail.category} · ${detail.event}`], ["Record", [detail.entity_type, detail.entity_id].filter(Boolean).join(" · ") || "—"],
                  ["From", [detail.app_version ? (detail.app_version === "web" ? "Website" : `App ${detail.app_version}`) : "", detail.ip].filter(Boolean).join(" · ") || "—"],
                  ["Integrity", detail.intact ? "Intact ✓" : "Changed outside the app ✗"]].map(([k, v]) => (
                  <View key={k} style={sx.kvRow}><Text style={sx.k}>{_tx(k)}</Text><Text style={[sx.v, k === "Integrity" && { color: detail.intact ? C.ok : C.err }]}>{_tx(v)}</Text></View>
                ))}
              </View>
              {detail.changes != null && (
                <>
                  <Text style={sx.sub}>{_t("What was sent / changed")}</Text>
                  <Text selectable style={sx.json}>{JSON.stringify(detail.changes, null, 2)}</Text>
                </>
              )}
              <Btn title={_t("Close")} onPress={() => setDetail(null)} />
            </>
          )}
        </ScrollView>
      </Modal>
    </View>
  );
}

const sx = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: C.brand, backgroundColor: C.brandSoft },
  chipTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  iconBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  ev: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  evDot: { width: 9, height: 9, borderRadius: 5 },
  evTitle: { fontSize: 13.5, fontWeight: "700", color: C.ink },
  evMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  dTitle: { fontSize: 19, fontWeight: "800", color: C.ink, marginBottom: 12 },
  kv: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12 },
  kvRow: { flexDirection: "row", paddingVertical: 5, gap: 10 },
  k: { width: 80, fontSize: 12, color: C.muted, fontWeight: "700" },
  v: { flex: 1, fontSize: 13, color: C.ink },
  sub: { fontSize: 12, fontWeight: "800", color: C.brand, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  json: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11.5, color: C.ink, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 10 },
});
