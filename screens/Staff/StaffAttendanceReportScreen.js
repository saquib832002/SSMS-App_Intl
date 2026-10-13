/**
 * Staff › Staff Attendance › Monthly report
 * Per staff member: present, late, half days, paid / unpaid leave, absent, not marked
 * and payable days (= working days − absent − unpaid leave − ½ per half day).
 * Payable days are what the web Payroll screen fills in for "Days Present".
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Alert, TouchableOpacity, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { AuthContext } from "../../context/AuthContext";
import { getMonth, STATUS, thisMonth, addMonths, monthName, days } from "../../services/StaffAttendanceApi";
import { niceDate, niceTime } from "../../services/StudentLeaveApi";
import { C, Card, Btn, Empty } from "../../components/ReportCardUI";
import { _t, _th, _tx } from "../../services/i18n";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default function StaffAttendanceReportScreen() {
  const { user } = useContext(AuthContext);
  const [month, setMonth] = useState(thisMonth());
  const [data, setData]   = useState(null);
  const [open, setOpen]   = useState(null);
  const [busy, setBusy]   = useState(false);

  const load = useCallback(async () => {
    try { const d = await getMonth(user, month); setData({ ...(d ?? {}), staff: Array.isArray(d?.staff) ? d.staff : [] }); }
    catch (e) { Alert.alert(_t("Staff attendance"), _tx(e.message)); setData({ staff: [] }); }
  }, [user, month]);
  useEffect(() => { setData(null); setOpen(null); load(); }, [load]);

  const share = async () => {
    if (!data?.staff?.length) return;
    setBusy(true);
    try {
      const rows = data.staff.map((s) => `<tr>
        <td class="l">${esc(s.staff_name)}</td><td>${s.present}</td><td>${s.late}${s.late_minutes ? ` <small>(${s.late_minutes}m)</small>` : ""}</td>
        <td>${s.half_days}</td><td>${days(s.leave_paid)}</td><td>${days(s.leave_unpaid)}</td><td>${s.absent}</td>
        <td>${s.not_marked}</td><td class="b">${days(s.payable_days)}</td></tr>`).join("");
      const html = `<html><head><meta charset="utf-8"><style>
        body{font-family:Helvetica,Arial,sans-serif;color:#0f172a;padding:24px}
        h1{font-size:20px;margin:0;text-align:center} h2{font-size:14px;margin:4px 0 16px;color:#475569;font-weight:600;text-align:center}
        table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #cbd5e1;padding:6px;text-align:center}
        th{background:#ede9fe;color:#3b0764} td.l{text-align:left} td.b{font-weight:800}
        p{font-size:11px;color:#64748b;margin-top:12px}
      </style></head><body>
        <h1>${esc(user?.schoolName || "Staff Attendance")}</h1>
        <h2>Staff attendance – ${esc(monthName(month))} · ${data.working_days} working days</h2>
        <table><thead><tr><th>Staff</th><th>Present</th><th>Late</th><th>Half days</th><th>Paid leave</th>
        <th>Unpaid leave</th><th>Absent</th><th>Not marked</th><th>Payable days</th></tr></thead><tbody>${rows}</tbody></table>
        <p>Payable days = working days − absent − unpaid leave − ½ for each half day. Weekly off days and holidays are not working days.
        Days not marked are counted as worked.</p>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html: _th(html), base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: _t("Staff attendance {month}", { month: monthName(month) }), UTI: "com.adobe.pdf" });
      } else {
        Alert.alert(_t("PDF saved"), _tx(uri));
      }
    } catch (e) { Alert.alert(_t("Share"), _tx(e.message)); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Card>
        <View style={sx.monthNav}>
          <TouchableOpacity onPress={() => setMonth(addMonths(month, -1))} hitSlop={10}><Feather name="chevron-left" size={22} color={C.brand} /></TouchableOpacity>
          <Text style={sx.monthTxt}>{monthName(month)}</Text>
          <TouchableOpacity onPress={() => month < thisMonth() && setMonth(addMonths(month, 1))} hitSlop={10}>
            <Feather name="chevron-right" size={22} color={month < thisMonth() ? C.brand : "#cbd5e1"} />
          </TouchableOpacity>
        </View>
        {!!data?.working_days && (
          <Text style={sx.hint}>{_t("{working_days} working days{v} · {length} holiday(s) left out", { working_days: data.working_days, v: data.days_so_far < data.working_days ? ` ${_t("({days_so_far} so far)", { days_so_far: data.days_so_far })}` : "", length: (data.off_days ?? []).filter((d) => d.why === "holiday").length })}</Text>
        )}
        <Btn title={_t("Share PDF")} icon="share-2" kind="ghost" busy={busy} disabled={!data?.staff?.length} onPress={share} />
      </Card>

      {!data ? <ActivityIndicator color={C.brand} style={{ marginTop: 20 }} /> : !data.staff.length ? (
        <Card><Empty icon="users" text={_t("No active staff.")} /></Card>
      ) : data.staff.map((s) => (
        <Card key={s.staff_id}>
          <TouchableOpacity onPress={() => setOpen(open === s.staff_id ? null : s.staff_id)} activeOpacity={0.8}>
            <View style={sx.head}>
              <Text style={sx.name}>{_tx(s.staff_name)}</Text>
              <View style={sx.pay}><Text style={sx.payN}>{days(s.payable_days)}</Text><Text style={sx.payL}>{_t("payable")}</Text></View>
            </View>
            <View style={sx.stats}>
              <Pill label={_t("Present")} n={s.present} c={C.ok} />
              <Pill label={_t("Late")} n={s.late} c={C.warn} />
              <Pill label={_t("Half")} n={s.half_days} c="#92400e" />
              <Pill label={_t("Leave")} n={days(s.leave_paid)} c="#3730a3" />
              {s.leave_unpaid > 0 && <Pill label={_t("Unpaid")} n={days(s.leave_unpaid)} c={C.err} />}
              <Pill label={_t("Absent")} n={s.absent} c={C.err} />
              {s.not_marked > 0 && <Pill label={_t("Not marked")} n={s.not_marked} c={C.muted} />}
            </View>
          </TouchableOpacity>
          {open === s.staff_id && (
            Object.keys(s.days ?? {}).length === 0 ? <Text style={sx.hint}>{_t("No days marked this month.")}</Text> :
            Object.entries(s.days).sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, x]) => {
              const t = STATUS[x.status] ?? STATUS.P;
              return (
                <View key={d} style={sx.day}>
                  <Text style={sx.dayDate}>{niceDate(d)}</Text>
                  <Text style={sx.dayMeta}>
                    {[x.check_in && niceTime(x.check_in), x.check_out && niceTime(x.check_out)].filter(Boolean).join(" – ")}
                    {x.late_minutes > 0 ? ` ${_t("· {late_minutes} min late", { late_minutes: x.late_minutes })}` : ""}{x.leave_type ? ` · ${_tx(x.leave_type)}` : ""}
                  </Text>
                  <View style={[sx.chip, { backgroundColor: t.bg }]}><Text style={[sx.chipTxt, { color: t.fg }]}>{x.half && x.status === "L" ? _t("½L") : _tx(t.short)}</Text></View>
                </View>
              );
            })
          )}
        </Card>
      ))}
      {!!data?.staff?.length && (
        <Text style={sx.foot}>{_t("Payable days = working days − absent − unpaid leave − ½ per half day. Days not marked count as worked – mark them in Staff Attendance. Payroll (web) fills in these numbers when you process the month.")}</Text>
      )}
    </ScrollView>
  );
}

function Pill({ label, n, c }) {
  return (
    <View style={sx.pill}><Text style={[sx.pillN, { color: c }]}>{_tx(n)}</Text><Text style={sx.pillL}>{_tx(label)}</Text></View>
  );
}

const sx = StyleSheet.create({
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTxt: { fontSize: 16, fontWeight: "800", color: C.ink },
  hint: { fontSize: 12, color: C.muted, marginTop: 6, textAlign: "center" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: 15, fontWeight: "800", color: C.ink, flex: 1 },
  pay: { alignItems: "center", backgroundColor: C.brandSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  payN: { fontSize: 18, fontWeight: "900", color: C.brand },
  payL: { fontSize: 10, color: C.brand, fontWeight: "700" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  pill: { flexDirection: "row", alignItems: "center", backgroundColor: C.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, gap: 4 },
  pillN: { fontWeight: "800", fontSize: 13 },
  pillL: { fontSize: 11, color: C.muted, fontWeight: "600" },
  day: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 8, marginTop: 4 },
  dayDate: { fontSize: 13, fontWeight: "700", color: C.ink, width: 92 },
  dayMeta: { flex: 1, fontSize: 12, color: C.muted },
  chip: { minWidth: 30, alignItems: "center", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  chipTxt: { fontWeight: "800", fontSize: 12 },
  foot: { fontSize: 11, color: C.muted, textAlign: "center", marginTop: 4, paddingHorizontal: 8 },
});
