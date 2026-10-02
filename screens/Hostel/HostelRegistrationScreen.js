/**
 * StudentRegistrationScreen.js — Final performance-fixed edition
 *
 * BUGS FIXED IN THIS VERSION vs previous:
 *
 * 1. CRITICAL — useRef inside object literal (violated Rules of Hooks)
 *    const refs = { firstName: useRef(''), ... }  ← WRONG
 *    React called a different number of hooks each render when the object
 *    was recreated, causing freeze / crash. Each ref is now declared
 *    individually at the top level.
 *
 * 2. @react-native-picker/picker causes JS thread jank on Android
 *    Replaced with a custom ModalPicker — a TouchableOpacity that opens
 *    a bottom-sheet Modal with a FlatList of options. No Picker dependency.
 *    Selection fires ONE setState. FlatList is virtualised so 100+ items
 *    render instantly.
 *
 * 3. Each step is its own React.memo component
 *    StepStudent / StepAcademic / StepParent / StepPhoto are defined outside
 *    the parent. They only receive stable props (refs + sel values).
 *    Typing in Step 0 cannot touch Steps 1-3 at all.
 */

import React, {
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image,
  Modal, Platform, Dimensions, KeyboardAvoidingView,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { AuthContext } from '../../context/AuthContext';
import { Feather } from "@expo/vector-icons";
import {
  fetchClasses, fetchSessions, fetchBranches, registerStudent,
} from '../../services/StudentServiceApi';

// ─── Module-level constants ───────────────────────────────────────────────────
const { width, height } = Dimensions.get('window');
const isTablet = width >= 768;

const C = {
  primary:    '#1a3c6e',
  bg:         '#f0f4f9',
  surface:    '#ffffff',
  border:     '#dde4ef',
  muted:      '#7a8eaa',
  text:       '#1a2b42',
  textSoft:   '#4a5e78',
  error:      '#c0392b',
  errorSoft:  '#fdecea',
  success:    '#15803d',
  successSoft:'#dcfce7',
  sectionA:   '#1a3c6e',
  sectionB:   '#2c5f2e',
  sectionC:   '#7b3f00',
  sectionD:   '#4a1580',
};

const STEPS = [
  { key: 'student',  label: 'Student',  icon: 'person',          color: C.sectionA },
  { key: 'academic', label: 'Academic', icon: 'school',          color: C.sectionB },
  { key: 'parent',   label: 'Parent',   icon: 'family-restroom', color: C.sectionC },
  { key: 'address',  label: 'Address',  icon: 'location-on',     color: '#0e7490' },
  { key: 'photo',    label: 'Photo',    icon: 'photo-camera',    color: C.sectionD },
];

const C_ADDRESS = '#0e7490';

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// Static option lists
const OPT_TITLE     = ['Mr','Mrs','Ms','Dr','Prof'];
const OPT_GENDER    = ['Male','Female','Other'];
const OPT_ADMISSION = ['General','Underprivileged','Weaker Section','NRI','Management Quota'];
const OPT_PHYSICAL  = ['No','Yes'];

// ─────────────────────────────────────────────────────────────────────────────

// ── Custom Dropdown — replaces @react-native-picker/picker ───────────────────
// Fully JS-based: immune to Android dark mode, no native thread blocking.
function Dropdown({ label, value, options, onChange, disabled, loading }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[_ddSt.trigger, disabled && _ddSt.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[_ddSt.triggerTxt, !selected?.value && _ddSt.placeholder]} numberOfLines={1}>
          {loading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name="chevron-down" size={16} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={_ddSt.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={_ddSt.sheet}>
            <Text style={_ddSt.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[_ddSt.option, String(o.value) === String(value) && _ddSt.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[_ddSt.optionTxt, String(o.value) === String(value) && _ddSt.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#2563eb" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
const _ddSt = StyleSheet.create({
  trigger:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12 },
  disabled:        { opacity: 0.45 },
  triggerTxt:      { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "500" },
  placeholder:     { color: "#94a3b8" },
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:           { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  sheetTitle:      { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:    { backgroundColor: "#eff6ff" },
  optionTxt:       { fontSize: 14, color: "#0f172a" },
  optionTxtActive: { color: "#2563eb", fontWeight: "700" },
});

export default function HostelRegistrationScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  // ── Dropdown data ─────────────────────────────────────────────────────────
  const [classes,      setClasses]      = useState([]);
  const [sessions,     setSessions]     = useState([]);
  const [branches,     setBranches]     = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);

  // ── Screen-level UI state ─────────────────────────────────────────────────
  const [step,        setStep]        = useState(0);
  const [submitting,  setSubmitting]  = useState(false);
  const [uploadPct,   setUploadPct]   = useState(0);
  const [photo,       setPhoto]       = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formKey,     setFormKey]     = useState(0);  // bump to remount inputs on reset

  // Ref to the ScrollView — used to scroll back to top on every step change
  const scrollRef = useRef(null);

  // ── Select (modal picker) values ─────────────────────────────────────────
  const [selTitle,     setSelTitle]     = useState('');
  const [selGender,    setSelGender]    = useState('');
  const [selBranchId,  setSelBranchId]  = useState('');
  const [selClassId,   setSelClassId]   = useState('');
  const [selSessionId, setSelSessionId] = useState('');
  const [selAdmission, setSelAdmission] = useState('');
  const [selPhysical,  setSelPhysical]  = useState('');

  // ── DOB ───────────────────────────────────────────────────────────────────
  const [dobModal, setDobModal] = useState(false);
  const [dobText,  setDobText]  = useState('');
  const dobIsoRef               = useRef('');
  const currentYear = new Date().getFullYear();
  const [dobYear,  setDobYear]  = useState(currentYear - 10);
  const [dobMonth, setDobMonth] = useState(1);
  const [dobDay,   setDobDay]   = useState(1);

  const years  = useMemo(() => Array.from({ length: currentYear - 1950 + 1 }, (_, i) => currentYear - i), [currentYear]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const days   = useMemo(() => {
    const max = new Date(dobYear, dobMonth, 0).getDate();
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [dobMonth, dobYear]);

  useEffect(() => {
    const max = new Date(dobYear, dobMonth, 0).getDate();
    if (dobDay > max) setDobDay(max);
  }, [dobYear, dobMonth]);

  // ── Text refs — EACH DECLARED INDIVIDUALLY at top level ──────────────────
  // CRITICAL FIX: never put useRef() calls inside an object/array literal.
  // That recreates the container on every render and violates Rules of Hooks.
  const refFirstName        = useRef('');
  const refMiddleName       = useRef('');
  const refLastName         = useRef('');
  const refEmail            = useRef('');
  const refMobile           = useRef('');
  const refPlaceOfBirth     = useRef('');
  const refNationality      = useRef('');
  const refCourseMedium     = useRef('');
  const refFatherName       = useRef('');
  const refFatherEducation  = useRef('');
  const refFatherAge        = useRef('');
  const refFatherOccupation = useRef('');
  const refMotherName       = useRef('');
  const refMotherEducation  = useRef('');
  const refMotherAge        = useRef('');
  const refMotherOccupation = useRef('');

  // Address refs
  const refCAddressLine1    = useRef('');
  const refCAddressLine2    = useRef('');
  const refCAddressCity     = useRef('');
  const refCAddressState    = useRef('');
  const refCAddressZipCode  = useRef('');
  const refCAddressHomephone= useRef('');
  const refPAddressLine1    = useRef('');
  const refPAddressLine2    = useRef('');
  const refPAddressCity     = useRef('');
  const refPAddressState    = useRef('');
  const refPAddressZipCode  = useRef('');
  const refPAddressHomephone= useRef('');

  // ── Load dropdowns ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setLoadingLists(true);
        const [cls, ses, br] = await Promise.all([
          fetchClasses(user), fetchSessions(user), fetchBranches(user),
        ]);
        setClasses(cls  || []);
        setSessions(ses || []);
        setBranches(br  || []);
      } catch (e) {
        Alert.alert('Error', e.message || 'Failed to load dropdown data');
      } finally {
        setLoadingLists(false);
      }
    })();
  }, [user]);

  const classItems   = useMemo(() => classes.map(c  => ({ label: c.class_name,  value: String(c.class_id) })),  [classes]);
  const sessionItems = useMemo(() => sessions.map(s => ({ label: s.session_name ?? String(s.session_id), value: String(s.session_id) })), [sessions]);
  const branchItems  = useMemo(() => branches.map(b => ({ label: b.branch_name  ?? String(b.branch_id),  value: String(b.branch_id) })), [branches]);

  // ── DOB confirm ───────────────────────────────────────────────────────────
  const confirmDob = useCallback(() => {
    const iso     = `${dobYear}-${String(dobMonth).padStart(2,'0')}-${String(dobDay).padStart(2,'0')}`;
    const display = `${String(dobDay).padStart(2,'0')} ${MONTHS[dobMonth-1]} ${dobYear}`;
    dobIsoRef.current = iso;
    setDobText(display);
    setDobModal(false);
  }, [dobYear, dobMonth, dobDay]);

  // ── Image picking ─────────────────────────────────────────────────────────
  const processImage = useCallback(async (asset) => {
    const m = await ImageManipulator.manipulateAsync(
      asset.uri, [{ resize: { width: 900 } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
    );
    setPhoto({ ...asset, uri: m.uri });
  }, []);

  const pickImage = useCallback(async () => {
    try {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (p.status !== 'granted') { Alert.alert('Permission Required', 'Allow photo library access.'); return; }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1,1], quality: 1 });
      if (!r.canceled) await processImage(r.assets[0]);
    } catch (e) { Alert.alert('Error', e?.message || 'Could not open photo library.'); }
  }, [processImage]);

  const takePhoto = useCallback(async () => {
    try {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (p.status !== 'granted') { Alert.alert('Permission Required', 'Allow camera access.'); return; }
      const r = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1,1], quality: 1 });
      if (!r.canceled) await processImage(r.assets[0]);
    } catch (e) { Alert.alert('Error', e?.message || 'Could not open camera.'); }
  }, [processImage]);

  // ── Stable select handlers ────────────────────────────────────────────────
  const onTitleChange     = useCallback((v) => setSelTitle(v),     []);
  const onGenderChange    = useCallback((v) => setSelGender(v),    []);
  const onBranchChange    = useCallback((v) => setSelBranchId(v),  []);
  const onClassChange     = useCallback((v) => setSelClassId(v),   []);
  const onSessionChange   = useCallback((v) => setSelSessionId(v), []);
  const onAdmissionChange = useCallback((v) => setSelAdmission(v), []);
  const onPhysicalChange  = useCallback((v) => setSelPhysical(v),  []);

  // ── Validate ──────────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    const e = {};
    if (!refFirstName.current?.trim())  e.firstName    = 'First name is required';
    if (!refLastName.current?.trim())   e.lastName     = 'Last name is required';
    if (!selGender)                     e.gender       = 'Gender is required';
    if (!refMobile.current?.trim())     e.mobileNumber = 'Mobile number is required';
    if (!selClassId)                    e.classId      = 'Class is required';
    if (!selBranchId)                   e.branchId     = 'Branch is required';
    if (!selSessionId)                  e.sessionId    = 'Session is required';
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }, [selGender, selClassId, selBranchId, selSessionId]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetAll = useCallback(() => {
    setFormKey(k => k + 1);   // remounts all TextInputs
    refFirstName.current = ''; refMiddleName.current = ''; refLastName.current = '';
    refEmail.current = ''; refMobile.current = ''; refPlaceOfBirth.current = '';
    refNationality.current = ''; refCourseMedium.current = '';
    refFatherName.current = ''; refFatherEducation.current = '';
    refFatherAge.current = ''; refFatherOccupation.current = '';
    refMotherName.current = ''; refMotherEducation.current = '';
    refMotherAge.current = ''; refMotherOccupation.current = '';
    refCAddressLine1.current = ''; refCAddressLine2.current = '';
    refCAddressCity.current = ''; refCAddressState.current = '';
    refCAddressZipCode.current = ''; refCAddressHomephone.current = '';
    refPAddressLine1.current = ''; refPAddressLine2.current = '';
    refPAddressCity.current = ''; refPAddressState.current = '';
    refPAddressZipCode.current = ''; refPAddressHomephone.current = '';
    setSelTitle(''); setSelGender(''); setSelBranchId('');
    setSelClassId(''); setSelSessionId(''); setSelAdmission(''); setSelPhysical('');
    setDobText(''); dobIsoRef.current = '';
    setPhoto(null); setFieldErrors({}); setStep(0);
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const onSubmit = useCallback(async () => {
    if (!validate()) {
      setStep(0);
      Alert.alert('Validation Error', 'Please fill all required fields.');
      return;
    }
    const formData = {
      title:                  selTitle,
      firstName:              refFirstName.current,
      middleName:             refMiddleName.current,
      lastName:               refLastName.current,
      emailAddress:           refEmail.current,
      mobileNumber:           refMobile.current,
      gender:                 selGender,
      dob:                    dobIsoRef.current,
      placeOfBirth:           refPlaceOfBirth.current,
      nationality:            refNationality.current,
      classId:                selClassId,
      branchId:               selBranchId,
      sessionId:              selSessionId,
      courseMedium:           refCourseMedium.current,
      admissionType:          selAdmission,
      isPhysicallyChallenged: selPhysical,
      fatherName:             refFatherName.current,
      fatherEducation:        refFatherEducation.current,
      fatherAge:              refFatherAge.current,
      fatherOccupation:       refFatherOccupation.current,
      motherName:             refMotherName.current,
      motherEducation:        refMotherEducation.current,
      motherAge:              refMotherAge.current,
      motherOccupation:       refMotherOccupation.current,
      cAddressLine1:          refCAddressLine1.current,
      cAddressLine2:          refCAddressLine2.current,
      cAddressCity:           refCAddressCity.current,
      cAddressState:          refCAddressState.current,
      cAddressZipCode:        refCAddressZipCode.current,
      cAddressHomephone:      refCAddressHomephone.current,
      pAddressLine1:          refPAddressLine1.current,
      pAddressLine2:          refPAddressLine2.current,
      pAddressCity:           refPAddressCity.current,
      pAddressState:          refPAddressState.current,
      pAddressZipCode:        refPAddressZipCode.current,
      pAddressHomephone:      refPAddressHomephone.current,
    };
    try {
      setSubmitting(true);
      setUploadPct(0);
      const res = await registerStudent({ form: formData, photoAsset: photo, user, onProgress: setUploadPct });
      Alert.alert('Success 🎉', res.message || 'Student registered successfully!');
      resetAll();
    } catch (e) {
      Alert.alert('Error', e.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
      setUploadPct(0);
    }
  }, [validate, resetAll, photo, user,
      selTitle, selGender, selClassId, selBranchId, selSessionId, selAdmission, selPhysical]);

  // ── Summary labels for step 3 ─────────────────────────────────────────────
  const summaryClass   = classItems.find(c   => c.value === selClassId)?.label   ?? '—';
  const summaryBranch  = branchItems.find(b  => b.value === selBranchId)?.label  ?? '—';
  const summarySession = sessionItems.find(s => s.value === selSessionId)?.label ?? '—';

  // Scroll to top whenever step changes (Next, Back, or stepper tab tap)
  useEffect(() => {
    // Small timeout lets the new step content mount first,
    // then scrolls — prevents a race where content isn't laid out yet
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, [step]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loadingLists) {
    return (
      <SafeAreaView style={st.safeArea}>
        <View style={st.loaderWrap}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={st.loaderTitle}>Preparing Form</Text>
          <Text style={st.loaderSub}>Loading classes, sessions and branches…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.safeArea} edges={['top']}>

      {/* Header */}
      <View style={st.pageHeader}>
        <TouchableOpacity style={st.backBtn} onPress={() => navigation?.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={C.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.pageTitle}>Hostel Registration</Text>
          <Text style={st.pageSub}>Complete all sections to enrol a new student</Text>
        </View>
        <View style={st.stepPill}>
          <Text style={st.stepPillText}>{step + 1} / {STEPS.length}</Text>
        </View>
      </View>

      {/* Stepper */}
      <StepperTabs step={step} onPress={setStep} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={st.scrollContent}>

          {/* Wrap in key so TextInputs remount on reset */}
          <View key={formKey}>

            {step === 0 && (
              <StepStudent
                // refs
                refFirstName={refFirstName} refMiddleName={refMiddleName}
                refLastName={refLastName} refEmail={refEmail} refMobile={refMobile}
                refPlaceOfBirth={refPlaceOfBirth} refNationality={refNationality}
                // select values + handlers
                selTitle={selTitle}     onTitleChange={onTitleChange}
                selGender={selGender}   onGenderChange={onGenderChange}
                selBranchId={selBranchId} onBranchChange={onBranchChange}
                selClassId={selClassId}   onClassChange={onClassChange}
                selSessionId={selSessionId} onSessionChange={onSessionChange}
                branchItems={branchItems} classItems={classItems} sessionItems={sessionItems}
                // dob
                dobText={dobText} onDobPress={() => setDobModal(true)}
                // errors
                errors={fieldErrors}
              />
            )}

            {step === 1 && (
              <StepAcademic
                refCourseMedium={refCourseMedium}
                selAdmission={selAdmission} onAdmissionChange={onAdmissionChange}
                selPhysical={selPhysical}   onPhysicalChange={onPhysicalChange}
              />
            )}

            {step === 2 && (
              <StepParent
                refFatherName={refFatherName} refFatherEducation={refFatherEducation}
                refFatherAge={refFatherAge}   refFatherOccupation={refFatherOccupation}
                refMotherName={refMotherName} refMotherEducation={refMotherEducation}
                refMotherAge={refMotherAge}   refMotherOccupation={refMotherOccupation}
              />
            )}

            {step === 3 && (
              <StepAddress
                refCLine1={refCAddressLine1}   refCLine2={refCAddressLine2}
                refCCity={refCAddressCity}      refCState={refCAddressState}
                refCZip={refCAddressZipCode}    refCPhone={refCAddressHomephone}
                refPLine1={refPAddressLine1}    refPLine2={refPAddressLine2}
                refPCity={refPAddressCity}      refPState={refPAddressState}
                refPZip={refPAddressZipCode}    refPPhone={refPAddressHomephone}
              />
            )}

            {step === 4 && (
              <StepPhoto
                photo={photo}
                onPickImage={pickImage} onTakePhoto={takePhoto}
                onRemovePhoto={() => setPhoto(null)}
                selTitle={selTitle} refFirstName={refFirstName}
                refMiddleName={refMiddleName} refLastName={refLastName}
                refMobile={refMobile} dobText={dobText}
                selGender={selGender} summaryClass={summaryClass}
                summaryBranch={summaryBranch} summarySession={summarySession}
                selAdmission={selAdmission}
              />
            )}

          </View>

          {/* Navigation buttons */}
          <View style={st.navRow}>
            {step > 0 ? (
              <TouchableOpacity style={st.navBtnBack} onPress={() => setStep(s => s - 1)}>
                <MaterialIcons name="arrow-back" size={18} color={C.primary} />
                <Text style={st.navBtnBackText}>Back</Text>
              </TouchableOpacity>
            ) : <View style={{ flex: 1 }} />}

            {step < STEPS.length - 1 ? (
              <TouchableOpacity style={[st.navBtnNext, { backgroundColor: STEPS[step].color }]}
                onPress={() => setStep(s => s + 1)}>
                <Text style={st.navBtnNextText}>Next  →  {STEPS[step + 1].label}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[st.navBtnNext, { backgroundColor: C.success, opacity: submitting ? 0.7 : 1 }]}
                onPress={onSubmit} disabled={submitting}>
                {submitting ? (
                  <View style={st.submitRow}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={st.navBtnNextText}>
                      {uploadPct > 0 ? `Uploading ${uploadPct}%…` : 'Submitting…'}
                    </Text>
                  </View>
                ) : (
                  <View style={st.submitRow}>
                    <MaterialIcons name="how-to-reg" size={20} color="#fff" />
                    <Text style={st.navBtnNextText}>Submit Registration</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>
          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* DOB Modal */}
      <DobModal
        visible={dobModal}
        onClose={() => setDobModal(false)}
        onConfirm={confirmDob}
        dobDay={dobDay} setDobDay={setDobDay}
        dobMonth={dobMonth} setDobMonth={setDobMonth}
        dobYear={dobYear} setDobYear={setDobYear}
        days={days} months={months} years={years}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step components — each is React.memo'd and lives OUTSIDE the parent.
// A state change in the parent (e.g. selGender) only re-renders the step
// component that actually receives that prop. Steps not currently visible
// are not mounted at all (conditional rendering).
// ─────────────────────────────────────────────────────────────────────────────

const StepStudent = React.memo(function StepStudent({
  refFirstName, refMiddleName, refLastName, refEmail, refMobile,
  refPlaceOfBirth, refNationality,
  selTitle, onTitleChange, selGender, onGenderChange,
  selBranchId, onBranchChange, selClassId, onClassChange,
  selSessionId, onSessionChange,
  branchItems, classItems, sessionItems,
  dobText, onDobPress, errors,
}) {
  return (
    <SectionCard color={C.sectionA} icon="person"
      title="Student Information" subtitle="Personal & contact details">

      <RowPair>
        <ModalSelect label="Title" icon="title" value={selTitle}
          onChange={onTitleChange} options={OPT_TITLE} placeholder="Select Title" />
        <ModalSelect label="Gender *" icon="wc" value={selGender}
          onChange={onGenderChange} options={OPT_GENDER} placeholder="Select Gender"
          error={errors.gender} />
      </RowPair>

      <RowPair>
        <FieldRef label="First Name *" icon="person-outline"
          fieldRef={refFirstName} placeholder="First name" error={errors.firstName} />
        <FieldRef label="Middle Name" icon="person-outline"
          fieldRef={refMiddleName} placeholder="Middle name" />
      </RowPair>

      <FieldRef label="Last Name *" icon="person-outline"
        fieldRef={refLastName} placeholder="Last name" error={errors.lastName} />

      <RowPair>
        <FieldRef label="Email Address" icon="mail-outline"
          fieldRef={refEmail} placeholder="email@example.com"
          keyboardType="email-address" autoCapitalize="none" />
        <FieldRef label="Mobile Number *" icon="phone-iphone"
          fieldRef={refMobile} placeholder="+91 XXXXX XXXXX"
          keyboardType="phone-pad" error={errors.mobileNumber} />
      </RowPair>

      <Text style={ff.label}>Date of Birth</Text>
      <TouchableOpacity style={st.dateBtn} onPress={onDobPress}>
        <MaterialIcons name="event" size={18} color={dobText ? C.primary : C.muted} />
        <Text style={[st.dateBtnText, dobText && { color: C.text, fontWeight: '700' }]}>
          {dobText || 'Tap to select date of birth'}
        </Text>
        <MaterialIcons name="chevron-right" size={18} color={C.muted} />
      </TouchableOpacity>

      <RowPair>
        <FieldRef label="Place of Birth" icon="place"
          fieldRef={refPlaceOfBirth} placeholder="City / Town" />
        <FieldRef label="Nationality" icon="public"
          fieldRef={refNationality} placeholder="e.g. Indian" />
      </RowPair>

      <SectionDivider label="Academic Placement" />

      <ModalSelect label="Branch *" icon="account-balance" value={selBranchId}
        onChange={onBranchChange} options={branchItems} placeholder="Select Branch"
        error={errors.branchId} />
      <ModalSelect label="Class *" icon="class" value={selClassId}
        onChange={onClassChange} options={classItems} placeholder="Select Class"
        error={errors.classId} />
      <ModalSelect label="Session *" icon="date-range" value={selSessionId}
        onChange={onSessionChange} options={sessionItems} placeholder="Select Session"
        error={errors.sessionId} />
    </SectionCard>
  );
});

const StepAcademic = React.memo(function StepAcademic({
  refCourseMedium, selAdmission, onAdmissionChange, selPhysical, onPhysicalChange,
}) {
  return (
    <SectionCard color={C.sectionB} icon="school"
      title="Academic & Health Details"
      subtitle="Learning preferences and admission profile">
      <FieldRef label="Course Medium" icon="translate"
        fieldRef={refCourseMedium} placeholder="e.g. English, Hindi" />
      <ModalSelect label="Admission Type / Category" icon="layers"
        value={selAdmission} onChange={onAdmissionChange}
        options={OPT_ADMISSION} placeholder="Select Admission Type" />
      <ModalSelect label="Physically Challenged?" icon="accessible"
        value={selPhysical} onChange={onPhysicalChange}
        options={OPT_PHYSICAL} placeholder="Select..." />
      <InfoBox color={C.sectionB} icon="info-outline"
        text="Physical challenge status is used only for government reporting." />
    </SectionCard>
  );
});

const StepParent = React.memo(function StepParent({
  refFatherName, refFatherEducation, refFatherAge, refFatherOccupation,
  refMotherName, refMotherEducation, refMotherAge, refMotherOccupation,
}) {
  return (
    <SectionCard color={C.sectionC} icon="family-restroom"
      title="Parent Information" subtitle="Primary guardian and family details">
      <SectionDivider label="Father's Details" color="#c45c1a" />
      <RowPair>
        <FieldRef label="Father's Name" icon="person" fieldRef={refFatherName} placeholder="Full name" />
        <FieldRef label="Father's Occupation" icon="work" fieldRef={refFatherOccupation} placeholder="Occupation" />
      </RowPair>
      <RowPair>
        <FieldRef label="Father's Education" icon="school" fieldRef={refFatherEducation} placeholder="Qualification" />
        <FieldRef label="Father's Age" icon="cake" fieldRef={refFatherAge} placeholder="Age" keyboardType="number-pad" />
      </RowPair>
      <SectionDivider label="Mother's Details" color="#c45c1a" />
      <RowPair>
        <FieldRef label="Mother's Name" icon="person" fieldRef={refMotherName} placeholder="Full name" />
        <FieldRef label="Mother's Occupation" icon="work" fieldRef={refMotherOccupation} placeholder="Occupation" />
      </RowPair>
      <RowPair>
        <FieldRef label="Mother's Education" icon="school" fieldRef={refMotherEducation} placeholder="Qualification" />
        <FieldRef label="Mother's Age" icon="cake" fieldRef={refMotherAge} placeholder="Age" keyboardType="number-pad" />
      </RowPair>
    </SectionCard>
  );
});

const StepAddress = React.memo(function StepAddress({
  refCLine1, refCLine2, refCCity, refCState, refCZip, refCPhone,
  refPLine1, refPLine2, refPCity, refPState, refPZip, refPPhone,
}) {
  const [sameAsCurrent, setSameAsCurrent] = React.useState(false);

  // "Same as current" — copy current values into permanent refs
  const handleSameToggle = useCallback(() => {
    if (!sameAsCurrent) {
      refPLine1.current  = refCLine1.current;
      refPLine2.current  = refCLine2.current;
      refPCity.current   = refCCity.current;
      refPState.current  = refCState.current;
      refPZip.current    = refCZip.current;
      refPPhone.current  = refCPhone.current;
    }
    setSameAsCurrent(v => !v);
  }, [sameAsCurrent, refCLine1, refCLine2, refCCity, refCState, refCZip, refCPhone,
      refPLine1, refPLine2, refPCity, refPState, refPZip, refPPhone]);

  return (
    <SectionCard color={C_ADDRESS} icon="location-on"
      title="Address Details" subtitle="Current and permanent address (optional)">

      <SectionDivider label="Current Address" color={C_ADDRESS} />
      <FieldRef label="Address Line 1" icon="home"       fieldRef={refCLine1}  placeholder="House / Flat / Building" />
      <FieldRef label="Address Line 2" icon="apartment"  fieldRef={refCLine2}  placeholder="Street / Colony / Area" />
      <RowPair>
        <FieldRef label="City"       icon="location-city"  fieldRef={refCCity}  placeholder="City" />
        <FieldRef label="State"      icon="map"            fieldRef={refCState} placeholder="State" />
      </RowPair>
      <RowPair>
        <FieldRef label="ZIP Code"   icon="markunread-mailbox" fieldRef={refCZip}   placeholder="PIN / ZIP" keyboardType="number-pad" />
        <FieldRef label="Home Phone" icon="phone"              fieldRef={refCPhone} placeholder="Landline number"  keyboardType="phone-pad" />
      </RowPair>

      {/* Same as current toggle */}
      <TouchableOpacity
        style={[addr.sameToggle, sameAsCurrent && addr.sameToggleActive]}
        onPress={handleSameToggle}
        activeOpacity={0.8}>
        <View style={[addr.checkbox, sameAsCurrent && { backgroundColor: C_ADDRESS, borderColor: C_ADDRESS }]}>
          {sameAsCurrent && <MaterialIcons name="check" size={14} color="#fff" />}
        </View>
        <Text style={[addr.sameToggleText, sameAsCurrent && { color: C_ADDRESS, fontWeight: '700' }]}>
          Permanent address same as current address
        </Text>
      </TouchableOpacity>

      <SectionDivider label="Permanent Address" color={C_ADDRESS} />
      <FieldRef label="Address Line 1" icon="home"       fieldRef={refPLine1}  placeholder="House / Flat / Building"
        defaultValue={sameAsCurrent ? refCLine1.current : undefined} />
      <FieldRef label="Address Line 2" icon="apartment"  fieldRef={refPLine2}  placeholder="Street / Colony / Area"
        defaultValue={sameAsCurrent ? refCLine2.current : undefined} />
      <RowPair>
        <FieldRef label="City"       icon="location-city"  fieldRef={refPCity}  placeholder="City"
          defaultValue={sameAsCurrent ? refCCity.current : undefined} />
        <FieldRef label="State"      icon="map"            fieldRef={refPState} placeholder="State"
          defaultValue={sameAsCurrent ? refCState.current : undefined} />
      </RowPair>
      <RowPair>
        <FieldRef label="ZIP Code"   icon="markunread-mailbox" fieldRef={refPZip}   placeholder="PIN / ZIP" keyboardType="number-pad"
          defaultValue={sameAsCurrent ? refCZip.current : undefined} />
        <FieldRef label="Home Phone" icon="phone"              fieldRef={refPPhone} placeholder="Landline number"  keyboardType="phone-pad"
          defaultValue={sameAsCurrent ? refCPhone.current : undefined} />
      </RowPair>
    </SectionCard>
  );
});

const StepPhoto = React.memo(function StepPhoto({
  photo, onPickImage, onTakePhoto, onRemovePhoto,
  selTitle, refFirstName, refMiddleName, refLastName,
  refMobile, dobText, selGender, summaryClass, summaryBranch, summarySession, selAdmission,
}) {
  const fullName = [selTitle, refFirstName.current, refMiddleName.current, refLastName.current]
    .filter(Boolean).join(' ') || '—';
  return (
    <SectionCard color={C.sectionD} icon="photo-camera"
      title="Student Photo" subtitle="Square identity-ready photo (JPG, max 5 MB)">

      <View style={st.photoPreviewWrap}>
        {photo?.uri ? (
          <View style={st.photoFrame}>
            <Image source={{ uri: photo.uri }} style={st.photoPreview} />
            <View style={st.photoApprovedBadge}>
              <MaterialIcons name="check-circle" size={20} color={C.success} />
              <Text style={st.photoApprovedText}>Photo Selected</Text>
            </View>
          </View>
        ) : (
          <View style={st.photoPlaceholder}>
            <View style={st.photoPlaceholderIcon}>
              <MaterialIcons name="person" size={64} color={C.border} />
            </View>
            <Text style={st.photoPlaceholderTitle}>No photo selected</Text>
            <Text style={st.photoPlaceholderSub}>Upload or take a square passport-size photo</Text>
          </View>
        )}
      </View>

      <View style={st.photoActions}>
        <TouchableOpacity style={[st.photoBtn, { borderColor: C.sectionD }]}
          onPress={onPickImage} activeOpacity={0.8}>
          <MaterialIcons name="photo-library" size={20} color={C.sectionD} />
          <Text style={[st.photoBtnText, { color: C.sectionD }]}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.photoBtn, { borderColor: C.primary, backgroundColor: C.primary }]}
          onPress={onTakePhoto} activeOpacity={0.8}>
          <MaterialIcons name="camera-alt" size={20} color="#fff" />
          <Text style={[st.photoBtnText, { color: '#fff' }]}>Camera</Text>
        </TouchableOpacity>
      </View>

      {photo && (
        <TouchableOpacity style={st.photoRemoveBtn} onPress={onRemovePhoto}>
          <MaterialIcons name="delete-outline" size={16} color={C.error} />
          <Text style={st.photoRemoveText}>Remove photo</Text>
        </TouchableOpacity>
      )}

      <InfoBox color={C.sectionD} icon="info-outline"
        text="Photo filename on disk will match the student's name exactly." />

      <SectionDivider label="Registration Summary" color={C.sectionD} />
      <View style={st.summaryGrid}>
        <SummaryRow label="Full Name"  value={fullName} />
        <SummaryRow label="Mobile"     value={refMobile.current     || '—'} />
        <SummaryRow label="DOB"        value={dobText               || '—'} />
        <SummaryRow label="Gender"     value={selGender             || '—'} />
        <SummaryRow label="Class"      value={summaryClass} />
        <SummaryRow label="Branch"     value={summaryBranch} />
        <SummaryRow label="Session"    value={summarySession} />
        <SummaryRow label="Admission"  value={selAdmission          || '—'} />
      </View>
    </SectionCard>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ModalSelect — replaces @react-native-picker/picker entirely
// Opens a bottom-sheet Modal with a FlatList. Zero Picker overhead.
// options: string[] | { label, value }[]
// ─────────────────────────────────────────────────────────────────────────────
function ModalSelect({ label, icon, value, onChange, options, placeholder, error }) {
  const [open, setOpen] = useState(false);

  // Normalise to { label, value }
  const items = useMemo(() =>
    options.map(o => typeof o === 'string' ? { label: o, value: o } : o),
  [options]);

  const displayLabel = items.find(i => i.value === value)?.label ?? '';

  const handleSelect = useCallback((v) => {
    onChange(v);
    setOpen(false);
  }, [onChange]);

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity
      style={[ms.option, item.value === value && ms.optionActive]}
      onPress={() => handleSelect(item.value)}
      activeOpacity={0.7}>
      <Text style={[ms.optionText, item.value === value && ms.optionTextActive]}>
        {item.label}
      </Text>
      {item.value === value && (
        <MaterialIcons name="check" size={18} color={C.primary} />
      )}
    </TouchableOpacity>
  ), [value, handleSelect]);

  return (
    <View style={ff.wrap}>
      <Text style={[ff.label, error && { color: C.error }]}>{label}</Text>

      <TouchableOpacity
        style={[ff.selectRow, error && ff.rowError]}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}>
        {icon && <MaterialIcons name={icon} size={17}
          color={error ? C.error : C.muted} style={ff.icon} />}
        <Text style={[ff.selectText, !displayLabel && ff.selectPlaceholder]}
          numberOfLines={1}>
          {displayLabel || placeholder}
        </Text>
        <MaterialIcons name="keyboard-arrow-down" size={20} color={C.muted}
          style={{ marginRight: 10 }} />
      </TouchableOpacity>

      {!!error && <Text style={ff.errorText}>{error}</Text>}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdrop} onPress={() => setOpen(false)} activeOpacity={1} />
          <View style={ms.sheet}>
            <View style={ms.sheetHeader}>
              <Text style={ms.sheetTitle}>{label}</Text>
              <TouchableOpacity style={ms.sheetClose} onPress={() => setOpen(false)}>
                <MaterialIcons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={items}
              keyExtractor={item => item.value}
              renderItem={renderItem}
              style={ms.list}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FieldRef — uncontrolled TextInput (no value prop → zero JS re-renders)
// ─────────────────────────────────────────────────────────────────────────────
const FieldRef = React.memo(function FieldRef({ label, icon, fieldRef, error, ...rest }) {
  const handleChange = useCallback((text) => { fieldRef.current = text; }, [fieldRef]);
  return (
    <View style={ff.wrap}>
      <Text style={[ff.label, error && { color: C.error }]}>{label}</Text>
      <View style={[ff.row, error && ff.rowError]}>
        {icon && <MaterialIcons name={icon} size={17}
          color={error ? C.error : C.muted} style={ff.icon} />}
        <TextInput style={ff.input} placeholderTextColor={C.muted}
          autoCorrect={false} onChangeText={handleChange} {...rest} />
      </View>
      {!!error && <Text style={ff.errorText}>{error}</Text>}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// StepperTabs
// ─────────────────────────────────────────────────────────────────────────────
const StepperTabs = React.memo(function StepperTabs({ step, onPress }) {
  return (
    <View style={st.stepperWrap}>
      {STEPS.map((s, i) => {
        const done = i < step, active = i === step;
        return (
          <TouchableOpacity key={s.key}
            style={[st.stepTab, active && { borderBottomColor: s.color, borderBottomWidth: 3 }]}
            onPress={() => onPress(i)} activeOpacity={0.75}>
            <View style={[st.stepIcon, active && { backgroundColor: s.color }, done && { backgroundColor: C.success }]}>
              <MaterialIcons name={done ? 'check' : s.icon} size={16}
                color={active || done ? '#fff' : C.muted} />
            </View>
            <Text style={[st.stepLabel, active && { color: s.color, fontWeight: '800' }, done && { color: C.success }]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SectionCard
// ─────────────────────────────────────────────────────────────────────────────
const SectionCard = React.memo(function SectionCard({ color, icon, title, subtitle, children }) {
  return (
    <View style={sc.card}>
      <View style={[sc.accent, { backgroundColor: color }]} />
      <View style={[sc.header, { borderBottomColor: color + '22' }]}>
        <View style={[sc.headerIcon, { backgroundColor: color + '18' }]}>
          <MaterialIcons name={icon} size={22} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sc.title}>{title}</Text>
          {subtitle && <Text style={sc.subtitle}>{subtitle}</Text>}
        </View>
      </View>
      <View style={sc.body}>{children}</View>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// DOB Modal — three FlatLists side by side (faster than Picker on Android)
// ─────────────────────────────────────────────────────────────────────────────
const DobModal = React.memo(function DobModal({
  visible, onClose, onConfirm,
  dobDay, setDobDay, dobMonth, setDobMonth, dobYear, setDobYear,
  days, months, years,
}) {
  const renderDay   = useCallback(({ item }) => (
    <TouchableOpacity style={[dob.item, item === dobDay   && dob.itemActive]} onPress={() => setDobDay(item)}>
      <Text style={[dob.itemText, item === dobDay   && dob.itemTextActive]}>{String(item).padStart(2,'0')}</Text>
    </TouchableOpacity>
  ), [dobDay]);

  const renderMonth = useCallback(({ item }) => (
    <TouchableOpacity style={[dob.item, item === dobMonth && dob.itemActive]} onPress={() => setDobMonth(item)}>
      <Text style={[dob.itemText, item === dobMonth && dob.itemTextActive]}>{MONTHS[item-1]}</Text>
    </TouchableOpacity>
  ), [dobMonth]);

  const renderYear  = useCallback(({ item }) => (
    <TouchableOpacity style={[dob.item, item === dobYear  && dob.itemActive]} onPress={() => setDobYear(item)}>
      <Text style={[dob.itemText, item === dobYear  && dob.itemTextActive]}>{String(item)}</Text>
    </TouchableOpacity>
  ), [dobYear]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.modalOverlay}>
        <View style={st.modalSheet}>
          <View style={st.modalHeader}>
            <View style={st.modalIconWrap}>
              <MaterialIcons name="event" size={22} color={C.primary} />
            </View>
            <Text style={st.modalTitle}>Date of Birth</Text>
            <TouchableOpacity style={st.modalCloseBtn} onPress={onClose}>
              <MaterialIcons name="close" size={20} color={C.muted} />
            </TouchableOpacity>
          </View>

          <View style={st.dobPreview}>
            <Text style={st.dobPreviewText}>
              {String(dobDay).padStart(2,'0')} {MONTHS[dobMonth-1]} {dobYear}
            </Text>
          </View>

          <View style={dob.cols}>
            <View style={dob.col}>
              <Text style={dob.colLabel}>Day</Text>
              <FlatList data={days} keyExtractor={String} renderItem={renderDay}
                style={dob.list} showsVerticalScrollIndicator={false} />
            </View>
            <View style={[dob.col, { flex: 1.6 }]}>
              <Text style={dob.colLabel}>Month</Text>
              <FlatList data={months} keyExtractor={String} renderItem={renderMonth}
                style={dob.list} showsVerticalScrollIndicator={false} />
            </View>
            <View style={dob.col}>
              <Text style={dob.colLabel}>Year</Text>
              <FlatList data={years} keyExtractor={String} renderItem={renderYear}
                style={dob.list} showsVerticalScrollIndicator={false} />
            </View>
          </View>

          <View style={st.modalFooter}>
            <TouchableOpacity style={st.modalCancelBtn} onPress={onClose}>
              <Text style={st.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.modalConfirmBtn} onPress={onConfirm}>
              <MaterialIcons name="check" size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={st.modalConfirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ─────────────────────────────────────────────────────────────────────────────
function RowPair({ children }) {
  if (!isTablet) return <>{children}</>;
  const arr = React.Children.toArray(children);
  return <View style={{ flexDirection: 'row', gap: 12 }}>{arr.map((c, i) => <View key={i} style={{ flex: 1 }}>{c}</View>)}</View>;
}

function SectionDivider({ label, color = C.muted }) {
  return (
    <View style={dv.row}>
      <View style={[dv.line, { backgroundColor: color + '40' }]} />
      <Text style={[dv.label, { color }]}>{label}</Text>
      <View style={[dv.line, { backgroundColor: color + '40' }]} />
    </View>
  );
}

const InfoBox = React.memo(function InfoBox({ icon, color, text }) {
  return (
    <View style={[ib.box, { backgroundColor: color + '0d', borderColor: color + '30' }]}>
      <MaterialIcons name={icon} size={16} color={color} style={{ marginTop: 1 }} />
      <Text style={[ib.text, { color }]}>{text}</Text>
    </View>
  );
});

function SummaryRow({ label, value }) {
  return (
    <View style={sr.row}>
      <Text style={sr.label}>{label}</Text>
      <Text style={sr.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safeArea:     { flex: 1, backgroundColor: C.bg },
  loaderWrap:   { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  loaderTitle:  { fontSize: 18, fontWeight: '800', color: C.text },
  loaderSub:    { fontSize: 13, color: C.muted, textAlign: 'center' },

  pageHeader:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingTop: Platform.OS === 'ios' ? 4 : 14, paddingBottom: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  backBtn:      { width: 38, height: 38, borderRadius: 12, backgroundColor: '#eef2f8', alignItems: 'center', justifyContent: 'center' },
  pageTitle:    { fontSize: 20, fontWeight: '900', color: C.text, letterSpacing: -0.3 },
  pageSub:      { fontSize: 12, color: C.muted, marginTop: 2 },
  stepPill:     { backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  stepPillText: { fontSize: 12, fontWeight: '800', color: '#fff' },

  stepperWrap:  { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border },
  stepTab:      { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 4, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  stepIcon:     { width: 30, height: 30, borderRadius: 10, backgroundColor: '#eef2f8', alignItems: 'center', justifyContent: 'center' },
  stepLabel:    { fontSize: 10, color: C.muted, fontWeight: '600', textAlign: 'center' },

  scrollContent:{ padding: 16, paddingTop: 14, paddingBottom: 24 },

  dateBtn:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14, gap: 10 },
  dateBtnText:  { flex: 1, fontSize: 14, color: C.muted },

  navRow:          { flexDirection: 'row', gap: 12, marginTop: 20 },
  navBtnBack:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.border, gap: 6 },
  navBtnBackText:  { fontSize: 15, fontWeight: '700', color: C.primary },
  navBtnNext:      { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14, elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  navBtnNextText:  { fontSize: 15, fontWeight: '800', color: '#fff' },
  submitRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },

  photoPreviewWrap:     { alignItems: 'center', marginBottom: 20 },
  photoFrame:           { alignItems: 'center', gap: 12 },
  photoPreview:         { width: 180, height: 180, borderRadius: 20, borderWidth: 3, borderColor: C.success },
  photoApprovedBadge:   { flexDirection: 'row', alignItems: 'center', backgroundColor: C.successSoft, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, gap: 6 },
  photoApprovedText:    { fontSize: 13, fontWeight: '700', color: C.success },
  photoPlaceholder:     { width: 180, height: 180, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: C.border, backgroundColor: '#fafbfc', alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoPlaceholderIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#f0f4f9', alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderTitle:{ fontSize: 14, fontWeight: '700', color: C.muted },
  photoPlaceholderSub:  { fontSize: 11, color: C.muted, textAlign: 'center', paddingHorizontal: 20 },
  photoActions:         { flexDirection: 'row', gap: 10, marginBottom: 12 },
  photoBtn:             { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 13, borderWidth: 1.5, gap: 7 },
  photoBtnText:         { fontSize: 13, fontWeight: '700' },
  photoRemoveBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, marginBottom: 16 },
  photoRemoveText:      { fontSize: 13, color: C.error, fontWeight: '600' },
  summaryGrid:          { backgroundColor: '#fafbfc', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: C.border },

  modalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet:      { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Platform.OS === 'ios' ? 36 : 24 },
  modalHeader:     { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12 },
  modalIconWrap:   { width: 42, height: 42, borderRadius: 13, backgroundColor: '#eef2f8', alignItems: 'center', justifyContent: 'center' },
  modalTitle:      { flex: 1, fontSize: 18, fontWeight: '800', color: C.text },
  modalCloseBtn:   { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f5f7fa', alignItems: 'center', justifyContent: 'center' },
  dobPreview:      { marginHorizontal: 20, marginBottom: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  dobPreviewText:  { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  modalFooter:     { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 16 },
  modalCancelBtn:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 13, backgroundColor: '#f0f4f9', borderWidth: 1.5, borderColor: C.border },
  modalCancelText: { fontSize: 15, fontWeight: '700', color: C.textSoft },
  modalConfirmBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 13, backgroundColor: C.primary },
  modalConfirmText:{ fontSize: 15, fontWeight: '700', color: '#fff' },
});

const sc = StyleSheet.create({
  card:      { backgroundColor: '#fff', borderRadius: 20, marginBottom: 16, overflow: 'hidden', elevation: 3, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  accent:    { height: 5 },
  header:    { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, gap: 12 },
  headerIcon:{ width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 16, fontWeight: '800', color: C.text },
  subtitle:  { fontSize: 12, color: C.muted, marginTop: 2 },
  body:      { padding: 16 },
});

const ff = StyleSheet.create({
  wrap:              { marginBottom: 14 },
  label:             { fontSize: 12, fontWeight: '700', color: C.textSoft, marginBottom: 6, letterSpacing: 0.2 },
  row:               { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f9fc', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, minHeight: 50, overflow: 'hidden' },
  rowError:          { borderColor: C.error, backgroundColor: C.errorSoft },
  selectRow:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f9fc', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, minHeight: 50 },
  selectText:        { flex: 1, fontSize: 14, color: C.text, paddingVertical: 14 },
  selectPlaceholder: { color: C.muted },
  icon:              { marginLeft: 13, marginRight: 6 },
  input:             { flex: 1, fontSize: 14, color: C.text, paddingVertical: 12, paddingRight: 14 },
  errorText:         { fontSize: 11, color: C.error, fontWeight: '600', marginTop: 4 },
});

// ModalSelect sheet styles
const ms = StyleSheet.create({
  overlay:         { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  backdrop:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet:           { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: height * 0.55, paddingBottom: Platform.OS === 'ios' ? 34 : 16 },
  sheetHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle:      { fontSize: 16, fontWeight: '800', color: C.text },
  sheetClose:      { width: 32, height: 32, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  list:            { paddingHorizontal: 12 },
  option:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  optionActive:    { backgroundColor: '#eef2f8', borderRadius: 10, borderBottomColor: 'transparent' },
  optionText:      { fontSize: 15, color: C.text },
  optionTextActive:{ fontWeight: '800', color: C.primary },
});

// DOB picker styles
const dob = StyleSheet.create({
  cols:        { flexDirection: 'row', height: 200, borderTopWidth: 1, borderTopColor: C.border },
  col:         { flex: 1, borderRightWidth: 1, borderRightColor: C.border },
  colLabel:    { textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.muted, paddingTop: 10, paddingBottom: 6, letterSpacing: 0.8, textTransform: 'uppercase' },
  list:        {},
  item:        { paddingVertical: 10, alignItems: 'center' },
  itemActive:  { backgroundColor: '#eef2f8', marginHorizontal: 6, borderRadius: 8 },
  itemText:    { fontSize: 14, color: C.text },
  itemTextActive:{ fontWeight: '800', color: C.primary },
});

const dv = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14, marginTop: 6 },
  line:  { flex: 1, height: 1 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
});

const ib = StyleSheet.create({
  box:  { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 14, alignItems: 'flex-start' },
  text: { flex: 1, fontSize: 12, lineHeight: 18 },
});

const sr = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#f0f4f9' },
  label: { fontSize: 12, color: C.muted, fontWeight: '600', width: 90 },
  value: { fontSize: 13, color: C.text, fontWeight: '700', flex: 1, textAlign: 'right' },
});

const addr = StyleSheet.create({
  sameToggle:       { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f0f9ff', borderWidth: 1.5, borderColor: '#bae6fd', borderRadius: 13, padding: 12, marginBottom: 16, marginTop: 4 },
  sameToggleActive: { borderColor: C_ADDRESS, backgroundColor: C_ADDRESS + '0f' },
  checkbox:         { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#cbd5e1', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  sameToggleText:   { flex: 1, fontSize: 13, color: C.textSoft, fontWeight: '600' },
});