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
const OPT_TITLE      = ['Mr','Mrs'];
const OPT_GENDER     = ['Male','Female','Other'];
const OPT_BLOOD_GROUP = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const OPT_ADMISSION = ['General','Underprivileged','Weaker Section','NRI','Management Quota'];
const OPT_PHYSICAL  = ['No','Yes'];
const OPT_MEDIUM = [
  'English', 'Hindi', 'Urdu', 'Arabic',
  'Assamese', 'Bengali', 'Dogri', 'Gujarati', 'Kannada', 'Kashmiri',
  'Maithili', 'Malayalam', 'Marathi', 'Nepali', 'Odia', 'Pali',
  'Prakrit', 'Punjabi', 'Sindhi', 'Tamil', 'Telugu',
  'Others',
];

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
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  sheet:           { backgroundColor: "#fff", borderRadius: 20, padding: 16, maxHeight: "65%", width: "100%" },
  sheetTitle:      { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:    { backgroundColor: "#eff6ff" },
  optionTxt:       { fontSize: 14, color: "#0f172a" },
  optionTxtActive: { color: "#2563eb", fontWeight: "700" },
});

export default function StudentRegistrationScreen({ navigation }) {
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
  const [regResult,   setRegResult]   = useState(null); // set after successful registration

  // Ref to the ScrollView — used to scroll back to top on every step change
  const scrollRef = useRef(null);

  // ── Select (modal picker) values ─────────────────────────────────────────
  const [selTitle,     setSelTitle]     = useState('');
  const [selGender,    setSelGender]    = useState('');
  const [selBranchId,  setSelBranchId]  = useState('');
  const [selClassId,   setSelClassId]   = useState('');
  const [selSessionId, setSelSessionId] = useState('');
  const [selAdmission,   setSelAdmission]   = useState('');
  const [selPhysical,    setSelPhysical]    = useState('');
  const [selMedium,      setSelMedium]      = useState('English');
  const [selBloodGroup,  setSelBloodGroup]  = useState('');

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

  // ── Admission Date ────────────────────────────────────────────────────────
  const [admModal, setAdmModal] = useState(false);
  const [admText,  setAdmText]  = useState('');
  const admIsoRef               = useRef('');
  const [admYear,  setAdmYear]  = useState(currentYear);
  const [admMonth, setAdmMonth] = useState(new Date().getMonth() + 1);
  const [admDay,   setAdmDay]   = useState(new Date().getDate());

  const admYears  = useMemo(() => Array.from({ length: currentYear - 1980 + 1 }, (_, i) => currentYear - i), [currentYear]);
  const admMonths = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const admDays   = useMemo(() => {
    const max = new Date(admYear, admMonth, 0).getDate();
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [admMonth, admYear]);

  useEffect(() => {
    const max = new Date(admYear, admMonth, 0).getDate();
    if (admDay > max) setAdmDay(max);
  }, [admYear, admMonth]);

  // ── Text refs — EACH DECLARED INDIVIDUALLY at top level ──────────────────
  // CRITICAL FIX: never put useRef() calls inside an object/array literal.
  // That recreates the container on every render and violates Rules of Hooks.
  const refFirstName        = useRef('');
  const refMiddleName       = useRef('');
  const refLastName         = useRef('');
  const refEmail            = useRef('');
  const refCountryCode      = useRef('+91');
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

  // Optional demographic refs
  const refAdmissionNumber  = useRef('');
  const refCaste            = useRef('');
  const refReligion         = useRef('');

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

  // ── Clear a single field error ────────────────────────────────────────────
  const clearError = useCallback((key) => {
    setFieldErrors(prev => {
      if (!prev[key]) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // ── DOB confirm ───────────────────────────────────────────────────────────
  const confirmDob = useCallback(() => {
    const iso     = `${dobYear}-${String(dobMonth).padStart(2,'0')}-${String(dobDay).padStart(2,'0')}`;
    const display = `${String(dobDay).padStart(2,'0')} ${MONTHS[dobMonth-1]} ${dobYear}`;
    dobIsoRef.current = iso;
    setDobText(display);
    setDobModal(false);
    setFieldErrors(prev => { const { dob: _, ...rest } = prev; return rest; });
  }, [dobYear, dobMonth, dobDay]);

  // ── Admission Date confirm ────────────────────────────────────────────────
  const confirmAdm = useCallback(() => {
    const iso     = `${admYear}-${String(admMonth).padStart(2,'0')}-${String(admDay).padStart(2,'0')}`;
    const display = `${String(admDay).padStart(2,'0')} ${MONTHS[admMonth-1]} ${admYear}`;
    admIsoRef.current = iso;
    setAdmText(display);
    setAdmModal(false);
  }, [admYear, admMonth, admDay]);

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
  const onMediumChange    = useCallback((v) => setSelMedium(v),    []);
  const onGenderChange    = useCallback((v) => setSelGender(v),    []);
  const onBranchChange    = useCallback((v) => setSelBranchId(v),  []);
  const onClassChange     = useCallback((v) => setSelClassId(v),   []);
  const onSessionChange   = useCallback((v) => setSelSessionId(v), []);
  const onAdmissionChange  = useCallback((v) => setSelAdmission(v),  []);
  const onPhysicalChange   = useCallback((v) => setSelPhysical(v),   []);
  const onBloodGroupChange = useCallback((v) => setSelBloodGroup(v), []);

  // ── Validate ──────────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    const e = {};
    if (!refFirstName.current?.trim())       e.firstName    = 'First name is required';
    if (!selGender)                          e.gender       = 'Gender is required';
    if (!dobIsoRef.current)                  e.dob          = 'Date of birth is required';
    if (!refMobile.current?.trim())          e.mobileNumber = 'Mobile number is required';
    if (!selClassId)                         e.classId      = 'Class is required';
    if (!selBranchId)                        e.branchId     = 'Branch is required';
    if (!selSessionId)                       e.sessionId    = 'Session is required';
    if (!selMedium)                          e.courseMedium = 'Course medium is required';
    if (!refFatherName.current?.trim())      e.fatherName   = "Father's name is required";
    if (!refMotherName.current?.trim())      e.motherName   = "Mother's name is required";
    if (!refCAddressLine1.current?.trim())   e.cAddressLine1 = 'Current address line 1 is required';
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }, [selGender, selClassId, selBranchId, selSessionId, selMedium]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetAll = useCallback(() => {
    setFormKey(k => k + 1);   // remounts all TextInputs
    refFirstName.current = ''; refMiddleName.current = ''; refLastName.current = '';
    refEmail.current = ''; refCountryCode.current = '+91'; refMobile.current = ''; refPlaceOfBirth.current = '';
    refNationality.current = ''; refCourseMedium.current = '';
    refAdmissionNumber.current = ''; refCaste.current = ''; refReligion.current = '';
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
    setSelMedium('English'); setSelBloodGroup('');
    setDobText(''); dobIsoRef.current = '';
    setAdmText(''); admIsoRef.current = '';
    setPhoto(null); setFieldErrors({}); setStep(0);
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const onSubmit = useCallback(async () => {
    if (!validate()) {
      // Jump to the first step that has an error so user can see what's missing
      const errs = {};
      if (!refFirstName.current?.trim())       errs.firstName    = true;
      if (!selGender)                          errs.gender       = true;
      if (!dobIsoRef.current)                  errs.dob          = true;
      if (!refMobile.current?.trim())          errs.mobileNumber = true;
      if (!selClassId)                         errs.classId      = true;
      if (!selBranchId)                        errs.branchId     = true;
      if (!selSessionId)                       errs.sessionId    = true;
      const step0Keys = ['firstName','gender','dob','mobileNumber','classId','branchId','sessionId'];
      const step1Keys = ['courseMedium'];
      const step2Keys = ['fatherName','motherName'];
      if (step0Keys.some(k => errs[k]))       setStep(0);
      else if (!selMedium)                     setStep(1);
      else if (step2Keys.some(k => errs[k]) || !refFatherName.current?.trim() || !refMotherName.current?.trim()) setStep(2);
      else                                     setStep(3);
      Alert.alert('Validation Error', 'Please fill all required fields.');
      return;
    }
    const formData = {
      title:                  selTitle,
      firstName:              refFirstName.current,
      middleName:             refMiddleName.current,
      lastName:               refLastName.current,
      emailAddress:           refEmail.current,
      mobileNumber:           (refCountryCode.current.trim() || '+91') + refMobile.current.trim(),
      gender:                 selGender,
      dob:                    dobIsoRef.current,
      admissionDate:          admIsoRef.current || null,
      placeOfBirth:           refPlaceOfBirth.current,
      nationality:            refNationality.current,
      classId:                selClassId,
      branchId:               selBranchId,
      sessionId:              selSessionId,
      courseMedium:           selMedium,
      admissionType:          selAdmission,
      admissionNumber:        refAdmissionNumber.current,
      caste:                  refCaste.current,
      religion:               refReligion.current,
      bloodGroup:             selBloodGroup,
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
      const fullName = [selTitle, refFirstName.current, refMiddleName.current, refLastName.current]
        .filter(Boolean).join(' ').trim() || 'Student';
      setRegResult({
        name:         fullName,
        regNo:        res.registration_no ?? '—',
        emailSent:    res.email_sent   === true,
        emailAddress: res.email_address ?? '',
      });
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
          <Text style={st.pageTitle}>Student Registration</Text>
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
                refLastName={refLastName} refEmail={refEmail}
                refCountryCode={refCountryCode} refMobile={refMobile}
                refPlaceOfBirth={refPlaceOfBirth} refNationality={refNationality}
                refAdmissionNumber={refAdmissionNumber}
                refCaste={refCaste} refReligion={refReligion}
                // select values + handlers
                selTitle={selTitle}     onTitleChange={onTitleChange}
                selGender={selGender}   onGenderChange={onGenderChange}
                selBranchId={selBranchId} onBranchChange={onBranchChange}
                selClassId={selClassId}   onClassChange={onClassChange}
                selSessionId={selSessionId} onSessionChange={onSessionChange}
                branchItems={branchItems} classItems={classItems} sessionItems={sessionItems}
                // blood group
                selBloodGroup={selBloodGroup} onBloodGroupChange={onBloodGroupChange}
                // dob
                dobText={dobText} onDobPress={() => setDobModal(true)}
                // admission date
                admText={admText} onAdmPress={() => setAdmModal(true)}
                // errors
                errors={fieldErrors} clearError={clearError}
              />
            )}

            {step === 1 && (
              <StepAcademic
                selMedium={selMedium}       onMediumChange={onMediumChange}
                selAdmission={selAdmission} onAdmissionChange={onAdmissionChange}
                selPhysical={selPhysical}   onPhysicalChange={onPhysicalChange}
                errors={fieldErrors} clearError={clearError}
              />
            )}

            {step === 2 && (
              <StepParent
                refFatherName={refFatherName} refFatherEducation={refFatherEducation}
                refFatherAge={refFatherAge}   refFatherOccupation={refFatherOccupation}
                refMotherName={refMotherName} refMotherEducation={refMotherEducation}
                refMotherAge={refMotherAge}   refMotherOccupation={refMotherOccupation}
                errors={fieldErrors} clearError={clearError}
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
                errors={fieldErrors} clearError={clearError}
              />
            )}

            {step === 4 && (
              <StepPhoto
                photo={photo}
                onPickImage={pickImage} onTakePhoto={takePhoto}
                onRemovePhoto={() => setPhoto(null)}
                selTitle={selTitle} refFirstName={refFirstName}
                refMiddleName={refMiddleName} refLastName={refLastName}
                refMobile={refMobile} dobText={dobText} admText={admText}
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
                onPress={() => {
                  const e = {};
                  if (step === 0) {
                    if (!refFirstName.current?.trim())      e.firstName    = 'First name is required';
                    if (!selGender)                         e.gender       = 'Gender is required';
                    if (!dobIsoRef.current)                 e.dob          = 'Date of birth is required';
                    if (!refMobile.current?.trim())         e.mobileNumber = 'Mobile number is required';
                    if (!selClassId)                        e.classId      = 'Class is required';
                    if (!selBranchId)                       e.branchId     = 'Branch is required';
                    if (!selSessionId)                      e.sessionId    = 'Session is required';
                  } else if (step === 1) {
                    
                    if (!selMedium)                         e.courseMedium  = 'Course medium is required';
                  } else if (step === 2) {
                    if (!refFatherName.current?.trim())     e.fatherName    = "Father's name is required";
                    if (!refMotherName.current?.trim())     e.motherName    = "Mother's name is required";
                  } else if (step === 3) {
                    if (!refCAddressLine1.current?.trim())  e.cAddressLine1 = 'Current address line 1 is required';
                  }
                  if (Object.keys(e).length > 0) {
                    setFieldErrors(e);
                    Alert.alert('Required Fields', 'Please fill all required fields before continuing.');
                    return;
                  }
                  setFieldErrors({});
                  setStep(s => s + 1);
                }}>
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

      {/* Admission Date Modal */}
      <DobModal
        title="Admission Date"
        visible={admModal}
        onClose={() => setAdmModal(false)}
        onConfirm={confirmAdm}
        dobDay={admDay} setDobDay={setAdmDay}
        dobMonth={admMonth} setDobMonth={setAdmMonth}
        dobYear={admYear} setDobYear={setAdmYear}
        days={admDays} months={admMonths} years={admYears}
      />

      {/* ── Registration Success Modal ── */}
      <RegistrationSuccessModal
        visible={!!regResult}
        data={regResult}
        onRegisterAnother={() => setRegResult(null)}
        onDone={() => { setRegResult(null); navigation?.goBack(); }}
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
  refFirstName, refMiddleName, refLastName, refEmail, refCountryCode, refMobile,
  refPlaceOfBirth, refNationality,
  refAdmissionNumber, refCaste, refReligion,
  selTitle, onTitleChange, selGender, onGenderChange,
  selBranchId, onBranchChange, selClassId, onClassChange,
  selSessionId, onSessionChange,
  branchItems, classItems, sessionItems,
  selBloodGroup, onBloodGroupChange,
  dobText, onDobPress, admText, onAdmPress, errors, clearError,
}) {
  return (
    <SectionCard color={C.sectionA} icon="person"
      title="Student Information" subtitle="Personal & contact details">

      <RowPair>
        <ModalSelect label="Title" icon="title" value={selTitle}
          onChange={onTitleChange} options={OPT_TITLE} placeholder="Select Title" />
        <ModalSelect label="Gender *" icon="wc" value={selGender}
          onChange={onGenderChange} options={OPT_GENDER} placeholder="Select Gender"
          error={errors.gender} onClearError={() => clearError('gender')} />
      </RowPair>

      <RowPair>
        <FieldRef label="First Name *" icon="person-outline"
          fieldRef={refFirstName} placeholder="First name" error={errors.firstName}
          onClearError={() => clearError('firstName')} />
        <FieldRef label="Middle Name" icon="person-outline"
          fieldRef={refMiddleName} placeholder="Middle name" />
      </RowPair>

      <FieldRef label="Last Name" icon="person-outline"
        fieldRef={refLastName} placeholder="Last name" />

      <RowPair>
        <FieldRef label="Email Address" icon="mail-outline"
          fieldRef={refEmail} placeholder="email@example.com"
          keyboardType="email-address" autoCapitalize="none" />
        <PhoneInputRow
          refCountryCode={refCountryCode}
          refMobile={refMobile}
          error={errors.mobileNumber}
          onClearError={() => clearError('mobileNumber')}
        />
      </RowPair>

      <Text style={[ff.label, errors.dob && { color: C.error }]}>Date of Birth *</Text>
      <TouchableOpacity style={[st.dateBtn, errors.dob && { borderColor: C.error }]} onPress={onDobPress}>
        <MaterialIcons name="event" size={18} color={errors.dob ? C.error : dobText ? C.primary : C.muted} />
        <Text style={[st.dateBtnText, dobText && { color: C.text, fontWeight: '700' }]}>
          {dobText || 'Tap to select date of birth'}
        </Text>
        <MaterialIcons name="chevron-right" size={18} color={C.muted} />
      </TouchableOpacity>
      {!!errors.dob && <Text style={ff.errorText}>{errors.dob}</Text>}

      <Text style={ff.label}>Admission Date</Text>
      <TouchableOpacity style={st.dateBtn} onPress={onAdmPress}>
        <MaterialIcons name="event-available" size={18} color={admText ? C.primary : C.muted} />
        <Text style={[st.dateBtnText, admText && { color: C.text, fontWeight: '700' }]}>
          {admText || 'Tap to select admission date (optional)'}
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
        error={errors.branchId} onClearError={() => clearError('branchId')} />
      <ModalSelect label="Class *" icon="class" value={selClassId}
        onChange={onClassChange} options={classItems} placeholder="Select Class"
        error={errors.classId} onClearError={() => clearError('classId')} />
      <ModalSelect label="Session *" icon="date-range" value={selSessionId}
        onChange={onSessionChange} options={sessionItems} placeholder="Select Session"
        error={errors.sessionId} onClearError={() => clearError('sessionId')} />

      <SectionDivider label="Optional Details" />
      <FieldRef label="Admission Number" icon="confirmation-number"
        fieldRef={refAdmissionNumber} placeholder="e.g. ADM-2025-001" />
      <RowPair>
        <FieldRef label="Caste" icon="people" fieldRef={refCaste} placeholder="e.g. General" />
        <FieldRef label="Religion" icon="church" fieldRef={refReligion} placeholder="e.g. Hindu" />
      </RowPair>
      <ModalSelect label="Blood Group" icon="bloodtype"
        value={selBloodGroup} onChange={onBloodGroupChange}
        options={OPT_BLOOD_GROUP} placeholder="Select Blood Group" />
    </SectionCard>
  );
});

const StepAcademic = React.memo(function StepAcademic({
  selMedium, onMediumChange, selAdmission, onAdmissionChange, selPhysical, onPhysicalChange,
  errors, clearError,
}) {
  return (
    <SectionCard color={C.sectionB} icon="school"
      title="Academic & Health Details"
      subtitle="Learning preferences and admission profile">
      <ModalSelect label="Course Medium *" icon="translate"
        value={selMedium} onChange={onMediumChange}
        options={OPT_MEDIUM} placeholder="Select Medium"
        error={errors?.courseMedium} onClearError={() => clearError('courseMedium')} />
      <ModalSelect label="Admission Type / Category" icon="layers"
        value={selAdmission} onChange={onAdmissionChange}
        options={OPT_ADMISSION} placeholder="Select Admission Type"
        error={errors?.admissionType} />
      <ModalSelect label="Physically Challenged?" icon="accessible"
        value={selPhysical} onChange={onPhysicalChange}
        options={OPT_PHYSICAL} placeholder="Select..."
        error={errors?.physicalStatus} />
      <InfoBox color={C.sectionB} icon="info-outline"
        text="Physical challenge status is used only for government reporting." />
    </SectionCard>
  );
});

const StepParent = React.memo(function StepParent({
  refFatherName, refFatherEducation, refFatherAge, refFatherOccupation,
  refMotherName, refMotherEducation, refMotherAge, refMotherOccupation,
  errors, clearError,
}) {
  return (
    <SectionCard color={C.sectionC} icon="family-restroom"
      title="Parent Information" subtitle="Primary guardian and family details">
      <SectionDivider label="Father's Details" color="#c45c1a" />
      <RowPair>
        <FieldRef label="Father's Name *" icon="person" fieldRef={refFatherName} placeholder="Full name"
          error={errors?.fatherName} onClearError={() => clearError('fatherName')} />
        <FieldRef label="Father's Occupation" icon="work" fieldRef={refFatherOccupation} placeholder="Occupation" />
      </RowPair>
      <RowPair>
        <FieldRef label="Father's Education" icon="school" fieldRef={refFatherEducation} placeholder="Qualification" />
        <FieldRef label="Father's Age" icon="cake" fieldRef={refFatherAge} placeholder="Age" keyboardType="number-pad" />
      </RowPair>
      <SectionDivider label="Mother's Details" color="#c45c1a" />
      <RowPair>
        <FieldRef label="Mother's Name *" icon="person" fieldRef={refMotherName} placeholder="Full name"
          error={errors?.motherName} onClearError={() => clearError('motherName')} />
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
  errors, clearError,
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
      <FieldRef label="Address Line 1 *" icon="home" fieldRef={refCLine1} placeholder="House / Flat / Building"
        error={errors?.cAddressLine1} onClearError={() => clearError('cAddressLine1')} />
      <FieldRef label="Address Line 2" icon="apartment"  fieldRef={refCLine2}  placeholder="Street / Colony / Area" />
      <RowPair>
        <FieldRef label="City"     icon="location-city"  fieldRef={refCCity}  placeholder="City" />
        <FieldRef label="State"    icon="map"            fieldRef={refCState} placeholder="State" />
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
        <FieldRef label="City"     icon="location-city"  fieldRef={refPCity}  placeholder="City"
          defaultValue={sameAsCurrent ? refCCity.current : undefined} />
        <FieldRef label="State"    icon="map"            fieldRef={refPState} placeholder="State"
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
  refMobile, dobText, admText, selGender, summaryClass, summaryBranch, summarySession, selAdmission,
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
        <SummaryRow label="Adm. Date"  value={admText               || '—'} />
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
function ModalSelect({ label, icon, value, onChange, options, placeholder, error, onClearError }) {
  const [open, setOpen] = useState(false);

  // Normalise to { label, value }
  const items = useMemo(() =>
    options.map(o => typeof o === 'string' ? { label: o, value: o } : o),
  [options]);

  const displayLabel = items.find(i => i.value === value)?.label ?? '';

  const handleSelect = useCallback((v) => {
    onChange(v);
    if (v && onClearError) onClearError();
    setOpen(false);
  }, [onChange, onClearError]);

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

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
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
// PhoneInputRow — country code prefix + mobile number, always inline
// ─────────────────────────────────────────────────────────────────────────────
// All 195 UN-recognised countries + major territories, sorted A-Z by country name.
// India is pinned first for quick access since it's the most common use case.
const COMMON_CODES = [
  { label: '🇮🇳 India (+91)',                         value: '+91'   },
  { label: '🇦🇫 Afghanistan (+93)',                   value: '+93'   },
  { label: '🇦🇱 Albania (+355)',                      value: '+355'  },
  { label: '🇩🇿 Algeria (+213)',                      value: '+213'  },
  { label: '🇦🇩 Andorra (+376)',                      value: '+376'  },
  { label: '🇦🇴 Angola (+244)',                       value: '+244'  },
  { label: '🇦🇬 Antigua & Barbuda (+1268)',           value: '+1268' },
  { label: '🇦🇷 Argentina (+54)',                     value: '+54'   },
  { label: '🇦🇲 Armenia (+374)',                      value: '+374'  },
  { label: '🇦🇺 Australia (+61)',                     value: '+61'   },
  { label: '🇦🇹 Austria (+43)',                       value: '+43'   },
  { label: '🇦🇿 Azerbaijan (+994)',                   value: '+994'  },
  { label: '🇧🇸 Bahamas (+1242)',                     value: '+1242' },
  { label: '🇧🇭 Bahrain (+973)',                      value: '+973'  },
  { label: '🇧🇩 Bangladesh (+880)',                   value: '+880'  },
  { label: '🇧🇧 Barbados (+1246)',                    value: '+1246' },
  { label: '🇧🇾 Belarus (+375)',                      value: '+375'  },
  { label: '🇧🇪 Belgium (+32)',                       value: '+32'   },
  { label: '🇧🇿 Belize (+501)',                       value: '+501'  },
  { label: '🇧🇯 Benin (+229)',                        value: '+229'  },
  { label: '🇧🇹 Bhutan (+975)',                       value: '+975'  },
  { label: '🇧🇴 Bolivia (+591)',                      value: '+591'  },
  { label: '🇧🇦 Bosnia & Herzegovina (+387)',         value: '+387'  },
  { label: '🇧🇼 Botswana (+267)',                     value: '+267'  },
  { label: '🇧🇷 Brazil (+55)',                        value: '+55'   },
  { label: '🇧🇳 Brunei (+673)',                       value: '+673'  },
  { label: '🇧🇬 Bulgaria (+359)',                     value: '+359'  },
  { label: '🇧🇫 Burkina Faso (+226)',                 value: '+226'  },
  { label: '🇧🇮 Burundi (+257)',                      value: '+257'  },
  { label: '🇨🇻 Cabo Verde (+238)',                   value: '+238'  },
  { label: '🇰🇭 Cambodia (+855)',                     value: '+855'  },
  { label: '🇨🇲 Cameroon (+237)',                     value: '+237'  },
  { label: '🇨🇦 Canada (+1)',                         value: '+1'    },
  { label: '🇨🇫 Central African Republic (+236)',     value: '+236'  },
  { label: '🇹🇩 Chad (+235)',                         value: '+235'  },
  { label: '🇨🇱 Chile (+56)',                         value: '+56'   },
  { label: '🇨🇳 China (+86)',                         value: '+86'   },
  { label: '🇨🇴 Colombia (+57)',                      value: '+57'   },
  { label: '🇰🇲 Comoros (+269)',                      value: '+269'  },
  { label: '🇨🇩 Congo (DRC) (+243)',                  value: '+243'  },
  { label: '🇨🇬 Congo (Republic) (+242)',             value: '+242'  },
  { label: '🇨🇷 Costa Rica (+506)',                   value: '+506'  },
  { label: '🇨🇮 Côte d\'Ivoire (+225)',               value: '+225'  },
  { label: '🇭🇷 Croatia (+385)',                      value: '+385'  },
  { label: '🇨🇺 Cuba (+53)',                          value: '+53'   },
  { label: '🇨🇾 Cyprus (+357)',                       value: '+357'  },
  { label: '🇨🇿 Czech Republic (+420)',               value: '+420'  },
  { label: '🇩🇰 Denmark (+45)',                       value: '+45'   },
  { label: '🇩🇯 Djibouti (+253)',                     value: '+253'  },
  { label: '🇩🇲 Dominica (+1767)',                    value: '+1767' },
  { label: '🇩🇴 Dominican Republic (+1809)',          value: '+1809' },
  { label: '🇪🇨 Ecuador (+593)',                      value: '+593'  },
  { label: '🇪🇬 Egypt (+20)',                         value: '+20'   },
  { label: '🇸🇻 El Salvador (+503)',                  value: '+503'  },
  { label: '🇬🇶 Equatorial Guinea (+240)',            value: '+240'  },
  { label: '🇪🇷 Eritrea (+291)',                      value: '+291'  },
  { label: '🇪🇪 Estonia (+372)',                      value: '+372'  },
  { label: '🇸🇿 Eswatini (+268)',                     value: '+268'  },
  { label: '🇪🇹 Ethiopia (+251)',                     value: '+251'  },
  { label: '🇫🇯 Fiji (+679)',                         value: '+679'  },
  { label: '🇫🇮 Finland (+358)',                      value: '+358'  },
  { label: '🇫🇷 France (+33)',                        value: '+33'   },
  { label: '🇬🇦 Gabon (+241)',                        value: '+241'  },
  { label: '🇬🇲 Gambia (+220)',                       value: '+220'  },
  { label: '🇬🇪 Georgia (+995)',                      value: '+995'  },
  { label: '🇩🇪 Germany (+49)',                       value: '+49'   },
  { label: '🇬🇭 Ghana (+233)',                        value: '+233'  },
  { label: '🇬🇷 Greece (+30)',                        value: '+30'   },
  { label: '🇬🇩 Grenada (+1473)',                     value: '+1473' },
  { label: '🇬🇹 Guatemala (+502)',                    value: '+502'  },
  { label: '🇬🇳 Guinea (+224)',                       value: '+224'  },
  { label: '🇬🇼 Guinea-Bissau (+245)',                value: '+245'  },
  { label: '🇬🇾 Guyana (+592)',                       value: '+592'  },
  { label: '🇭🇹 Haiti (+509)',                        value: '+509'  },
  { label: '🇭🇳 Honduras (+504)',                     value: '+504'  },
  { label: '🇭🇺 Hungary (+36)',                       value: '+36'   },
  { label: '🇮🇸 Iceland (+354)',                      value: '+354'  },
  { label: '🇮🇩 Indonesia (+62)',                     value: '+62'   },
  { label: '🇮🇷 Iran (+98)',                          value: '+98'   },
  { label: '🇮🇶 Iraq (+964)',                         value: '+964'  },
  { label: '🇮🇪 Ireland (+353)',                      value: '+353'  },
  { label: '🇮🇱 Israel (+972)',                       value: '+972'  },
  { label: '🇮🇹 Italy (+39)',                         value: '+39'   },
  { label: '🇯🇲 Jamaica (+1876)',                     value: '+1876' },
  { label: '🇯🇵 Japan (+81)',                         value: '+81'   },
  { label: '🇯🇴 Jordan (+962)',                       value: '+962'  },
  { label: '🇰🇿 Kazakhstan (+7)',                     value: '+7'    },
  { label: '🇰🇪 Kenya (+254)',                        value: '+254'  },
  { label: '🇰🇮 Kiribati (+686)',                     value: '+686'  },
  { label: '🇽🇰 Kosovo (+383)',                       value: '+383'  },
  { label: '🇰🇼 Kuwait (+965)',                       value: '+965'  },
  { label: '🇰🇬 Kyrgyzstan (+996)',                   value: '+996'  },
  { label: '🇱🇦 Laos (+856)',                         value: '+856'  },
  { label: '🇱🇻 Latvia (+371)',                       value: '+371'  },
  { label: '🇱🇧 Lebanon (+961)',                      value: '+961'  },
  { label: '🇱🇸 Lesotho (+266)',                      value: '+266'  },
  { label: '🇱🇷 Liberia (+231)',                      value: '+231'  },
  { label: '🇱🇾 Libya (+218)',                        value: '+218'  },
  { label: '🇱🇮 Liechtenstein (+423)',                value: '+423'  },
  { label: '🇱🇹 Lithuania (+370)',                    value: '+370'  },
  { label: '🇱🇺 Luxembourg (+352)',                   value: '+352'  },
  { label: '🇲🇬 Madagascar (+261)',                   value: '+261'  },
  { label: '🇲🇼 Malawi (+265)',                       value: '+265'  },
  { label: '🇲🇾 Malaysia (+60)',                      value: '+60'   },
  { label: '🇲🇻 Maldives (+960)',                     value: '+960'  },
  { label: '🇲🇱 Mali (+223)',                         value: '+223'  },
  { label: '🇲🇹 Malta (+356)',                        value: '+356'  },
  { label: '🇲🇭 Marshall Islands (+692)',             value: '+692'  },
  { label: '🇲🇷 Mauritania (+222)',                   value: '+222'  },
  { label: '🇲🇺 Mauritius (+230)',                    value: '+230'  },
  { label: '🇲🇽 Mexico (+52)',                        value: '+52'   },
  { label: '🇫🇲 Micronesia (+691)',                   value: '+691'  },
  { label: '🇲🇩 Moldova (+373)',                      value: '+373'  },
  { label: '🇲🇨 Monaco (+377)',                       value: '+377'  },
  { label: '🇲🇳 Mongolia (+976)',                     value: '+976'  },
  { label: '🇲🇪 Montenegro (+382)',                   value: '+382'  },
  { label: '🇲🇦 Morocco (+212)',                      value: '+212'  },
  { label: '🇲🇿 Mozambique (+258)',                   value: '+258'  },
  { label: '🇲🇲 Myanmar (+95)',                       value: '+95'   },
  { label: '🇳🇦 Namibia (+264)',                      value: '+264'  },
  { label: '🇳🇷 Nauru (+674)',                        value: '+674'  },
  { label: '🇳🇵 Nepal (+977)',                        value: '+977'  },
  { label: '🇳🇱 Netherlands (+31)',                   value: '+31'   },
  { label: '🇳🇿 New Zealand (+64)',                   value: '+64'   },
  { label: '🇳🇮 Nicaragua (+505)',                    value: '+505'  },
  { label: '🇳🇪 Niger (+227)',                        value: '+227'  },
  { label: '🇳🇬 Nigeria (+234)',                      value: '+234'  },
  { label: '🇲🇰 North Macedonia (+389)',              value: '+389'  },
  { label: '🇳🇴 Norway (+47)',                        value: '+47'   },
  { label: '🇴🇲 Oman (+968)',                         value: '+968'  },
  { label: '🇵🇰 Pakistan (+92)',                      value: '+92'   },
  { label: '🇵🇼 Palau (+680)',                        value: '+680'  },
  { label: '🇵🇸 Palestine (+970)',                    value: '+970'  },
  { label: '🇵🇦 Panama (+507)',                       value: '+507'  },
  { label: '🇵🇬 Papua New Guinea (+675)',             value: '+675'  },
  { label: '🇵🇾 Paraguay (+595)',                     value: '+595'  },
  { label: '🇵🇪 Peru (+51)',                          value: '+51'   },
  { label: '🇵🇭 Philippines (+63)',                   value: '+63'   },
  { label: '🇵🇱 Poland (+48)',                        value: '+48'   },
  { label: '🇵🇹 Portugal (+351)',                     value: '+351'  },
  { label: '🇶🇦 Qatar (+974)',                        value: '+974'  },
  { label: '🇷🇴 Romania (+40)',                       value: '+40'   },
  { label: '🇷🇺 Russia (+7)',                         value: '+7'    },
  { label: '🇷🇼 Rwanda (+250)',                       value: '+250'  },
  { label: '🇰🇳 Saint Kitts & Nevis (+1869)',        value: '+1869' },
  { label: '🇱🇨 Saint Lucia (+1758)',                value: '+1758' },
  { label: '🇻🇨 Saint Vincent & Grenadines (+1784)', value: '+1784' },
  { label: '🇼🇸 Samoa (+685)',                        value: '+685'  },
  { label: '🇸🇲 San Marino (+378)',                   value: '+378'  },
  { label: '🇸🇹 São Tomé & Príncipe (+239)',          value: '+239'  },
  { label: '🇸🇦 Saudi Arabia (+966)',                 value: '+966'  },
  { label: '🇸🇳 Senegal (+221)',                      value: '+221'  },
  { label: '🇷🇸 Serbia (+381)',                       value: '+381'  },
  { label: '🇸🇨 Seychelles (+248)',                   value: '+248'  },
  { label: '🇸🇱 Sierra Leone (+232)',                 value: '+232'  },
  { label: '🇸🇬 Singapore (+65)',                     value: '+65'   },
  { label: '🇸🇰 Slovakia (+421)',                     value: '+421'  },
  { label: '🇸🇮 Slovenia (+386)',                     value: '+386'  },
  { label: '🇸🇧 Solomon Islands (+677)',              value: '+677'  },
  { label: '🇸🇴 Somalia (+252)',                      value: '+252'  },
  { label: '🇿🇦 South Africa (+27)',                  value: '+27'   },
  { label: '🇸🇸 South Sudan (+211)',                  value: '+211'  },
  { label: '🇪🇸 Spain (+34)',                         value: '+34'   },
  { label: '🇱🇰 Sri Lanka (+94)',                     value: '+94'   },
  { label: '🇸🇩 Sudan (+249)',                        value: '+249'  },
  { label: '🇸🇷 Suriname (+597)',                     value: '+597'  },
  { label: '🇸🇪 Sweden (+46)',                        value: '+46'   },
  { label: '🇨🇭 Switzerland (+41)',                   value: '+41'   },
  { label: '🇸🇾 Syria (+963)',                        value: '+963'  },
  { label: '🇹🇼 Taiwan (+886)',                       value: '+886'  },
  { label: '🇹🇯 Tajikistan (+992)',                   value: '+992'  },
  { label: '🇹🇿 Tanzania (+255)',                     value: '+255'  },
  { label: '🇹🇭 Thailand (+66)',                      value: '+66'   },
  { label: '🇹🇱 Timor-Leste (+670)',                  value: '+670'  },
  { label: '🇹🇬 Togo (+228)',                         value: '+228'  },
  { label: '🇹🇴 Tonga (+676)',                        value: '+676'  },
  { label: '🇹🇹 Trinidad & Tobago (+1868)',           value: '+1868' },
  { label: '🇹🇳 Tunisia (+216)',                      value: '+216'  },
  { label: '🇹🇷 Turkey (+90)',                        value: '+90'   },
  { label: '🇹🇲 Turkmenistan (+993)',                 value: '+993'  },
  { label: '🇹🇻 Tuvalu (+688)',                       value: '+688'  },
  { label: '🇺🇬 Uganda (+256)',                       value: '+256'  },
  { label: '🇺🇦 Ukraine (+380)',                      value: '+380'  },
  { label: '🇦🇪 UAE (+971)',                          value: '+971'  },
  { label: '🇬🇧 United Kingdom (+44)',                value: '+44'   },
  { label: '🇺🇸 USA (+1)',                            value: '+1'    },
  { label: '🇺🇾 Uruguay (+598)',                      value: '+598'  },
  { label: '🇺🇿 Uzbekistan (+998)',                   value: '+998'  },
  { label: '🇻🇺 Vanuatu (+678)',                      value: '+678'  },
  { label: '🇻🇦 Vatican City (+39)',                  value: '+39'   },
  { label: '🇻🇪 Venezuela (+58)',                     value: '+58'   },
  { label: '🇻🇳 Vietnam (+84)',                       value: '+84'   },
  { label: '🇾🇪 Yemen (+967)',                        value: '+967'  },
  { label: '🇿🇲 Zambia (+260)',                       value: '+260'  },
  { label: '🇿🇼 Zimbabwe (+263)',                     value: '+263'  },
];

const PhoneInputRow = React.memo(function PhoneInputRow({
  refCountryCode, refMobile, error, onClearError,
}) {
  const [ccOpen,  setCcOpen]  = React.useState(false);
  const [ccLabel, setCcLabel] = React.useState(refCountryCode.current || '+91');

  const selectCode = useCallback((val) => {
    refCountryCode.current = val;
    setCcLabel(val);
    setCcOpen(false);
  }, [refCountryCode]);

  const handleMobileChange = useCallback((text) => {
    refMobile.current = text;
    if (text.trim() && onClearError) onClearError();
  }, [refMobile, onClearError]);

  return (
    <View style={ph2.wrap}>
      <Text style={[ff.label, error && { color: C.error }]}>Mobile Number *</Text>
      <View style={ph2.row}>
        {/* Country code picker button */}
        <TouchableOpacity
          style={[ph2.ccBtn, error && ph2.ccBtnError]}
          onPress={() => setCcOpen(true)}
          activeOpacity={0.7}
        >
          <MaterialIcons name="phone-iphone" size={15} color={error ? C.error : C.muted} />
          <Text style={[ph2.ccText, error && { color: C.error }]}>{ccLabel}</Text>
          <MaterialIcons name="arrow-drop-down" size={16} color={C.muted} />
        </TouchableOpacity>

        {/* Number input */}
        <View style={[ph2.numBox, error && ph2.numBoxError]}>
          <TextInput
            style={ph2.numInput}
            placeholderTextColor={C.muted}
            placeholder="Mobile number"
            keyboardType="phone-pad"
            defaultValue={refMobile.current ?? ''}
            onChangeText={handleMobileChange}
            autoCorrect={false}
          />
        </View>
      </View>
      {!!error && <Text style={ff.errorText}>{typeof error === 'string' ? error : 'Mobile number is required'}</Text>}

      {/* Country code picker modal */}
      <Modal visible={ccOpen} transparent animationType="slide" onRequestClose={() => setCcOpen(false)}>
        <TouchableOpacity style={ph2.overlay} onPress={() => setCcOpen(false)} activeOpacity={1}>
          <View style={ph2.sheet}>
            <View style={ph2.sheetHeader}>
              <Text style={ph2.sheetTitle}>Select Country Code</Text>
              <TouchableOpacity onPress={() => setCcOpen(false)}>
                <MaterialIcons name="close" size={22} color={C.muted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={COMMON_CODES}
              keyExtractor={(item, i) => item.value + i}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[ph2.ccOption, item.value === ccLabel && ph2.ccOptionActive]}
                  onPress={() => selectCode(item.value)}
                >
                  <Text style={[ph2.ccOptionText, item.value === ccLabel && ph2.ccOptionTextActive]}>
                    {item.label}
                  </Text>
                  {item.value === ccLabel && <MaterialIcons name="check" size={16} color="#2563eb" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#f1f5f9' }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
});

const ph2 = StyleSheet.create({
  wrap:           { marginBottom: 14 },
  row:            { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  ccBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4,
                    borderWidth: 1, borderColor: C.border, borderRadius: 10,
                    paddingHorizontal: 10, paddingVertical: 12, backgroundColor: '#f8fafc',
                    minWidth: 82 },
  ccBtnError:     { borderColor: C.error },
  ccText:         { fontSize: 13, fontWeight: '700', color: C.text },
  numBox:         { flex: 1, flexDirection: 'row', alignItems: 'center',
                    borderWidth: 1, borderColor: C.border, borderRadius: 10,
                    paddingHorizontal: 10, backgroundColor: '#fff' },
  numBoxError:    { borderColor: C.error },
  numInput:       { flex: 1, fontSize: 14, color: C.text, paddingVertical: 12 },
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:          { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
                    paddingBottom: Platform.OS === 'ios' ? 36 : 20, maxHeight: '65%' },
  sheetHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 20, paddingVertical: 16,
                    borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  sheetTitle:     { fontSize: 16, fontWeight: '800', color: C.text },
  ccOption:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 20, paddingVertical: 14 },
  ccOptionActive: { backgroundColor: '#eff6ff' },
  ccOptionText:   { fontSize: 14, color: C.text },
  ccOptionTextActive: { color: '#2563eb', fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// FieldRef — uncontrolled TextInput (no value prop → zero JS re-renders)
// ─────────────────────────────────────────────────────────────────────────────
const FieldRef = React.memo(function FieldRef({ label, icon, fieldRef, error, onClearError, ...rest }) {
  const handleChange = useCallback((text) => {
    fieldRef.current = text;
    if (text.trim() && onClearError) onClearError();
  }, [fieldRef, onClearError]);
  return (
    <View style={ff.wrap}>
      <Text style={[ff.label, error && { color: C.error }]}>{label}</Text>
      <View style={[ff.row, error && ff.rowError]}>
        {icon && <MaterialIcons name={icon} size={17}
          color={error ? C.error : C.muted} style={ff.icon} />}
        <TextInput style={ff.input} placeholderTextColor={C.muted}
          autoCorrect={false}
          defaultValue={fieldRef.current ?? ''}
          onChangeText={handleChange} {...rest} />
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
  title = 'Date of Birth',
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
            <Text style={st.modalTitle}>{title}</Text>
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
// Registration Success Modal
// Shows registration number + email delivery status after successful submit.
// ─────────────────────────────────────────────────────────────────────────────
function RegistrationSuccessModal({ visible, data, onRegisterAnother, onDone }) {
  if (!data) return null;
  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <SafeAreaView style={rsm.safe}>
        <ScrollView
          contentContainerStyle={rsm.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Top ornament */}
          <View style={rsm.topOrnament} />

          {/* Check circle */}
          <View style={rsm.checkWrap}>
            <View style={rsm.checkOuter}>
              <View style={rsm.checkInner}>
                <MaterialIcons name="check" size={44} color="#fff" />
              </View>
            </View>
          </View>

          <Text style={rsm.headline}>Registration Successful!</Text>
          <Text style={rsm.subline}>
            {data.name}'s application has been submitted and is now pending review.
          </Text>

          {/* Registration number card */}
          <View style={rsm.regCard}>
            <Text style={rsm.regCardLabel}>Registration Number</Text>
            <Text style={rsm.regCardNumber}>{data.regNo}</Text>
            <Text style={rsm.regCardHint}>Keep this number for your records</Text>
          </View>

          {/* Email status */}
          <View style={rsm.emailCard}>
            {data.emailSent ? (
              <>
                <View style={rsm.emailIconWrap}>
                  <MaterialIcons name="mark-email-read" size={22} color="#16a34a" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={rsm.emailStatusTitle}>Confirmation email sent</Text>
                  <Text style={rsm.emailStatusSub} numberOfLines={1}>{data.emailAddress}</Text>
                </View>
                <View style={rsm.emailBadge}>
                  <Text style={rsm.emailBadgeTxt}>Sent ✓</Text>
                </View>
              </>
            ) : data.emailAddress ? (
              <>
                <View style={[rsm.emailIconWrap, { backgroundColor: '#fef9c3' }]}>
                  <MaterialIcons name="mail-outline" size={22} color="#b45309" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[rsm.emailStatusTitle, { color: '#92400e' }]}>Email delivery failed</Text>
                  <Text style={rsm.emailStatusSub}>{data.emailAddress}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={[rsm.emailIconWrap, { backgroundColor: '#f1f5f9' }]}>
                  <MaterialIcons name="mail-outline" size={22} color="#94a3b8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[rsm.emailStatusTitle, { color: '#64748b' }]}>No email address provided</Text>
                  <Text style={rsm.emailStatusSub}>Add an email address to receive confirmation</Text>
                </View>
              </>
            )}
          </View>

          {/* What happens next */}
          <View style={rsm.nextCard}>
            <Text style={rsm.nextTitle}>What happens next?</Text>
            {[
              { icon: 'hourglass-top', text: 'Your application is being reviewed by the school administration.' },
              { icon: 'phone-in-talk', text: 'The school will contact you once the review is complete.' },
              { icon: 'confirmation-number', text: 'Use your Registration Number when enquiring about your application.' },
            ].map(({ icon, text }, i) => (
              <View key={i} style={rsm.nextRow}>
                <View style={rsm.nextIconWrap}>
                  <MaterialIcons name={icon} size={16} color={C.primary} />
                </View>
                <Text style={rsm.nextText}>{text}</Text>
              </View>
            ))}
          </View>

          {/* Action buttons */}
          <TouchableOpacity style={rsm.btnPrimary} onPress={onRegisterAnother} activeOpacity={0.85}>
            <MaterialIcons name="person-add" size={20} color="#fff" />
            <Text style={rsm.btnPrimaryTxt}>Register Another Student</Text>
          </TouchableOpacity>

          <TouchableOpacity style={rsm.btnSecondary} onPress={onDone} activeOpacity={0.8}>
            <Text style={rsm.btnSecondaryTxt}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const rsm = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: '#f0f9ff' },
  scroll:           { padding: 24, paddingTop: 0, paddingBottom: 40, alignItems: 'center' },

  topOrnament:      { width: '100%', height: 6, backgroundColor: C.primary, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, marginBottom: 36 },

  checkWrap:        { marginBottom: 20 },
  checkOuter:       { width: 100, height: 100, borderRadius: 50, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', shadowColor: '#16a34a', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  checkInner:       { width: 72, height: 72, borderRadius: 36, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },

  headline:         { fontSize: 26, fontWeight: '900', color: '#0f172a', textAlign: 'center', marginBottom: 8 },
  subline:          { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 22, marginBottom: 24, paddingHorizontal: 8 },

  regCard:          { width: '100%', backgroundColor: '#1a3c6e', borderRadius: 18, padding: 22, alignItems: 'center', marginBottom: 14, shadowColor: '#1a3c6e', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  regCardLabel:     { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 },
  regCardNumber:    { fontSize: 30, fontWeight: '900', color: '#fff', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', letterSpacing: 2, marginBottom: 6 },
  regCardHint:      { fontSize: 12, color: 'rgba(255,255,255,0.55)' },

  emailCard:        { width: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#e2e8f0', gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  emailIconWrap:    { width: 42, height: 42, borderRadius: 21, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center' },
  emailStatusTitle: { fontSize: 13, fontWeight: '700', color: '#15803d' },
  emailStatusSub:   { fontSize: 11, color: '#64748b', marginTop: 2 },
  emailBadge:       { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  emailBadgeTxt:    { fontSize: 11, fontWeight: '800', color: '#15803d' },

  nextCard:         { width: '100%', backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#e2e8f0', gap: 12 },
  nextTitle:        { fontSize: 13, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  nextRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  nextIconWrap:     { width: 28, height: 28, borderRadius: 8, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  nextText:         { flex: 1, fontSize: 12, color: '#475569', lineHeight: 18 },

  btnPrimary:       { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 15, marginBottom: 10, shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  btnPrimaryTxt:    { fontSize: 15, fontWeight: '800', color: '#fff' },
  btnSecondary:     { width: '100%', alignItems: 'center', paddingVertical: 14, borderRadius: 16, backgroundColor: '#f1f5f9', borderWidth: 1.5, borderColor: '#e2e8f0' },
  btnSecondaryTxt:  { fontSize: 15, fontWeight: '700', color: '#475569' },
});

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safeArea:     { flex: 1, backgroundColor: C.bg },
  loaderWrap:   { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  loaderTitle:  { fontSize: 18, fontWeight: '800', color: C.text },
  loaderSub:    { fontSize: 13, color: C.muted, textAlign: 'center' },

  pageHeader:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingTop: Platform.OS === 'ios' ? 4 : 8, paddingBottom: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  backBtn:      { width: 38, height: 38, borderRadius: 12, backgroundColor: '#eef2f8', alignItems: 'center', justifyContent: 'center' },
  pageTitle:    { fontSize: 16, fontWeight: '800', color: C.text, letterSpacing: -0.2 },
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
  overlay:         { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 20, paddingVertical: 40 },
  backdrop:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: -1 },
  sheet:           { backgroundColor: '#fff', borderRadius: 20, width: '100%', maxHeight: height * 0.65, paddingBottom: 16, overflow: 'hidden' },
  sheetHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetTitle:      { fontSize: 16, fontWeight: '800', color: C.text },
  sheetClose:      { width: 32, height: 32, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  list:            { paddingHorizontal: 12, paddingBottom: 8 },
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