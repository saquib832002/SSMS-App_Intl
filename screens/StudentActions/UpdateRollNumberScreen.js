/**
 * UpdateRollNumberScreen.js
 *
 * Assign / edit roll numbers for enrolled students in a given class-section.
 *  • Filter card is part of the scrollable list — scrolls away when keyboard opens
 *  • Editable roll-number input per student (amber highlight when dirty)
 *  • Save button per row + Save All for bulk
 */
import React, {
  useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Modal, SafeAreaView,
  StatusBar, ScrollView, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import {
  fetchBranches, fetchSessions, fetchClasses, fetchSections,
  getEnrolledStudents, updateRollNumber, updateRollNumbers,
} from '../../services/StudentServiceApi';

// ─── Colours ─────────────────────────────────────────────────────────────────
const C = {
  navy:   '#0b1f4b',
  indigo: '#4f46e5',
  green:  '#10b981',
  amber:  '#f59e0b',
  red:    '#ef4444',
  slate:  '#64748b',
  border: '#e2e8f0',
  bg:     '#f8faff',
  white:  '#ffffff',
  muted:  '#94a3b8',
};

// ─── Dropdown ─────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, loading: busy }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[dd.trigger, disabled && dd.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[dd.label, !selected?.value && dd.placeholder]} numberOfLines={1}>
          {busy ? 'Loading…' : (selected?.label ?? label)}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={12} color={C.indigo} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={dd.sheet}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <ScrollView>
              {options.map(o => (
                <TouchableOpacity
                  key={o.value}
                  style={[dd.option, String(o.value) === String(value) && dd.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[dd.optionTxt, String(o.value) === String(value) && dd.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && (
                    <Feather name="check" size={13} color={C.indigo} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const dd = StyleSheet.create({
  trigger:        { flexDirection:'row', alignItems:'center', justifyContent:'space-between', borderWidth:1.5, borderColor:C.border, borderRadius:10, paddingHorizontal:10, paddingVertical:7, backgroundColor:C.white },
  disabled:       { opacity:0.45 },
  label:          { fontSize:12, color:C.navy, flex:1, marginRight:4 },
  placeholder:    { color:C.muted },
  overlay:        { flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' },
  sheet:          { backgroundColor:C.white, borderTopLeftRadius:18, borderTopRightRadius:18, padding:16, maxHeight:'60%' },
  sheetTitle:     { fontSize:13, fontWeight:'700', color:C.navy, marginBottom:10 },
  option:         { paddingVertical:11, paddingHorizontal:4, flexDirection:'row', alignItems:'center', justifyContent:'space-between', borderBottomWidth:1, borderBottomColor:'#f1f5f9' },
  optionActive:   { backgroundColor:'#eef2ff', borderRadius:8, paddingHorizontal:8 },
  optionTxt:      { fontSize:14, color:C.navy },
  optionTxtActive:{ color:C.indigo, fontWeight:'700' },
});

// ─── Status dot ──────────────────────────────────────────────────────────────
function StatusDot({ state }) {
  const color = { idle:'#cbd5e1', dirty:C.amber, saving:C.indigo, saved:C.green, error:C.red }[state] ?? '#cbd5e1';
  return <View style={[st.dot, { backgroundColor: color }]} />;
}

// ─── Student row ─────────────────────────────────────────────────────────────
// Value AND dirty state managed locally — no parent re-render on keystroke.
const StudentRow = React.memo(function StudentRow({
  index, student, seedValue, originalValue, dotState, onChangeRoll, onSave,
}) {
  const fullName  = [student.firstName, student.lastName].filter(Boolean).join(' ')
    || student.student_name || student.name || '—';
  const initial   = fullName.charAt(0).toUpperCase();
  const displayId = student.enrollmentId ?? student.enrollment_id ?? student.id ?? student.registrationNo ?? '';
  const rowKey    = student.enrollmentId ?? student.enrollment_id;

  const [value, setValue]   = useState(seedValue ?? '');
  const prevSeed            = useRef(seedValue);

  useEffect(() => {
    if (seedValue !== prevSeed.current) {
      prevSeed.current = seedValue;
      setValue(seedValue ?? '');
    }
  }, [seedValue]);

  const isDirty  = value !== (originalValue ?? '');
  const isSaving = dotState === 'saving';
  const isSaved  = dotState === 'saved';
  const isError  = dotState === 'error';

  const handleChange = useCallback((v) => {
    setValue(v);
    onChangeRoll(rowKey, v);
  }, [rowKey, onChangeRoll]);

  return (
    <View style={[st.row, (isDirty && !isSaved) && st.rowDirty]}>
      <Text style={st.rowIdx}>{index + 1}</Text>

      <View style={st.rowStudent}>
        <View style={st.avatar}>
          <Text style={st.avatarTxt}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.studentName} numberOfLines={1}>{fullName}</Text>
          <Text style={st.regId}>{displayId}</Text>
        </View>
      </View>

      <TextInput
        style={[
          st.rollInput,
          (isDirty && !isSaved) && st.rollInputDirty,
          isSaved  && st.rollInputSaved,
          isError  && st.rollInputError,
        ]}
        value={value}
        onChangeText={handleChange}
        keyboardType="numeric"
        maxLength={6}
        selectTextOnFocus
        placeholder="—"
        placeholderTextColor={C.muted}
        returnKeyType="next"
      />

      <TouchableOpacity
        style={[st.saveOneBtn, isSaving && st.saveOneBtnDisabled]}
        onPress={() => onSave(rowKey, value)}
        disabled={isSaving}
        activeOpacity={0.75}
      >
        {isSaving
          ? <ActivityIndicator size={12} color={C.indigo} />
          : <Feather name="check" size={13} color={C.indigo} />
        }
      </TouchableOpacity>

      <StatusDot state={isSaving ? 'saving' : isSaved ? 'saved' : isError ? 'error' : isDirty ? 'dirty' : 'idle'} />
    </View>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function UpdateRollNumberScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  // dropdown data
  const [branches, setBranches] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [classes,  setClasses]  = useState([]);
  const [sections, setSections] = useState([]);

  // selections
  const [branchId,  setBranchId]  = useState('');
  const [sessionId, setSessionId] = useState('');
  const [classId,   setClassId]   = useState('');
  const [sectionId, setSectionId] = useState('');

  // student list
  const [students,      setStudents]      = useState([]);
  const [seedRolls,     setSeedRolls]     = useState({});
  const [originalRolls, setOriginalRolls] = useState({});
  const [dotStates,     setDotStates]     = useState({});
  const rollValuesRef = useRef({});

  // loading flags
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingClasses,  setLoadingClasses]  = useState(false);
  const [loadingSections, setLoadingSections] = useState(false);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingAll,       setSavingAll]       = useState(false);

  // load dropdowns
  useEffect(() => {
    setLoadingBranches(true);
    fetchBranches(user)
      .then(d => setBranches((d?.data ?? d ?? []).map(b => ({ label: b.branch_name, value: String(b.branch_id) }))))
      .catch(() => {})
      .finally(() => setLoadingBranches(false));
  }, []);

  useEffect(() => {
    setSessions([]); setSessionId('');
    if (!branchId) return;
    setLoadingSessions(true);
    fetchSessions(user)
      .then(d => setSessions((d?.data ?? d ?? []).map(s => ({ label: s.session_name, value: String(s.session_id) }))))
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, [branchId]);

  useEffect(() => {
    setClasses([]); setClassId('');
    if (!branchId) return;
    setLoadingClasses(true);
    fetchClasses({ ...user, branchId })
      .then(d => setClasses((Array.isArray(d) ? d : d?.data ?? []).map(c => ({ label: c.class_name, value: String(c.class_id) }))))
      .catch(() => {})
      .finally(() => setLoadingClasses(false));
  }, [branchId]);

  useEffect(() => {
    setSections([]); setSectionId('');
    if (!classId) return;
    setLoadingSections(true);
    fetchSections(user, classId)
      .then(d => setSections((d?.data ?? d ?? []).map(s => ({ label: s.section_name, value: String(s.section_id) }))))
      .catch(() => {})
      .finally(() => setLoadingSections(false));
  }, [classId]);

  // load students
  const loadStudents = useCallback(async () => {
    if (!branchId || !sessionId || !classId || !sectionId) {
      Alert.alert('Select all filters', 'Please choose Branch, Session, Class, and Section first.');
      return;
    }
    setLoadingStudents(true);
    setStudents([]);
    try {
      const { students: list } = await getEnrolledStudents(user, {
        branchId, sessionId, classId, sectionId, limit: 500,
      });
      const sorted = [...list].sort((a, b) => {
        const ra = parseFloat(a.roll_number ?? a.rollNumber ?? '') || Infinity;
        const rb = parseFloat(b.roll_number ?? b.rollNumber ?? '') || Infinity;
        return ra - rb;
      });
      setStudents(sorted);
      const seed = {}, orig = {}, dots = {};
      sorted.forEach(s => {
        const k = s.enrollmentId ?? s.enrollment_id;
        const v = String(s.roll_number ?? s.rollNumber ?? '');
        seed[k] = v; orig[k] = v; dots[k] = 'idle';
      });
      rollValuesRef.current = { ...seed };
      setSeedRolls(seed);
      setOriginalRolls(orig);
      setDotStates(dots);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Failed to load students');
    } finally {
      setLoadingStudents(false);
    }
  }, [branchId, sessionId, classId, sectionId, user]);

  // keystroke: only update the ref — zero parent state, zero re-renders
  const handleRollChange = useCallback((enrollmentId, value) => {
    rollValuesRef.current[enrollmentId] = value;
  }, []);

  // save one
  const saveOne = useCallback(async (enrollmentId, currentValue) => {
    const val = currentValue ?? rollValuesRef.current[enrollmentId] ?? '';
    setDotStates(prev => ({ ...prev, [enrollmentId]: 'saving' }));
    try {
      await updateRollNumber(user, { enrollment_id: enrollmentId, roll_number: val });
      rollValuesRef.current[enrollmentId] = val;
      setOriginalRolls(prev => ({ ...prev, [enrollmentId]: val }));
      setSeedRolls(prev => ({ ...prev, [enrollmentId]: val }));
      setDotStates(prev => ({ ...prev, [enrollmentId]: 'saved' }));
      setTimeout(() => setDotStates(prev => ({ ...prev, [enrollmentId]: 'idle' })), 2000);
    } catch (e) {
      setDotStates(prev => ({ ...prev, [enrollmentId]: 'error' }));
      Alert.alert('Save failed', e.message ?? 'Could not save roll number');
    }
  }, [user]);

  // save all
  const saveAll = useCallback(async () => {
    const dirty = students.filter(s => {
      const k = s.enrollmentId ?? s.enrollment_id;
      return rollValuesRef.current[k] !== originalRolls[k];
    });
    if (!dirty.length) { Alert.alert('No changes', 'All roll numbers are already saved.'); return; }
    setSavingAll(true);
    try {
      await updateRollNumbers(user, dirty.map(s => {
        const k = s.enrollmentId ?? s.enrollment_id;
        return { enrollment_id: k, roll_number: rollValuesRef.current[k] ?? '' };
      }));
      const newOrig = { ...originalRolls }, newSeed = { ...seedRolls }, newDots = { ...dotStates };
      dirty.forEach(s => {
        const k = s.enrollmentId ?? s.enrollment_id;
        const v = rollValuesRef.current[k] ?? '';
        newOrig[k] = v; newSeed[k] = v; newDots[k] = 'saved';
      });
      setOriginalRolls(newOrig); setSeedRolls(newSeed); setDotStates(newDots);
      setTimeout(() => {
        setDotStates(prev => {
          const d = { ...prev };
          dirty.forEach(s => { const k = s.enrollmentId ?? s.enrollment_id; if (d[k] === 'saved') d[k] = 'idle'; });
          return d;
        });
      }, 2500);
      Alert.alert('Saved', `${dirty.length} roll number${dirty.length > 1 ? 's' : ''} updated.`);
    } catch (e) {
      Alert.alert('Save failed', e.message ?? 'Could not save roll numbers');
    } finally {
      setSavingAll(false);
    }
  }, [students, originalRolls, seedRolls, dotStates, user]);

  // renderItem deps don't change per-keystroke → FlatList doesn't re-render rows
  const renderItem = useCallback(({ item, index }) => {
    const key = item.enrollmentId ?? item.enrollment_id;
    return (
      <StudentRow
        index={index}
        student={item}
        seedValue={seedRolls[key] ?? ''}
        originalValue={originalRolls[key] ?? ''}
        dotState={dotStates[key] ?? 'idle'}
        onChangeRoll={handleRollChange}
        onSave={saveOne}
      />
    );
  }, [seedRolls, originalRolls, dotStates, handleRollChange, saveOne]);

  const canLoad = branchId && sessionId && classId && sectionId;

  // ── Filter card — rendered as ListHeaderComponent so it scrolls away ──────
  const filterCard = (
    <View style={st.filterCard}>
      <View style={st.filterGrid}>
        <View style={st.filterCell}>
          <Text style={st.filterLabel}>Branch</Text>
          <Dropdown label="— Branch —" value={branchId} options={branches}
            onChange={v => { setBranchId(v); setClassId(''); setSectionId(''); }}
            loading={loadingBranches} />
        </View>
        <View style={st.filterCell}>
          <Text style={st.filterLabel}>Session</Text>
          <Dropdown label="— Session —" value={sessionId} options={sessions}
            onChange={setSessionId} disabled={!branchId} loading={loadingSessions} />
        </View>
        <View style={st.filterCell}>
          <Text style={st.filterLabel}>Class</Text>
          <Dropdown label="— Class —" value={classId} options={classes}
            onChange={v => { setClassId(v); setSectionId(''); }}
            disabled={!branchId} loading={loadingClasses} />
        </View>
        <View style={st.filterCell}>
          <Text style={st.filterLabel}>Section</Text>
          <Dropdown label="— Section —" value={sectionId} options={sections}
            onChange={setSectionId} disabled={!classId} loading={loadingSections} />
        </View>
      </View>
      <TouchableOpacity
        style={[st.loadBtn, !canLoad && st.loadBtnDisabled]}
        onPress={loadStudents}
        disabled={!canLoad || loadingStudents}
        activeOpacity={0.8}
      >
        {loadingStudents
          ? <ActivityIndicator size={16} color={C.white} />
          : <Feather name="users" size={15} color={C.white} />
        }
        <Text style={st.loadBtnTxt}>{loadingStudents ? 'Loading…' : 'Load Students'}</Text>
      </TouchableOpacity>
    </View>
  );

  const colHeader = (
    <View style={st.colHeader}>
      <Text style={[st.colTxt, { width: 28 }]}>#</Text>
      <Text style={[st.colTxt, { flex: 1 }]}>Student ({students.length})</Text>
      <Text style={[st.colTxt, { width: 64, textAlign: 'center' }]}>Roll No.</Text>
      <Text style={[st.colTxt, { width: 32, textAlign: 'center' }]}>Save</Text>
      <Text style={[st.colTxt, { width: 18 }]}> </Text>
    </View>
  );

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.navy} />

      {/* Fixed header bar */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Feather name="arrow-left" size={20} color={C.white} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Update Roll Numbers</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* KeyboardAvoidingView shrinks the list area when keyboard opens */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {students.length > 0 ? (
          <>
            {/*
              Filter card is ListHeaderComponent — user can scroll it up
              to get more space when keyboard is open.
            */}
            <FlatList
              data={students}
              keyExtractor={s => String(s.enrollmentId ?? s.enrollment_id)}
              renderItem={renderItem}
              ListHeaderComponent={
                <>
                  {filterCard}
                  {colHeader}
                </>
              }
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              contentContainerStyle={{ paddingBottom: 100 }}
            />

            {/* Fixed Save All footer */}
            <View style={st.footer}>
              <Text style={st.footerHint}>Scroll up to hide filters · Tap ✓ to save one row</Text>
              <TouchableOpacity
                style={[st.saveAllBtn, savingAll && st.saveAllBtnDisabled]}
                onPress={saveAll}
                disabled={savingAll}
                activeOpacity={0.8}
              >
                {savingAll
                  ? <ActivityIndicator size={15} color={C.white} />
                  : <Feather name="upload-cloud" size={15} color={C.white} />
                }
                <Text style={st.saveAllTxt}>{savingAll ? 'Saving…' : 'Save All'}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          // No students loaded yet — scrollable so keyboard never traps content
          <ScrollView keyboardShouldPersistTaps="handled">
            {filterCard}
            {!loadingStudents && (
              <View style={st.empty}>
                <Feather name="users" size={44} color={C.muted} />
                <Text style={st.emptyTxt}>
                  {canLoad
                    ? 'Tap "Load Students" to begin'
                    : 'Select Branch, Session, Class and Section above'}
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.bg },

  header:         { flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor:C.navy, paddingHorizontal:16, paddingVertical:8 },
  backBtn:        { padding:4 },
  headerTitle:    { fontSize:16, fontWeight:'800', color:C.white },

  filterCard:     { backgroundColor:C.white, margin:8, borderRadius:14, padding:10, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:2 },
  filterGrid:     { flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:8 },
  filterCell:     { width:'48%' },
  filterLabel:    { fontSize:10, fontWeight:'700', color:C.slate, marginBottom:3 },
  loadBtn:        { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:6, backgroundColor:C.indigo, borderRadius:10, paddingVertical:8 },
  loadBtnDisabled:{ opacity:0.5 },
  loadBtnTxt:     { fontSize:13, fontWeight:'700', color:C.white },

  colHeader:      { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:4, backgroundColor:'#f8faff', borderBottomWidth:1, borderBottomColor:C.border },
  colTxt:         { fontSize:10, fontWeight:'700', color:C.muted, textTransform:'uppercase', letterSpacing:0.4 },

  row:            { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:7, borderBottomWidth:1, borderBottomColor:'#f8fafc', backgroundColor:C.white },
  rowDirty:       { backgroundColor:'#fffbeb' },
  rowIdx:         { width:28, fontSize:12, color:C.muted, fontWeight:'600' },
  rowStudent:     { flex:1, flexDirection:'row', alignItems:'center', gap:8 },
  avatar:         { width:30, height:30, borderRadius:15, backgroundColor:'#eff6ff', alignItems:'center', justifyContent:'center', flexShrink:0 },
  avatarTxt:      { fontSize:12, fontWeight:'800', color:'#1355c1' },
  studentName:    { fontSize:13, fontWeight:'700', color:C.navy },
  regId:          { fontSize:10, color:C.muted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  rollInput:      { width:64, borderWidth:1.5, borderColor:C.border, borderRadius:8, paddingHorizontal:6, paddingVertical:5, fontSize:14, fontWeight:'700', color:C.navy, textAlign:'center', backgroundColor:C.white },
  rollInputDirty: { borderColor:C.amber, backgroundColor:'#fffbeb' },
  rollInputSaved: { borderColor:C.green, backgroundColor:'#f0fdf4' },
  rollInputError: { borderColor:C.red,   backgroundColor:'#fef2f2' },

  saveOneBtn:        { width:32, height:32, borderRadius:8, borderWidth:1.5, borderColor:'#c7d2fe', alignItems:'center', justifyContent:'center', marginLeft:4 },
  saveOneBtnDisabled:{ opacity:0.5 },

  dot:            { width:8, height:8, borderRadius:4, marginLeft:6 },

  footer:         { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:14, paddingVertical:8, backgroundColor:C.white, borderTopWidth:1, borderTopColor:C.border, elevation:6 },
  footerHint:     { fontSize:10, color:C.muted, flex:1, marginRight:8 },
  saveAllBtn:     { flexDirection:'row', alignItems:'center', gap:6, backgroundColor:C.green, borderRadius:10, paddingHorizontal:14, paddingVertical:8 },
  saveAllBtnDisabled:{ opacity:0.6 },
  saveAllTxt:     { fontSize:13, fontWeight:'700', color:C.white },

  empty:          { paddingTop:60, alignItems:'center', paddingHorizontal:32, gap:12 },
  emptyTxt:       { fontSize:14, color:C.muted, textAlign:'center', lineHeight:20 },
});
