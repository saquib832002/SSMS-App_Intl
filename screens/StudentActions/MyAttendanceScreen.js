/**
 * screens/MyAttendanceScreen.js
 *
 * Student / Parent portal — shows the logged-in student's own
 * attendance for the last 30 days. Auto-loads on mount; no filters needed.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import { fetchMyAttendance } from '../../services/StudentServiceApi';

const { width: W } = Dimensions.get('window');

// ── Attendance status config ──────────────────────────────────────────────────
const STATUS = {
  P:    { bg: '#dcfce7', fg: '#15803d', border: '#86efac', label: 'P', full: 'Present' },
  A:    { bg: '#fee2e2', fg: '#dc2626', border: '#fca5a5', label: 'A', full: 'Absent'  },
  L:    { bg: '#fef9c3', fg: '#92400e', border: '#fde68a', label: 'L', full: 'Leave'   },
  H:    { bg: '#e0f2fe', fg: '#0369a1', border: '#7dd3fc', label: 'H', full: 'Holiday' },
  S:    { bg: '#f1f5f9', fg: '#94a3b8', border: '#cbd5e1', label: 'S', full: 'Sunday'  },
  null: { bg: '#f8fafc', fg: '#cbd5e1', border: '#e2e8f0', label: '·', full: 'No data' },
};

const getStatus = (att) => STATUS[att] ?? STATUS[null];

// ── Summary pill ──────────────────────────────────────────────────────────────
function SummaryPill({ label, count, color, bg }) {
  return (
    <View style={[sp.pill, { backgroundColor: bg }]}>
      <Text style={[sp.count, { color }]}>{count}</Text>
      <Text style={[sp.label, { color }]}>{label}</Text>
    </View>
  );
}
const sp = StyleSheet.create({
  pill:  { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
  count: { fontSize: 22, fontWeight: '900', lineHeight: 26 },
  label: { fontSize: 10, fontWeight: '700', marginTop: 2 },
});

// ── Day cell ──────────────────────────────────────────────────────────────────
function DayCell({ day }) {
  const st = getStatus(day.attendance);
  const isToday = day.date === new Date().toISOString().split('T')[0];
  return (
    <View style={[dc.cell, { backgroundColor: st.bg, borderColor: isToday ? '#2563eb' : st.border }]}>
      <Text style={[dc.dayName, { color: st.fg }]}>{day.dayName}</Text>
      <Text style={[dc.dateNum, { color: st.fg }]}>{day.label}</Text>
      <Text style={[dc.attLabel, { color: st.fg }]}>{st.label}</Text>
    </View>
  );
}
const dc = StyleSheet.create({
  cell:     { width: (W - 48) / 7, aspectRatio: 0.75, borderRadius: 8, borderWidth: 1.5,
              alignItems: 'center', justifyContent: 'center', margin: 2 },
  dayName:  { fontSize: 8, fontWeight: '600', marginBottom: 1 },
  dateNum:  { fontSize: 13, fontWeight: '900', lineHeight: 16 },
  attLabel: { fontSize: 11, fontWeight: '800', marginTop: 2 },
});

// ── Legend item ───────────────────────────────────────────────────────────────
function LegendItem({ code }) {
  const st = getStatus(code);
  return (
    <View style={lg.item}>
      <View style={[lg.dot, { backgroundColor: st.bg, borderColor: st.border }]} />
      <Text style={lg.txt}>{code ?? '·'} — {st.full}</Text>
    </View>
  );
}
const lg = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 12, marginBottom: 4 },
  dot:  { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
  txt:  { fontSize: 11, color: '#475569', fontWeight: '600' },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MyAttendanceScreen({ navigation }) {
  const { user, activeEnrollmentId } = useContext(AuthContext);
  // Pass child's enrollment ID when a parent is viewing a child's portal
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );

  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchMyAttendance(effectiveUser);
      setData(res);
    } catch (e) {
      setError(e.message ?? 'Failed to load attendance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [effectiveUser]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  // Build weeks (rows of 7) from flat days array
  const weeks = data
    ? data.days.reduce((acc, day, i) => {
        const wi = Math.floor(i / 7);
        if (!acc[wi]) acc[wi] = [];
        acc[wi].push(day);
        return acc;
      }, [])
    : [];

  // Compute summary with the same weekday/weekend rule as the dashboard:
  //  • Mon–Fri always count toward the total (null = absent)
  //  • Sat/Sun only count if attendance === 'P' (weekend class held)
  const allDays        = data?.days ?? [];
  const isWeekend      = (d) => d.dayName === 'Sat' || d.dayName === 'Sun';
  const weekdays       = allDays.filter(d => !isWeekend(d));
  const weekendPresent = allDays.filter(d =>  isWeekend(d) && d.attendance === 'P');
  const totalDays      = weekdays.length + weekendPresent.length;
  const presentDays    = weekdays.filter(d => d.attendance === 'P').length + weekendPresent.length;
  const absentDays     = totalDays - presentDays;
  const leaveDays      = allDays.filter(d => d.attendance === 'L').length;
  const holidayDays    = allDays.filter(d => d.attendance === 'H').length;
  const attPct         = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>My Attendance</Text>
          <Text style={s.headerSub}>
            {data ? `${data.from}  –  ${data.to}` : 'Last 30 days'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => load()} style={s.refreshBtn}>
          <Feather name="refresh-cw" size={16} color="#1e40af" />
        </TouchableOpacity>
      </View>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={s.centred}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={s.loadingTxt}>Loading your attendance…</Text>
        </View>
      ) : error ? (
        <View style={s.centred}>
          <MaterialIcons name="error-outline" size={48} color="#fca5a5" />
          <Text style={s.errorTitle}>Could not load data</Text>
          <Text style={s.errorSub}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => load()}>
            <Text style={s.retryTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
              colors={['#1e40af']} tintColor="#1e40af" />
          }
        >
          {/* ── Student ID banner ─────────────────────────────────────── */}
          <View style={s.idBanner}>
            <View style={s.idAvatar}>
              <Text style={s.idAvatarTxt}>
                {(user?.ssmsUserName ?? 'S')[0].toUpperCase()}
              </Text>
            </View>
            <View>
              <Text style={s.idName}>
                {user?.ssmsUserName ?? '—'}
              </Text>
              <Text style={s.idRole}>
                {(user?.ssmsUserRole ?? '').charAt(0).toUpperCase() +
                 (user?.ssmsUserRole ?? '').slice(1).toLowerCase()}
              </Text>
            </View>
          </View>

          {/* ── Summary pills ─────────────────────────────────────────── */}
          <View style={s.summaryRow}>
            <SummaryPill label="Present" count={presentDays}  color="#15803d" bg="#dcfce7" />
            <SummaryPill label="Absent"  count={absentDays}   color="#dc2626" bg="#fee2e2" />
            <SummaryPill label="Leave"   count={leaveDays}    color="#92400e" bg="#fef9c3" />
            <SummaryPill label="Holiday" count={holidayDays}  color="#0369a1" bg="#e0f2fe" />
          </View>

          {/* ── Attendance % bar ──────────────────────────────────────── */}
          {totalDays > 0 && (() => {
            const color = attPct >= 75 ? '#15803d' : attPct >= 50 ? '#b45309' : '#dc2626';
            const bg    = attPct >= 75 ? '#dcfce7' : attPct >= 50 ? '#fef9c3' : '#fee2e2';
            return (
              <View style={s.pctCard}>
                <View style={s.pctRow}>
                  <Text style={s.pctLabel}>Attendance Rate</Text>
                  <Text style={[s.pctValue, { color }]}>{attPct}%</Text>
                </View>
                <View style={s.pctTrack}>
                  <View style={[s.pctFill, { width: `${attPct}%`, backgroundColor: color }]} />
                </View>
                <Text style={[s.pctNote, { color }]}>
                  {attPct >= 75 ? 'Good attendance — keep it up!' :
                   attPct >= 50 ? 'Average — try to attend more classes.' :
                                  'Low attendance — please improve.'}
                </Text>
              </View>
            );
          })()}

          {/* ── Calendar grid ─────────────────────────────────────────── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Daily Record</Text>
            <View style={s.grid}>
              {weeks.map((week, wi) => (
                <View key={wi} style={s.weekRow}>
                  {week.map((day) => (
                    <DayCell key={day.date} day={day} />
                  ))}
                  {/* Pad last row if it has fewer than 7 days */}
                  {week.length < 7 &&
                    Array.from({ length: 7 - week.length }).map((_, pi) => (
                      <View key={`pad-${pi}`} style={dc.cell} />
                    ))
                  }
                </View>
              ))}
            </View>
          </View>

          {/* ── Legend ────────────────────────────────────────────────── */}
          <View style={s.legendCard}>
            <Text style={s.cardTitle}>Legend</Text>
            <View style={s.legendRow}>
              <LegendItem code="P" />
              <LegendItem code="A" />
              <LegendItem code="L" />
              <LegendItem code="H" />
              <LegendItem code={null} />
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
    shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  backBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  headerSub:   { fontSize: 11, color: '#64748b', marginTop: 1 },

  scroll: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 20 },

  // Loading / error
  centred:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingTxt: { marginTop: 14, color: '#64748b', fontSize: 14 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 },
  errorSub:   { fontSize: 13, color: '#94a3b8', marginTop: 6, textAlign: 'center' },
  retryBtn:   { marginTop: 18, backgroundColor: '#1e40af', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt:   { color: '#fff', fontWeight: '700', fontSize: 14 },

  // ID banner
  idBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1e40af', borderRadius: 14, padding: 14, marginBottom: 12 },
  idAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  idAvatarTxt: { fontSize: 18, fontWeight: '900', color: '#fff' },
  idName: { fontSize: 15, fontWeight: '800', color: '#fff' },
  idRole: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  // Summary
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },

  // Percentage card
  pctCard:  { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  pctRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  pctLabel: { fontSize: 13, fontWeight: '700', color: '#374151' },
  pctValue: { fontSize: 20, fontWeight: '900' },
  pctTrack: { height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  pctFill:  { height: '100%', borderRadius: 4 },
  pctNote:  { fontSize: 11, fontWeight: '600' },

  // Cards
  card:      { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#374151', marginBottom: 10 },
  grid:      { gap: 2 },
  weekRow:   { flexDirection: 'row' },

  // Legend
  legendCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  legendRow:  { flexDirection: 'row', flexWrap: 'wrap' },
});
