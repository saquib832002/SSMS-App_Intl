/**
 * screens/Exams/MyMarksheetScreen.js
 *
 * Student / Parent portal — shows all exams the logged-in student has
 * marks for. Each exam card is expandable to reveal subject-wise marks,
 * percentages, and grades. Auto-loads on mount; pull-to-refresh supported.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import { fetchMyMarksheets } from '../../services/ExamServiceApi';

// ── Grade colour map ──────────────────────────────────────────────────────────
const GRADE_COLOR = {
  'A+': { bg: '#dcfce7', fg: '#15803d' },
  'A':  { bg: '#d1fae5', fg: '#059669' },
  'B+': { bg: '#dbeafe', fg: '#1d4ed8' },
  'B':  { bg: '#eff6ff', fg: '#2563eb' },
  'C':  { bg: '#fef9c3', fg: '#92400e' },
  'D':  { bg: '#fed7aa', fg: '#c2410c' },
  'F':  { bg: '#fee2e2', fg: '#dc2626' },
};
const gradeStyle = (g) => GRADE_COLOR[g] ?? { bg: '#f1f5f9', fg: '#475569' };

// ── Grade badge ───────────────────────────────────────────────────────────────
function GradeBadge({ grade, size = 'sm' }) {
  const c = gradeStyle(grade);
  return (
    <View style={[gb.wrap, { backgroundColor: c.bg }, size === 'lg' && gb.wrapLg]}>
      <Text style={[gb.txt, { color: c.fg }, size === 'lg' && gb.txtLg]}>{grade}</Text>
    </View>
  );
}
const gb = StyleSheet.create({
  wrap:   { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignItems: 'center', justifyContent: 'center' },
  wrapLg: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  txt:    { fontSize: 11, fontWeight: '900' },
  txtLg:  { fontSize: 16, fontWeight: '900' },
});

// ── Progress bar ──────────────────────────────────────────────────────────────
function PctBar({ pct }) {
  const color = pct >= 75 ? '#15803d' : pct >= 50 ? '#d97706' : '#dc2626';
  return (
    <View style={pb.track}>
      <View style={[pb.fill, { width: `${Math.min(pct, 100)}%`, backgroundColor: color }]} />
    </View>
  );
}
const pb = StyleSheet.create({
  track: { height: 5, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  fill:  { height: '100%', borderRadius: 3 },
});

// ── Subject row ───────────────────────────────────────────────────────────────
function SubjectRow({ subject, idx }) {
  const pct   = parseFloat(subject.percentage ?? 0);
  const color = pct >= 75 ? '#15803d' : pct >= 50 ? '#d97706' : '#dc2626';
  const hasBreakdown = subject.theory_marks != null || subject.internal_marks != null || subject.practical_marks != null;

  return (
    <View style={[sr.row, idx % 2 === 1 && sr.rowAlt]}>
      <View style={{ flex: 1 }}>
        <Text style={sr.name}>{subject.subject_name}</Text>
        {subject.subject_code ? <Text style={sr.code}>{subject.subject_code}</Text> : null}
        {hasBreakdown && (
          <View style={sr.breakdown}>
            {subject.theory_marks    != null && <Text style={sr.bk}>T: {subject.theory_marks}/{subject.theory_max_marks ?? '—'}</Text>}
            {subject.internal_marks  != null && <Text style={sr.bk}>I: {subject.internal_marks}/{subject.internal_max_marks ?? '—'}</Text>}
            {subject.practical_marks != null && <Text style={sr.bk}>P: {subject.practical_marks}/{subject.practical_max_marks ?? '—'}</Text>}
          </View>
        )}
      </View>
      <View style={sr.right}>
        <Text style={[sr.marks, { color }]}>
          {subject.total_marks}/{subject.subject_max_marks}
        </Text>
        <Text style={[sr.pct, { color }]}>{pct.toFixed(1)}%</Text>
        <GradeBadge grade={subject.grade} />
      </View>
    </View>
  );
}
const sr = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowAlt:    { backgroundColor: '#fafafa' },
  name:      { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  code:      { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  breakdown: { flexDirection: 'row', gap: 8, marginTop: 3 },
  bk:        { fontSize: 10, color: '#64748b', fontWeight: '500' },
  right:     { alignItems: 'flex-end', gap: 3, minWidth: 70 },
  marks:     { fontSize: 13, fontWeight: '800' },
  pct:       { fontSize: 10, fontWeight: '600' },
});

// ── Exam card ─────────────────────────────────────────────────────────────────
function ExamCard({ exam }) {
  const [expanded, setExpanded] = useState(false);
  const pct   = parseFloat(exam.percentage ?? 0);
  const color = pct >= 75 ? '#15803d' : pct >= 50 ? '#d97706' : '#dc2626';
  const bg    = pct >= 75 ? '#f0fdf4' : pct >= 50 ? '#fffbeb' : '#fff5f5';

  return (
    <View style={ec.card}>
      {/* Header row */}
      <TouchableOpacity style={[ec.header, { backgroundColor: bg }]} onPress={() => setExpanded(e => !e)} activeOpacity={0.8}>
        <View style={[ec.iconWrap, { backgroundColor: color + '22' }]}>
          <Feather name="award" size={16} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ec.examName}>{exam.exam_name}</Text>
          <View style={ec.summaryRow}>
            <Text style={[ec.summaryPct, { color }]}>{pct.toFixed(1)}%</Text>
            <Text style={ec.summarySlash}> · </Text>
            <Text style={ec.summaryMarks}>{exam.total_obtained}/{exam.total_max} marks</Text>
            <Text style={ec.summarySlash}> · </Text>
            <Text style={ec.summarySubjects}>{exam.marks?.length ?? 0} subjects</Text>
          </View>
          {exam.rank != null && (
            <Text style={ec.rankLine}>
              🏅 Rank {exam.rank}{exam.total_students ? ` of ${exam.total_students}` : ''}
            </Text>
          )}
          <PctBar pct={pct} />
        </View>
        <GradeBadge grade={exam.grade} size="lg" />
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" style={{ marginLeft: 8 }} />
      </TouchableOpacity>

      {/* Subjects */}
      {expanded && (
        <View>
          <View style={ec.tableHead}>
            <Text style={[ec.th, { flex: 1 }]}>Subject</Text>
            <Text style={ec.th}>Marks · % · Grade</Text>
          </View>
          {(exam.marks ?? []).map((s, i) => <SubjectRow key={s.subject_id} subject={s} idx={i} />)}
          {(exam.marks ?? []).length === 0 && (
            <View style={ec.empty}>
              <Text style={ec.emptyTxt}>No subject marks recorded.</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
const ec = StyleSheet.create({
  card:       { backgroundColor: '#fff', borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  header:     { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  iconWrap:   { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  examName:   { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryPct: { fontSize: 12, fontWeight: '800' },
  summarySlash:    { fontSize: 11, color: '#cbd5e1' },
  summaryMarks:    { fontSize: 11, color: '#64748b', fontWeight: '600' },
  summarySubjects: { fontSize: 11, color: '#94a3b8' },
  rankLine:        { fontSize: 11, color: '#6b21a8', fontWeight: '700', marginTop: 3 },
  tableHead:  { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f8fafc', paddingHorizontal: 12, paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  th:         { fontSize: 10, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 },
  empty:      { padding: 20, alignItems: 'center' },
  emptyTxt:   { fontSize: 13, color: '#94a3b8' },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MyMarksheetScreen({ navigation }) {
  const { user, activeEnrollmentId } = useContext(AuthContext);
  // For parents viewing a child's portal, inject the child's enrollment ID
  // so the ssmsEnrollmentId header in buildHeaders carries the right ID.
  // useMemo prevents infinite re-render: inline object = new ref every render
  // → useCallback rebuilds → useEffect re-fires → fetch → setState → repeat.
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );

  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchMyMarksheets(effectiveUser);
      setData(res);
    } catch (e) {
      setError(e.message ?? 'Failed to load marksheets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [effectiveUser, user]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(true); }, [load]);

  const student = data?.student ?? null;
  const exams   = data?.exams   ?? [];

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#6b21a8" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>My Marksheet</Text>
          <Text style={s.headerSub}>Exam results & subject marks</Text>
        </View>
        <TouchableOpacity onPress={() => load()} style={s.refreshBtn}>
          <Feather name="refresh-cw" size={16} color="#6b21a8" />
        </TouchableOpacity>
      </View>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={s.centred}>
          <ActivityIndicator size="large" color="#6b21a8" />
          <Text style={s.loadingTxt}>Loading your results…</Text>
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
              colors={['#6b21a8']} tintColor="#6b21a8" />
          }
        >
          {/* ── Student banner ────────────────────────────────────────── */}
          {student && (
            <View style={s.studentBanner}>
              <View style={s.avatarWrap}>
                <Text style={s.avatarTxt}>
                  {(student.student_first_name ?? student.enrollment_id ?? 'S')[0].toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.studentName}>{student.student_name}</Text>
                <Text style={s.studentMeta}>
                  {[student.class_name, student.section_name].filter(Boolean).join(' · ')}
                  {student.roll_number ? `  ·  Roll: ${student.roll_number}` : ''}
                </Text>
                <Text style={s.studentMeta}>
                  {student.session_name}
                  {student.enrollment_id ? `  ·  ID: ${student.enrollment_id}` : ''}
                </Text>
              </View>
            </View>
          )}

          {/* ── Exam count summary ────────────────────────────────────── */}
          {exams.length > 0 && (
            <View style={s.countRow}>
              <MaterialIcons name="school" size={14} color="#6b21a8" />
              <Text style={s.countTxt}>{exams.length} exam{exams.length !== 1 ? 's' : ''} · tap a card to see subject details</Text>
            </View>
          )}

          {/* ── Exam cards ────────────────────────────────────────────── */}
          {exams.length === 0 ? (
            <View style={s.emptyState}>
              <MaterialIcons name="assignment" size={52} color="#e2e8f0" />
              <Text style={s.emptyTitle}>No results yet</Text>
              <Text style={s.emptyDesc}>Your exam marks will appear here once they are entered by your school.</Text>
            </View>
          ) : (
            exams.map(exam => <ExamCard key={exam.exam_id} exam={exam} />)
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
    shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  backBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: '#faf5ff', alignItems: 'center', justifyContent: 'center' },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#faf5ff', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  headerSub:   { fontSize: 11, color: '#64748b', marginTop: 1 },

  scroll: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 20 },

  centred:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingTxt: { marginTop: 14, color: '#64748b', fontSize: 14 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 },
  errorSub:   { fontSize: 13, color: '#94a3b8', marginTop: 6, textAlign: 'center' },
  retryBtn:   { marginTop: 18, backgroundColor: '#6b21a8', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt:   { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Student banner
  studentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#6b21a8', borderRadius: 14, padding: 14, marginBottom: 12,
  },
  avatarWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt:  { fontSize: 20, fontWeight: '900', color: '#fff' },
  studentName: { fontSize: 15, fontWeight: '800', color: '#fff', marginBottom: 2 },
  studentMeta: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 },

  // Exam count hint
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  countTxt: { fontSize: 12, color: '#6b21a8', fontWeight: '600' },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#374151' },
  emptyDesc:  { fontSize: 13, color: '#94a3b8', textAlign: 'center', lineHeight: 19, paddingHorizontal: 16 },
});
