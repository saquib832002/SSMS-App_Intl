/**
 * screens/Exams/TestLeaderboardScreen.js
 * Ranked leaderboard for a test — top 3 get medals,
 * current student's row is highlighted in blue.
 */
import React, { useState, useContext, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { AuthContext } from "../../context/AuthContext";
import { getLeaderboard } from "../../services/TestSeriesServiceApi";
import { fetchInstituteDetails } from "../../services/UserServiceApi";
import { BASE_URL } from "../../Environment/EnvironmentConfig";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (seconds == null) return "—";
  const s = Number(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const MEDAL_CONFIG = {
  1: { emoji: "🥇", bg: "#fffbeb", border: "#fde68a", leftBar: "#f59e0b", nameFg: "#92400e" },
  2: { emoji: "🥈", bg: "#f8fafc", border: "#cbd5e1", leftBar: "#94a3b8", nameFg: "#334155" },
  3: { emoji: "🥉", bg: "#fff7ed", border: "#fed7aa", leftBar: "#f97316", nameFg: "#7c2d12" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function PodiumCard({ entry, position }) {
  const cfg = MEDAL_CONFIG[position];
  return (
    <View style={[s.podiumCard, { backgroundColor: cfg.bg, borderColor: cfg.border, borderLeftColor: cfg.leftBar }]}>
      <Text style={s.podiumEmoji}>{cfg.emoji}</Text>
      <View style={s.podiumInfo}>
        <Text style={[s.podiumName, { color: cfg.nameFg }]} numberOfLines={1}>
          {entry.student_name}
        </Text>
        <View style={s.podiumMetaRow}>
          <Text style={s.podiumMeta}>
            {entry.correct_count ?? 0}✓{"  "}
            {entry.wrong_count ?? 0}✗{"  "}
            {entry.unattempted_count ?? 0}–
          </Text>
          {entry.time_spent_seconds != null && (
            <Text style={s.podiumMeta}>{formatTime(entry.time_spent_seconds)}</Text>
          )}
        </View>
      </View>
      <View style={s.podiumScoreBox}>
        <Text style={[s.podiumScore, { color: cfg.nameFg }]}>{entry.obtained_marks ?? 0}</Text>
        <Text style={s.podiumScoreMax}>/{entry.total_marks ?? "—"}</Text>
      </View>
    </View>
  );
}

function LeaderRow({ entry, isCurrentUser }) {
  const cfg = MEDAL_CONFIG[entry.rank];
  return (
    <View
      style={[
        s.leaderRow,
        cfg && { backgroundColor: cfg.bg, borderColor: cfg.border, borderLeftColor: cfg.leftBar },
        isCurrentUser && s.leaderRowMe,
      ]}
    >
      {/* Rank */}
      <View style={s.rankCell}>
        {cfg ? (
          <Text style={s.rankEmoji}>{cfg.emoji}</Text>
        ) : (
          <Text style={[s.rankNum, isCurrentUser && { color: "#2563eb" }]}>
            #{entry.rank}
          </Text>
        )}
      </View>

      {/* Name + meta */}
      <View style={s.nameCell}>
        <View style={s.nameRow}>
          <Text
            style={[s.entryName, isCurrentUser && { color: "#2563eb", fontWeight: "800" }]}
            numberOfLines={1}
          >
            {entry.student_name}
          </Text>
          {isCurrentUser && (
            <View style={s.meChip}>
              <Text style={s.meChipTxt}>You</Text>
            </View>
          )}
        </View>
        {entry.roll_number ? (
          <Text style={s.entryRoll}>Roll #{entry.roll_number}</Text>
        ) : null}
      </View>

      {/* Score */}
      <View style={s.scoreCell}>
        <Text style={[s.entryScore, isCurrentUser && { color: "#2563eb" }]}>
          {entry.obtained_marks ?? 0}
        </Text>
        <Text style={s.entryScoreMax}>/{entry.total_marks ?? "—"}</Text>
      </View>

      {/* Correct / Wrong / Skipped */}
      <View style={s.cwCell}>
        <Text style={s.entryCorrect}>{entry.correct_count ?? 0}✓</Text>
        <Text style={s.entryWrong}>{entry.wrong_count ?? 0}✗</Text>
        <Text style={s.entrySkipped}>{entry.unattempted_count ?? 0}–</Text>
      </View>

      {/* Time */}
      <View style={s.timeCell}>
        <Text style={s.entryTime}>{formatTime(entry.time_spent_seconds)}</Text>
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function TestLeaderboardScreen({ route, navigation }) {
  // Support both { testId, testTitle } and { test } navigation shapes
  const params = route.params ?? {};
  const testId    = params.testId    ?? params.test?.test_id ?? params.test?.id;
  const testTitle = params.testTitle ?? params.test?.title;
  const testDate  = params.testDate  ?? params.test?.scheduled_start ?? null;
  const { user } = useContext(AuthContext);

  const [loading,   setLoading]   = useState(true);
  const [entries,   setEntries]   = useState([]);
  const [myRank,    setMyRank]    = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!testId) return;
    try {
      setLoading(true);
      const res = await getLeaderboard(user, testId);
      const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setEntries(list);
      // Try to find current user's rank
      const me = list.find(
        (e) =>
          String(e.enrollment_id) === String(user?.enrollmentId) ||
          String(e.student_name).toLowerCase() === String(user?.name ?? "").toLowerCase()
      );
      if (me) setMyRank(me.rank);
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, [user, testId]);

  useEffect(() => {
    load();
  }, [load]);

  const isCurrentUser = (entry) =>
    String(entry.enrollment_id) === String(user?.enrollmentId);

  // ── PDF Export ───────────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (entries.length === 0) {
      Alert.alert("Nothing to export", "The leaderboard is empty.");
      return;
    }
    try {
      setExporting(true);

      // 1. Fetch school info
      let institute = {};
      try {
        const res = await fetchInstituteDetails(user);
        institute = res?.data ?? res ?? {};
      } catch (_) {}

      // 2. Try to get logo as base64 (download to cache first — expo-print cannot load remote images directly)
      let logoHtml = "";
      if (institute.logo_name) {
        // Extract just the origin (https://domain.com) — strip any subfolder like /ssms5/
        const serverOrigin = BASE_URL.match(/^https?:\/\/[^/]+/)?.[0] ?? "";
        const logoUrl = `${serverOrigin}/clients/${user?.ssmsClientCode ?? ""}/${institute.logo_name}`;
        try {
          const ext  = (institute.logo_name.split(".").pop() || "jpg").toLowerCase();
          const mime = ext === "png" ? "image/png" : "image/jpeg";
          const tmp  = FileSystem.cacheDirectory + "lb_school_logo." + ext;
          await FileSystem.downloadAsync(logoUrl, tmp);
          const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
          logoHtml = `<img src="data:${mime};base64,${b64}" class="logo" alt="logo" />`;
        } catch (logoErr) {
          console.warn("[LeaderboardPDF] logo fetch failed:", logoErr?.message);
        }
      }

      // 3. Build address line
      const addrParts = [
        institute.ssms_client_address,
        institute.ssms_client_city,
        institute.ssms_client_state,
      ].filter(Boolean);
      const addressLine = addrParts.join(", ");

      // 4. Table rows
      const medalMap = { 1: "🥇", 2: "🥈", 3: "🥉" };
      const allEntries = [...entries].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      const totalStudents = allEntries.length;
      const maxMarks = allEntries[0]?.total_marks ?? "—";
      // Parse MySQL "YYYY-MM-DD HH:MM:SS" safely (replace space with T so all JS engines accept it)
      const fmtDate = (raw) => {
        if (!raw) return null;
        const d = new Date(String(raw).replace(" ", "T"));
        if (isNaN(d.getTime())) return String(raw);
        const day  = String(d.getDate()).padStart(2, "0");
        const mon  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
        const yr   = d.getFullYear();
        const hh   = String(d.getHours()).padStart(2, "0");
        const mm   = String(d.getMinutes()).padStart(2, "0");
        return `${day} ${mon} ${yr}, ${hh}:${mm}`;
      };
      const testDateFmt   = fmtDate(testDate) ?? "Not specified";
      const generatedDate = fmtDate(new Date().toISOString());

      const rows = allEntries.map((e, i) => {
        const isMe = String(e.enrollment_id) === String(user?.enrollmentId);
        const rankCell = medalMap[e.rank]
          ? `<span class="medal">${medalMap[e.rank]}</span> ${e.rank}`
          : `#${e.rank}`;
        return `
          <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}${isMe ? " row-me" : ""}">
            <td class="td-center rank-cell">${rankCell}</td>
            <td class="td-center">${e.roll_number ?? "—"}</td>
            <td class="td-left name-cell">${e.student_name ?? "—"}</td>
            <td class="td-center correct">${e.correct_count ?? 0}</td>
            <td class="td-center wrong">${e.wrong_count ?? 0}</td>
            <td class="td-center skipped">${e.unattempted_count ?? 0}</td>
            <td class="td-center score">${e.obtained_marks ?? 0}<span class="score-max">/${e.total_marks ?? "—"}</span></td>
          </tr>`;
      }).join("");

      // 5. HTML document
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #0f172a; }

  /* ── Header ── */
  .header {
    padding: 18px 28px 14px;
    border-bottom: 3px solid #2563eb;
    background: linear-gradient(135deg, #eff6ff 0%, #fff 60%);
  }
  .header-inner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .logo { width: 68px; height: 68px; object-fit: contain; border-radius: 8px; border: 1px solid #e2e8f0; }
  .school-info { text-align: left; }
  .school-name { font-size: 18px; font-weight: 900; color: #1e3a8a; line-height: 1.2; }
  .school-addr { font-size: 11px; color: #475569; margin-top: 3px; }

  /* ── Sub-header ── */
  .subheader {
    padding: 12px 28px;
    background: #1e3a8a;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .test-title { font-size: 13px; font-weight: 700; color: #fff; flex: 1; }
  .subheader-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .generated { font-size: 10px; color: #93c5fd; white-space: nowrap; }

  /* ── Summary bar ── */
  .summary {
    display: flex;
    gap: 0;
    padding: 10px 28px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }
  .stat { flex: 1; text-align: center; }
  .stat-val { font-size: 18px; font-weight: 900; color: #2563eb; }
  .stat-lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .stat + .stat { border-left: 1px solid #e2e8f0; }

  /* ── Table ── */
  .table-wrap { padding: 16px 28px 28px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead tr { background: #1e3a8a; }
  th {
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 9px 8px;
  }
  td { padding: 8px 8px; vertical-align: middle; }
  .td-center { text-align: center; }
  .td-left { text-align: left; }
  .row-even { background: #fff; }
  .row-odd  { background: #f8fafc; }
  .row-me   { background: #eff6ff !important; font-weight: 700; }
  .rank-cell { font-weight: 800; font-size: 12px; color: #0f172a; }
  .medal { font-size: 16px; }
  .name-cell { font-weight: 600; color: #0f172a; max-width: 160px; }
  .correct  { color: #16a34a; font-weight: 700; }
  .wrong    { color: #dc2626; font-weight: 700; }
  .skipped  { color: #64748b; font-weight: 600; }
  .score    { font-size: 13px; font-weight: 900; color: #2563eb; }
  .score-max { font-size: 9px; color: #94a3b8; font-weight: 400; }
  tbody tr:last-child td { border-bottom: 2px solid #2563eb; }

  /* ── Footer ── */
  .footer {
    text-align: center;
    padding: 10px 28px;
    font-size: 9px;
    color: #94a3b8;
    border-top: 1px solid #e2e8f0;
  }
</style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="header-inner">
      ${logoHtml}
      <div class="school-info">
        <div class="school-name">${institute.ssms_client_name ?? "School"}</div>
        ${addressLine ? `<div class="school-addr">${addressLine}</div>` : ""}
      </div>
    </div>
  </div>

  <!-- Sub-header -->
  <div class="subheader">
    <div class="test-title">${testTitle ?? "Test"} &mdash; Leaderboard</div>
    <div class="subheader-right">
      <div class="generated">Test Date: ${testDateFmt}</div>
      <div class="generated">Generated: ${generatedDate}</div>
    </div>
  </div>

  <!-- Summary -->
  <div class="summary">
    <div class="stat">
      <div class="stat-val">${totalStudents}</div>
      <div class="stat-lbl">Students</div>
    </div>
    <div class="stat">
      <div class="stat-val">${maxMarks}</div>
      <div class="stat-lbl">Total Marks</div>
    </div>
    <div class="stat">
      <div class="stat-val">${allEntries[0]?.obtained_marks ?? "—"}</div>
      <div class="stat-lbl">Highest Score</div>
    </div>
    <div class="stat">
      <div class="stat-val">${allEntries[0]?.student_name?.split(" ")[0] ?? "—"}</div>
      <div class="stat-lbl">Top Scorer</div>
    </div>
  </div>

  <!-- Table -->
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:52px">Rank</th>
          <th style="width:70px">Roll No.</th>
          <th style="text-align:left">Student Name</th>
          <th style="width:52px">Correct</th>
          <th style="width:52px">Wrong</th>
          <th style="width:52px">Skipped</th>
          <th style="width:70px">Score</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="footer">This report is system-generated · ${institute.ssms_client_name ?? ""} · ${generatedDate}</div>
</body>
</html>`;

      // 6. Generate PDF
      const { uri } = await Print.printToFileAsync({ html, base64: false });

      // 7. Share
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: `Leaderboard — ${testTitle ?? "Test"}`,
          UTI: "com.adobe.pdf",
        });
      } else {
        Alert.alert("Saved", `PDF saved to: ${uri}`);
      }
    } catch (e) {
      Alert.alert("Export failed", e.message || "Could not generate PDF.");
    } finally {
      setExporting(false);
    }
  };

  const isAdmin = ["admin", "owner", "super"].includes(
    (user?.ssmsUserRole ?? "").toLowerCase().trim()
  );

  const top3  = entries.filter((e) => e.rank <= 3).sort((a, b) => a.rank - b.rank);
  const rest  = entries.filter((e) => e.rank > 3);

  const renderItem = useCallback(
    ({ item }) => (
      <LeaderRow entry={item} isCurrentUser={isCurrentUser(item)} />
    ),
    [user]
  );

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      {/* Nav bar */}
      <View style={s.navBar}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={s.navTitle} numberOfLines={1}>
          Leaderboard
        </Text>
        {isAdmin ? (
          <TouchableOpacity
            style={s.exportBtn}
            onPress={handleExportPdf}
            disabled={exporting || loading || entries.length === 0}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#2563eb" />
            ) : (
              <Feather name="download" size={18} color={entries.length === 0 ? "#cbd5e1" : "#2563eb"} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      {/* Test title strip */}
      {testTitle && (
        <View style={s.titleStrip}>
          <Feather name="award" size={14} color="#2563eb" />
          <Text style={s.titleStripTxt} numberOfLines={1}>
            {testTitle}
          </Text>
          {myRank != null && (
            <View style={s.myRankBadge}>
              <Text style={s.myRankTxt}>Your rank: #{myRank}</Text>
            </View>
          )}
        </View>
      )}

      {loading ? (
        <View style={s.loadWrap}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={s.loadTxt}>Loading leaderboard…</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={s.loadWrap}>
          <Feather name="award" size={44} color="#cbd5e1" />
          <Text style={s.emptyTxt}>No results yet</Text>
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item, i) => String(item.enrollment_id ?? item.rank ?? i)}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* Podium — top 3 */}
              {top3.length > 0 && (
                <View style={s.podiumSection}>
                  <Text style={s.podiumLabel}>Top Performers</Text>
                  {top3.map((e) => (
                    <PodiumCard key={String(e.rank)} entry={e} position={e.rank} />
                  ))}
                </View>
              )}

              {/* Table header */}
              {rest.length > 0 && (
                <View style={s.tableHeader}>
                  <Text style={[s.thTxt, { width: 42 }]}>Rank</Text>
                  <Text style={[s.thTxt, { flex: 1 }]}>Student</Text>
                  <Text style={[s.thTxt, { width: 60, textAlign: "center" }]}>Score</Text>
                  <Text style={[s.thTxt, { width: 60, textAlign: "center" }]}>C / W / S</Text>
                  <Text style={[s.thTxt, { width: 52, textAlign: "center" }]}>Time</Text>
                </View>
              )}
            </>
          }
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },

  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  exportBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
    marginHorizontal: 8,
  },

  titleStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: "#eff6ff",
    borderBottomWidth: 1,
    borderBottomColor: "#bfdbfe",
  },
  titleStripTxt: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#1e3a8a",
  },
  myRankBadge: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  myRankTxt: { fontSize: 11, fontWeight: "800", color: "#fff" },

  loadWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadTxt: { color: "#64748b", fontSize: 14 },
  emptyTxt: { fontSize: 15, fontWeight: "700", color: "#94a3b8", marginTop: 8 },

  listContent: { paddingBottom: 40 },

  // Podium
  podiumSection: {
    backgroundColor: "#fff",
    margin: 14,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: 8,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  podiumLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  podiumCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    gap: 10,
  },
  podiumEmoji: { fontSize: 28, width: 36, textAlign: "center" },
  podiumInfo: { flex: 1 },
  podiumName: { fontSize: 14, fontWeight: "800" },
  podiumMetaRow: { flexDirection: "row", gap: 10, marginTop: 3 },
  podiumMeta: { fontSize: 11, color: "#64748b" },
  podiumScoreBox: { alignItems: "flex-end" },
  podiumScore: { fontSize: 20, fontWeight: "900" },
  podiumScoreMax: { fontSize: 10, color: "#94a3b8" },

  // Table header
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
  },
  thTxt: { fontSize: 10, fontWeight: "700", color: "#64748b", textTransform: "uppercase" },

  // Leader row
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: "#fff",
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  leaderRowMe: {
    backgroundColor: "#eff6ff",
    borderLeftColor: "#2563eb",
  },

  // Rank cell
  rankCell: { width: 42, alignItems: "center" },
  rankEmoji: { fontSize: 20 },
  rankNum: { fontSize: 13, fontWeight: "800", color: "#94a3b8" },

  // Name cell
  nameCell: { flex: 1, minWidth: 0, paddingRight: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  entryName: { fontSize: 13, fontWeight: "600", color: "#0f172a", flexShrink: 1 },
  entryRoll: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  meChip: {
    backgroundColor: "#dbeafe",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  meChipTxt: { fontSize: 9, fontWeight: "800", color: "#2563eb" },

  // Score cell
  scoreCell: { width: 60, alignItems: "center" },
  entryScore: { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  entryScoreMax: { fontSize: 9, color: "#94a3b8" },

  // C/W/S cell
  cwCell: { width: 60, alignItems: "center" },
  entryCorrect: { fontSize: 11, fontWeight: "700", color: "#16a34a" },
  entryWrong:   { fontSize: 11, fontWeight: "700", color: "#dc2626" },
  entrySkipped: { fontSize: 11, fontWeight: "600", color: "#64748b" },

  // Time cell
  timeCell: { width: 52, alignItems: "center" },
  entryTime: { fontSize: 11, color: "#64748b", fontWeight: "600" },
});
