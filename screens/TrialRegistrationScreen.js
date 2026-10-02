/**
 * TrialRegistrationScreen.js
 *
 * 3-step trial registration:
 *   Step 1 — School Information  (ssms_clients row)
 *   Step 2 — Admin User Account  (sawera_ssms_users row + ssms_branch row)
 *   Step 3 — Review & Submit
 *
 * Backend endpoint: POST http://192.168.4.90/ssms5/userServiceApi/registerTrial
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Keyboard, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, Modal,
  FlatList} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import AsyncStorage from "@react-native-async-storage/async-storage";

//const BASE = "http://192.168.4.90/ssms5/UserServiceApi";
import { BASE_URL } from "../Environment/EnvironmentConfig";

// Email format validator
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Safe JSON parse — strips PHP warnings prepended before the JSON body
const safeJson = (rawText) => {
  const idx = rawText.indexOf('{');
  if (idx === -1) throw new Error('Server returned a non-JSON response.');
  return JSON.parse(rawText.slice(idx));
};

// AsyncStorage key for pending verification
const PENDING_VERIFY_KEY = 'mma_pending_verify';

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  primary:  "#2563eb",
  bg:       "#f1f5f9",
  surface:  "#ffffff",
  border:   "#cbd5e1",
  muted:    "#64748b",
  text:     "#0f172a",
  textSoft: "#334155",
  success:  "#16a34a",
  error:    "#dc2626",
  placeholder: "#94a3b8",
};

const STEPS = ["School Info", "Admin Account", "Review & Submit", "Verify Email"];

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────────────────────────────────────
function InputField({ icon, label, required, ...props }) {
  return (
    <View style={ts.fieldBlock}>
      {!!label && (
        <Text style={ts.fieldLabel}>{label}{required && <Text style={{ color: C.error }}> *</Text>}</Text>
      )}
      <View style={ts.inputRow}>
        {!!icon && <Feather name={icon} size={16} color={C.muted} style={{ marginRight: 8 }} />}
        <TextInput
          style={ts.input}
          placeholderTextColor={C.placeholder}
          autoCapitalize="none"
          {...props}
        />
      </View>
    </View>
  );
}

// ── OTP Input — 6 individual digit boxes ─────────────────────────────────────
function OtpInput({ value, onChange }) {
  const inputRefs = React.useRef([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  const handleChange = (text, index) => {
    const cleaned = text.replace(/[^0-9]/g, '');
    const newVal  = value.split('');
    newVal[index] = cleaned[cleaned.length - 1] ?? '';
    const next = newVal.join('');
    onChange(next);
    // Auto-advance to next box
    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 28 }}>
      {digits.map((digit, i) => (
        <TextInput
          key={i}
          ref={ref => inputRefs.current[i] = ref}
          style={{
            width: 44, height: 54,
            borderWidth: 2,
            borderColor: digit ? C.primary : C.border,
            borderRadius: 12,
            fontSize: 22,
            fontWeight: '800',
            color: C.text,
            textAlign: 'center',
            backgroundColor: digit ? '#eff6ff' : C.surface,
          }}
          value={digit}
          onChangeText={text => handleChange(text, i)}
          onKeyPress={e => handleKeyPress(e, i)}
          keyboardType="number-pad"
          maxLength={1}
          selectTextOnFocus
        />
      ))}
    </View>
  );
}

function SectionCard({ title, subtitle, children }) {
  return (
    <View style={ts.sectionCard}>
      <Text style={ts.sectionTitle}>{title}</Text>
      {!!subtitle && <Text style={ts.sectionSub}>{subtitle}</Text>}
      {children}
    </View>
  );
}

function ReviewRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={ts.reviewRow}>
      <Text style={ts.reviewLabel}>{label}</Text>
      <Text style={ts.reviewValue} numberOfLines={2}>{String(value)}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Custom Dropdown — replaces @react-native-picker/picker ───────────────────
// Fully JS-BASE_URLd: immune to Android dark mode, no native thread blocking.
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

// ─────────────────────────────────────────────────────────────────────────────
// Custom DOB Calendar Picker
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const CAL_TODAY    = new Date();
const MIN_YEAR     = 1930;

function CustomDatePicker({ visible, value, onConfirm, onCancel }) {
  const init = value || new Date(2000, 0, 1);
  const [selMonth, setSelMonth] = React.useState(init.getMonth());
  const [selYear,  setSelYear]  = React.useState(init.getFullYear());
  const [selDay,   setSelDay]   = React.useState(init.getDate());
  const [mode,     setMode]     = React.useState('calendar'); // 'calendar' | 'year' | 'month'

  React.useEffect(() => {
    if (visible) {
      const d = value || new Date(2000, 0, 1);
      setSelMonth(d.getMonth());
      setSelYear(d.getFullYear());
      setSelDay(d.getDate());
      setMode('calendar');
    }
  }, [visible]);

  const daysInMonth = (m, y) => new Date(y, m + 1, 0).getDate();

  const prevMonth = () => {
    if (selMonth === 0) { setSelMonth(11); setSelYear(y => y - 1); }
    else setSelMonth(m => m - 1);
  };
  const nextMonth = () => {
    const nm = selMonth === 11 ? 0 : selMonth + 1;
    const ny = selMonth === 11 ? selYear + 1 : selYear;
    if (ny > CAL_TODAY.getFullYear() || (ny === CAL_TODAY.getFullYear() && nm > CAL_TODAY.getMonth())) return;
    setSelMonth(nm);
    if (selMonth === 11) setSelYear(y => y + 1);
  };

  const isFuture = (d) => new Date(selYear, selMonth, d) > CAL_TODAY;

  const handleConfirm = () => {
    const safeDay = Math.min(selDay, daysInMonth(selMonth, selYear));
    onConfirm(new Date(selYear, selMonth, safeDay));
  };

  // Calendar grid
  const firstWeekday = new Date(selYear, selMonth, 1).getDay();
  const total        = daysInMonth(selMonth, selYear);
  const cells        = [...Array(firstWeekday).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  // Years: newest → oldest
  const years = Array.from({ length: CAL_TODAY.getFullYear() - MIN_YEAR + 1 }, (_, i) => CAL_TODAY.getFullYear() - i);
  const canGoNext = !(selYear === CAL_TODAY.getFullYear() && selMonth === CAL_TODAY.getMonth());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={dp.overlay}>
        <View style={dp.sheet}>

          {/* ── Header ── */}
          <View style={dp.header}>
            <Text style={dp.headerTitle}>Date of Birth</Text>
            <TouchableOpacity onPress={onCancel} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Feather name="x" size={20} color={C.muted} />
            </TouchableOpacity>
          </View>

          {/* ══ YEAR GRID ══ */}
          {mode === 'year' && (
            <>
              <TouchableOpacity style={dp.backRow} onPress={() => setMode('calendar')}>
                <Feather name="arrow-left" size={14} color={C.primary} />
                <Text style={dp.backText}>Back to calendar</Text>
              </TouchableOpacity>
              <ScrollView
                style={dp.yearScroll}
                contentContainerStyle={dp.yearGrid}
                showsVerticalScrollIndicator={false}
              >
                {years.map(y => (
                  <TouchableOpacity
                    key={y}
                    style={[dp.yearCell, y === selYear && dp.yearCellActive]}
                    onPress={() => { setSelYear(y); setMode('calendar'); }}
                  >
                    <Text style={[dp.yearCellText, y === selYear && dp.yearCellTextActive]}>{y}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* ══ MONTH GRID ══ */}
          {mode === 'month' && (
            <>
              <TouchableOpacity style={dp.backRow} onPress={() => setMode('calendar')}>
                <Feather name="arrow-left" size={14} color={C.primary} />
                <Text style={dp.backText}>Back to calendar</Text>
              </TouchableOpacity>
              <View style={dp.monthGrid}>
                {MONTH_NAMES.map((_, idx) => {
                  const disabled = selYear === CAL_TODAY.getFullYear() && idx > CAL_TODAY.getMonth();
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[dp.monthCell, idx === selMonth && dp.monthCellActive, disabled && dp.cellDisabled]}
                      onPress={() => { if (!disabled) { setSelMonth(idx); setMode('calendar'); } }}
                      disabled={disabled}
                    >
                      <Text style={[dp.monthCellText, idx === selMonth && dp.monthCellTextActive]}>
                        {MONTH_SHORT[idx]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* ══ CALENDAR ══ */}
          {mode === 'calendar' && (
            <>
              {/* Month / Year nav */}
              <View style={dp.navRow}>
                <TouchableOpacity style={dp.navArrow} onPress={prevMonth}>
                  <Feather name="chevron-left" size={22} color={C.primary} />
                </TouchableOpacity>

                <View style={dp.navCenter}>
                  <TouchableOpacity
                    style={dp.navPill}
                    onPress={() => setMode('month')}
                    activeOpacity={0.7}
                  >
                    <Text style={dp.navPillText}>{MONTH_NAMES[selMonth]}</Text>
                    <Feather name="chevron-down" size={13} color={C.primary} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={dp.navPill}
                    onPress={() => setMode('year')}
                    activeOpacity={0.7}
                  >
                    <Text style={dp.navPillText}>{selYear}</Text>
                    <Feather name="chevron-down" size={13} color={C.primary} />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[dp.navArrow, !canGoNext && dp.navArrowDisabled]}
                  onPress={nextMonth}
                  disabled={!canGoNext}
                >
                  <Feather name="chevron-right" size={22} color={canGoNext ? C.primary : C.border} />
                </TouchableOpacity>
              </View>

              {/* Day-of-week headers */}
              <View style={dp.dayLabelRow}>
                {DAY_LABELS.map(l => <Text key={l} style={dp.dayLabel}>{l}</Text>)}
              </View>

              {/* Day grid */}
              {rows.map((row, ri) => (
                <View key={ri} style={dp.weekRow}>
                  {row.map((d, ci) => {
                    const future   = d != null && isFuture(d);
                    const selected = d === selDay;
                    const todayMark = d != null
                      && d === CAL_TODAY.getDate()
                      && selMonth === CAL_TODAY.getMonth()
                      && selYear  === CAL_TODAY.getFullYear();
                    return (
                      <TouchableOpacity
                        key={ci}
                        style={[dp.dayCell, selected && dp.dayCellSelected, (d == null || future) && { opacity: 0 }]}
                        onPress={() => { if (d != null && !future) setSelDay(d); }}
                        disabled={d == null || future}
                        activeOpacity={0.75}
                      >
                        <Text style={[
                          dp.dayCellText,
                          selected   && dp.dayCellTextSelected,
                          todayMark  && !selected && dp.dayCellToday,
                        ]}>
                          {d ?? ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

              {/* Confirm */}
              <TouchableOpacity style={dp.confirmBtn} onPress={handleConfirm}>
                <Feather name="check" size={16} color="#fff" />
                <Text style={dp.confirmText}>
                  {`  Confirm — ${MONTH_SHORT[selMonth]} ${selDay}, ${selYear}`}
                </Text>
              </TouchableOpacity>
            </>
          )}

        </View>
      </View>
    </Modal>
  );
}

const dp = StyleSheet.create({
  overlay:            { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  // No flex on sheet — let it size to content so children don't collapse
  sheet:              { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 34, paddingTop: 4 },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', marginBottom: 10 },
  headerTitle:        { fontSize: 16, fontWeight: '800', color: C.text },

  backRow:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, marginBottom: 10 },
  backText:           { fontSize: 13, fontWeight: '600', color: C.primary, marginLeft: 6 },

  // Nav
  navRow:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  navArrow:           { width: 38, height: 38, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  navArrowDisabled:   { backgroundColor: '#f8fafc' },
  navCenter:          { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navPill:            { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eff6ff', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, gap: 4 },
  navPillText:        { fontSize: 14, fontWeight: '700', color: C.primary },

  // Day grid
  dayLabelRow:        { flexDirection: 'row', marginBottom: 6 },
  dayLabel:           { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.muted },
  weekRow:            { flexDirection: 'row', marginBottom: 2 },
  dayCell:            { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  dayCellSelected:    { backgroundColor: C.primary },
  dayCellText:        { fontSize: 13, fontWeight: '600', color: C.text },
  dayCellTextSelected:{ color: '#fff', fontWeight: '800' },
  dayCellToday:       { color: C.primary, fontWeight: '800' },

  // Year
  yearScroll:         { maxHeight: 280 },
  yearGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
  yearCell:           { width: '22%', paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  yearCellActive:     { backgroundColor: C.primary, borderColor: C.primary },
  yearCellText:       { fontSize: 13, fontWeight: '600', color: C.text },
  yearCellTextActive: { color: '#fff', fontWeight: '800' },

  // Month
  monthGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 8 },
  monthCell:          { width: '30%', paddingVertical: 16, borderRadius: 14, alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  monthCellActive:    { backgroundColor: C.primary, borderColor: C.primary },
  monthCellText:      { fontSize: 14, fontWeight: '600', color: C.text },
  monthCellTextActive:{ color: '#fff', fontWeight: '800' },
  cellDisabled:       { opacity: 0.35 },

  // Confirm
  confirmBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, marginTop: 12 },
  confirmText:        { fontSize: 15, fontWeight: '800', color: '#fff' },
});

// ─────────────────────────────────────────────────────────────────────────────
export default function TrialRegistrationScreen({ navigation, route }) {
  const [step,          setStep]          = useState(0);
  const [submitting,    setSubmitting]    = useState(false);
  const [uploadPct,     setUploadPct]     = useState(0);
  const [photo,         setPhoto]         = useState(null);
  const [userPhoto,     setUserPhoto]     = useState(null);
  const [kbHeight,      setKbHeight]      = useState(0);

  // ── Step 4: Email verification ──────────────────────────────────────────
  const [verifyCode,    setVerifyCode]    = useState('');
  const [verifying,     setVerifying]     = useState(false);
  const [resending,     setResending]     = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [registeredUsername, setRegisteredUsername] = useState('');

  // Backend email uniqueness check loading state
  const [checking,      setChecking]      = useState(false);

  // ── Date of Birth picker ────────────────────────────────────────────────
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [dobDate,       setDobDate]       = useState(null); // JS Date object

  // Manual entry for "verify later" return flow
  const [manualEmail,    setManualEmail]    = useState('');
  const [manualUsername, setManualUsername] = useState('');

  // ── Keyboard listener for Android ──────────────────────────────────────
  useEffect(() => {
    const show = Platform.OS === "android" ? "keyboardDidShow" : "keyboardWillShow";
    const hide = Platform.OS === "android" ? "keyboardDidHide" : "keyboardWillHide";
    const s = Keyboard.addListener(show, (e) => setKbHeight(e.endCoordinates.height));
    const h = Keyboard.addListener(hide, () => setKbHeight(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  // ── "Verify Later" return flow: jump to step 3 if flagged ──────────────
  useEffect(() => {
    const init = async () => {
      // Navigate here with { verifyMode: true, email, username } from Login screen
      if (route?.params?.verifyMode) {
        const email    = route.params.email    ?? '';
        const username = route.params.username ?? '';
        if (email && username) {
          setRegisteredEmail(email);
          setRegisteredUsername(username);
          setStep(3);
          return;
        }
        // Fall back to AsyncStorage
        try {
          const raw = await AsyncStorage.getItem(PENDING_VERIFY_KEY);
          if (raw) {
            const data = JSON.parse(raw);
            setRegisteredEmail(data.email ?? '');
            setRegisteredUsername(data.username ?? '');
          }
        } catch (_) {}
        setStep(3);
      }
    };
    init();
  }, []);

  // ── Expiry date default: 1 year from today ──────────────────────────────
  const defaultExpiry = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split("T")[0];
  }, []);

  // ── Step 1: School fields ───────────────────────────────────────────────
  const [school, setSchool] = useState({
    ssms_client_code:        "",
    ssms_client_name:        "",
    ssms_client_address:     "",
    ssms_client_city:        "",
    ssms_client_state:       "",
    ssms_client_zip:         "",
    ssms_client_email:       "",
    ssms_client_phone:       "",
    ssms_client_header_text: "",
    logo_name:               "",
    currency:                "INR",
    ssms_client_status:      "active",
    ssms_client_expiry_date: defaultExpiry,
    enroll_prefix:           "E",
    registration_prefix:     "R",
    branch_name:             "",
    branch_address:          "",
  });

  // ── Step 2: Admin user fields ───────────────────────────────────────────
  const [admin, setAdmin] = useState({
    ssms_user_name:      "",
    ssms_user_password:  "",
    ssms_user_firstname: "",
    ssms_user_lastname:  "",
    ssms_user_email:     "",
    mobile_number:       "",
    user_dob:            "",
    ssms_user_role:      "owner",
    ssms_user_status:    "active",
  });

  const setS = useCallback((key, val) => setSchool(p => ({ ...p, [key]: val })), []);
  const setA = useCallback((key, val) => setAdmin(p => ({ ...p, [key]: val })),  []);

  // ── Validate step ───────────────────────────────────────────────────────
  const validateStep = useCallback(() => {
    if (step === 0) {
      const code = school.ssms_client_code.trim();
      if (!code || code.length < 2 || code.length > 5)
        return "School code must be 2–5 characters (e.g. ABC)";
      if (!/^[A-Z0-9]+$/i.test(code))
        return "School code must be letters/numbers only";
      if (!school.ssms_client_name.trim())        return "School owner name is required";
      if (!school.ssms_client_header_text.trim()) return "School display name is required";
      // Address fields — now mandatory
      if (!school.ssms_client_address.trim())     return "School address is required";
      if (!school.ssms_client_city.trim())        return "City is required";
      if (!school.ssms_client_state.trim())       return "State is required";
      if (!school.ssms_client_zip.trim())         return "ZIP / PIN Code is required";
      // Email — mandatory + format
      if (!school.ssms_client_email.trim())       return "School email is required";
      if (!EMAIL_RE.test(school.ssms_client_email.trim()))
        return "Please enter a valid school email address (e.g. school@example.com)";
      if (!school.ssms_client_phone.trim())       return "School phone is required";
      if (!school.branch_name.trim())             return "Branch name is required";
    }
    if (step === 1) {
      if (!admin.ssms_user_name.trim())           return "Username is required";
      if (admin.ssms_user_password.length < 6)   return "Password must be at least 6 characters";
      if (!admin.ssms_user_firstname.trim())      return "First name is required";
      if (!admin.ssms_user_lastname.trim())       return "Last name is required";
      // Email — mandatory + format
      if (!admin.ssms_user_email.trim())          return "User email address is required";
      if (!EMAIL_RE.test(admin.ssms_user_email.trim()))
        return "Please enter a valid email address (e.g. you@example.com)";
      if (!admin.mobile_number.trim())            return "Mobile number is required";
    }
    return null;
  }, [step, school, admin]);

  const goNext = useCallback(async () => {
    // ── Local validation ──────────────────────────────────────────────────
    const err = validateStep();
    if (err) { Alert.alert("Validation", err); return; }

    // ── Step 0: check school email uniqueness in backend ──────────────────
    if (step === 0) {
      try {
        setChecking(true);
        const res = await fetch(`${BASE_URL}/UserServiceApi/checkSchoolEmail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: school.ssms_client_email.trim() }),
        });
        const raw = await res.text();
        const json = safeJson(raw);
        // Only block if the server explicitly confirms the email already exists.
        // Any other status (auth error, endpoint not wired yet, etc.) is ignored.
        if (json.exists === true) {
          Alert.alert(
            "Email Already Registered",
            json.message ||
            "A school with this email address is already registered.\n\nPlease use a different email or contact support if you believe this is an error.",
            [{ text: "OK" }]
          );
          return;
        }
      } catch (e) {
        // Network failure or endpoint not yet implemented — log and allow through
        console.warn("[checkSchoolEmail] could not verify:", e.message);
      } finally {
        setChecking(false);
      }
    }

    // ── Step 1: check user email uniqueness in backend ────────────────────
    if (step === 1) {
      try {
        setChecking(true);
        const res = await fetch(`${BASE_URL}/UserServiceApi/checkUserEmail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: admin.ssms_user_email.trim() }),
        });
        const raw = await res.text();
        const json = safeJson(raw);
        // Only block if the server explicitly confirms the email already exists.
        if (json.exists === true) {
          Alert.alert(
            "Email Already in Use",
            json.message ||
            "A user account with this email address already exists.\n\nPlease use a different email address.",
            [{ text: "OK" }]
          );
          return;
        }
      } catch (e) {
        console.warn("[checkUserEmail] could not verify:", e.message);
      } finally {
        setChecking(false);
      }
    }

    setStep(s => s + 1);
  }, [step, validateStep, school.ssms_client_email, admin.ssms_user_email]);

  // ── Photo picker (logo) ─────────────────────────────────────────────────
  const pickPhoto = useCallback(async (setter) => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permission Required", "Please allow photo access."); return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"], quality: 1, allowsEditing: true, aspect: [1, 1],
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const manip = await ImageManipulator.manipulateAsync(
        asset.uri, [{ resize: { width: 600 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
      );
      setter({ ...asset, uri: manip.uri });
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not open photo library.");
    }
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────────
  const onSubmit = useCallback(async () => {
    const err = validateStep();
    if (err) { Alert.alert("Validation", err); return; }

    try {
      setSubmitting(true);
      setUploadPct(0);

      const fd = new FormData();

      // School fields
      Object.entries(school).forEach(([k, v]) => fd.append(k, String(v ?? "")));

      // Admin fields
      Object.entries(admin).forEach(([k, v]) => fd.append(k, String(v ?? "")));

      // Logo (optional)
      if (photo?.uri) {
        fd.append("logo", {
          uri:  photo.uri,
          name: photo.fileName ?? "logo.jpg",
          type: photo.mimeType ?? "image/jpeg",
        });
      }

      // Admin photo (optional)
      if (userPhoto?.uri) {
        fd.append("user_photo", {
          uri:  userPhoto.uri,
          name: userPhoto.fileName ?? "user_photo.jpg",
          type: userPhoto.mimeType ?? "image/jpeg",
        });
      }

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${BASE_URL}/UserServiceApi/registerTrialUser`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct(Math.round(e.loaded * 100 / e.total));
        };
        xhr.onload = () => {
          console.log("registerTrial HTTP status:", xhr.status);
          console.log("registerTrial raw response:", xhr.responseText?.substring(0, 500));
          try {
            const json = safeJson(xhr.responseText);
            if (json.status === false) {
              // Backend explicitly rejected (duplicate email/code, validation error, etc.)
              reject(new Error(json.message ?? `Server rejected the request (HTTP ${xhr.status})`));
            } else if (xhr.status >= 200 && xhr.status < 300) {
              resolve(json);
            } else {
              reject(new Error(json.message ?? `HTTP ${xhr.status}`));
            }
          } catch (parseErr) {
            reject(new Error(
              `Server returned non-JSON (HTTP ${xhr.status}).\n` +
              `Response preview: ${xhr.responseText?.substring(0, 200) ?? "empty"}`
            ));
          }
        };
        xhr.onerror = () => reject(new Error("Network error — check server connection."));
        xhr.send(fd);
      });

      // Store email and username for verification step
      setRegisteredEmail(admin.ssms_user_email);
      setRegisteredUsername(admin.ssms_user_name);

      // Persist in AsyncStorage so user can verify later if they leave
      try {
        await AsyncStorage.setItem(PENDING_VERIFY_KEY, JSON.stringify({
          email:    admin.ssms_user_email,
          username: admin.ssms_user_name,
        }));
      } catch (_) {}

      // Move to email verification step
      setStep(3);
    } catch (e) {
      Alert.alert("Error", e.message || "Registration failed. Please try again.");
    } finally {
      setSubmitting(false);
      setUploadPct(0);
    }
  }, [school, admin, photo, userPhoto, navigation, validateStep]);

  // ── Verify email code ────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (!verifyCode.trim() || verifyCode.trim().length !== 6) {
      Alert.alert("Validation", "Please enter the 6-digit code sent to your email. If you haven't received it, check your spam folder or try resending the code.");
      return;
    }
    try {
      setVerifying(true);
      const res = await fetch(`${BASE_URL}/UserServiceApi/verifyForgotPasswordCode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: registeredUsername,
          email:    registeredEmail,
          code:     verifyCode.trim(),
        }),
      });
      const raw  = await res.text();
      const json = safeJson(raw);
      if (!res.ok || json.status === false) {
        throw new Error(json.message ?? "Invalid or expired code. Please try again.");
      }
      // Clear pending verification from storage now that it's done
      try { await AsyncStorage.removeItem(PENDING_VERIFY_KEY); } catch (_) {}
      Alert.alert(
        "Email Verified!",
        "Your account is now active. You can log in.",
        [{ text: "Go to Login", onPress: () => navigation?.navigate("Login") }]
      );
    } catch (e) {
      Alert.alert("Verification Failed", e.message);
    } finally {
      setVerifying(false);
    }
  };

  // ── Verify later — save progress and navigate to Login ───────────────────
  const handleVerifyLater = async () => {
    // Already saved to AsyncStorage in onSubmit, but save again in case they
    // entered credentials manually on the verify screen
    if (registeredEmail && registeredUsername) {
      try {
        await AsyncStorage.setItem(PENDING_VERIFY_KEY, JSON.stringify({
          email:    registeredEmail,
          username: registeredUsername,
        }));
      } catch (_) {}
    }
    Alert.alert(
      "Verify Later",
      `Your registration is saved!\n\nTo verify your account later:\n\n1. Return to the Login screen\n2. Tap "Verify My Account"\n3. Enter code sent to: ${registeredEmail || "your registered email"}\n\nThe code is valid for 30 minutes. Use "Resend Code" to get a fresh one.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Go to Login", onPress: () => navigation?.navigate("Login") },
      ]
    );
  };

  // ── Resend verification code ─────────────────────────────────────────────
  const handleResend = async () => {
    try {
      setResending(true);
      const res = await fetch(`${BASE_URL}/UserServiceApi/resendVerificationCode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: registeredUsername,
          email:    registeredEmail,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.status === false) {
        throw new Error(json.message ?? "Failed to resend code.");
      }
      Alert.alert("Code Sent", `A new verification code has been sent to ${registeredEmail}. Please check your inbox or spam folders.`);
      setVerifyCode('');
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setResending(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
      <LinearGradient colors={["#e0ecff", "#f8fbff", "#eef4ff"]} style={{ flex: 1 }}>

        {/* ── Header ── */}
        <View style={ts.header}>
          <TouchableOpacity style={ts.backBtn} onPress={() => step > 0 ? setStep(s => s - 1) : navigation?.goBack()}>
            <Feather name="arrow-left" size={20} color={C.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={ts.headerTitle}>Trial Registration</Text>
            <Text style={ts.headerSub}>{STEPS[step]}</Text>
          </View>
          <Text style={ts.stepPill}>{step + 1} / {STEPS.length}</Text>
        </View>

        {/* ── Step indicator ── */}
        <View style={ts.stepRow}>
          {STEPS.map((s, i) => (
            <React.Fragment key={i}>
              <View style={[ts.stepDot, i <= step && ts.stepDotActive]}>
                {i < step
                  ? <Feather name="check" size={14} color="#fff" />
                  : <Text style={ts.stepDotText}>{i + 1}</Text>}
              </View>
              {i < STEPS.length - 1 && (
                <View style={[ts.stepLine, i < step && ts.stepLineActive]} />
              )}
            </React.Fragment>
          ))}
        </View>

        {/* ── Content ── */}
        <ScrollView
          contentContainerStyle={[ts.scroll, { paddingBottom: kbHeight + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ════ STEP 0: School Information ════ */}
          {step === 0 && (
            <>
              <SectionCard title="🏫 School Identity"
                subtitle="This code uniquely identifies your school in the system">
                <InputField
                  label="School Code (2-5 characters)" required icon="hash"
                  placeholder="e.g. DPS for Delhi Public School"
                  value={school.ssms_client_code}
                  onChangeText={v => setS("ssms_client_code", v.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  maxLength={5} autoCapitalize="characters"
                />
                <InputField
                  label="School Display Name" required icon="book-open"
                  placeholder="e.g. Springfield Public School"
                  value={school.ssms_client_header_text}
                  onChangeText={v => setS("ssms_client_header_text", v)}
                />
                <InputField
                  label="Owner / Principal Name" required icon="user"
                  placeholder="Full name of owner or principal"
                  value={school.ssms_client_name}
                  onChangeText={v => setS("ssms_client_name", v)}
                />
              </SectionCard>

              <SectionCard title="📍 School Address">
                <InputField
                  label="Address" required icon="map-pin"
                  placeholder="Street address"
                  value={school.ssms_client_address}
                  onChangeText={v => setS("ssms_client_address", v)}
                />
                <View style={ts.row}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <InputField
                      label="City" required icon="map"
                      placeholder="City"
                      value={school.ssms_client_city}
                      onChangeText={v => setS("ssms_client_city", v)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <InputField
                      label="State" required icon="map"
                      placeholder="State"
                      value={school.ssms_client_state}
                      onChangeText={v => setS("ssms_client_state", v)}
                    />
                  </View>
                </View>
                <InputField
                  label="ZIP / PIN Code" required icon="archive"
                  placeholder="ZIP code"
                  value={school.ssms_client_zip}
                  onChangeText={v => setS("ssms_client_zip", v)}
                  keyboardType="number-pad"
                />
              </SectionCard>

              <SectionCard title="📞 Contact Details">
                <InputField
                  label="School Email" required icon="mail"
                  placeholder="school@example.com"
                  value={school.ssms_client_email}
                  onChangeText={v => setS("ssms_client_email", v)}
                  keyboardType="email-address"
                />
                <InputField
                  label="School Phone" required icon="phone"
                  placeholder="+91 98765 43210"
                  value={school.ssms_client_phone}
                  onChangeText={v => setS("ssms_client_phone", v)}
                  keyboardType="phone-pad"
                />
              </SectionCard>

              {/* <SectionCard title="⚙️ System Settings"
                subtitle="These defaults can be changed later from Settings">
                <InputField
                  label="Currency" icon="dollar-sign"
                  placeholder="INR"
                  value={school.currency}
                  onChangeText={v => setS("currency", v)}
                  maxLength={5}
                />
                <View style={ts.row}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <InputField
                      label="Enrollment Prefix" icon="tag"
                      placeholder="E"
                      value={school.enroll_prefix}
                      onChangeText={v => setS("enroll_prefix", v.toUpperCase())}
                      maxLength={3}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <InputField
                      label="Registration Prefix" icon="tag"
                      placeholder="R"
                      value={school.registration_prefix}
                      onChangeText={v => setS("registration_prefix", v.toUpperCase())}
                      maxLength={3}
                    />
                  </View>
                </View>
                <InputField
                  label="Trial Expiry Date" icon="calendar"
                  placeholder="YYYY-MM-DD"
                  value={school.ssms_client_expiry_date}
                  onChangeText={v => setS("ssms_client_expiry_date", v)}
                />
              </SectionCard> */}

              <SectionCard title="🏢 Branch Details"
              >
                <InputField
                  label="Branch Name" required icon="home"
                  placeholder="e.g. Main Campus"
                  value={school.branch_name}
                  onChangeText={v => setS("branch_name", v)}
                />
                <InputField
                  label="Branch Address" icon="map-pin"
                  placeholder="Branch address (optional)"
                  value={school.branch_address}
                  onChangeText={v => setS("branch_address", v)}
                />
              </SectionCard>

              <SectionCard title="🖼️ School Logo" subtitle="Optional — JPEG/PNG, square image recommended">
                <TouchableOpacity style={ts.photoBtn} onPress={() => pickPhoto(setPhoto)}>
                  <Feather name="image" size={17} color="#fff" />
                  <Text style={ts.photoBtnText}>{photo ? "Change Logo" : "Upload Logo"}</Text>
                </TouchableOpacity>
                {photo?.uri
                  ? <Image source={{ uri: photo.uri }} style={ts.logoPreview} />
                  : <View style={ts.photoPlaceholder}>
                      <Feather name="image" size={28} color={C.muted} />
                      <Text style={ts.photoPlaceholderText}>No logo selected</Text>
                    </View>}
              </SectionCard>
            </>
          )}

          {/* ════ STEP 1: Admin Account ════ */}
          {step === 1 && (
            <>
              <SectionCard title="👤 Admin Login Credentials"
                subtitle="This account will have Owner-level access to the system">
                <InputField
                  label="Username" required icon="user"
                  placeholder="Choose a username (no spaces)"
                  value={admin.ssms_user_name}
                  onChangeText={v => setA("ssms_user_name", v.trim())}
                />
                <InputField
                  label="Password" required icon="lock"
                  placeholder="Min 6 characters"
                  value={admin.ssms_user_password}
                  onChangeText={v => setA("ssms_user_password", v)}
                  secureTextEntry
                />
              </SectionCard>

              <SectionCard title="👤 Personal Information">
                <View style={ts.row}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <InputField
                      label="First Name" required icon="user"
                      placeholder="First name"
                      value={admin.ssms_user_firstname}
                      onChangeText={v => setA("ssms_user_firstname", v)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <InputField
                      label="Last Name" required icon="user"
                      placeholder="Last name"
                      value={admin.ssms_user_lastname}
                      onChangeText={v => setA("ssms_user_lastname", v)}
                    />
                  </View>
                </View>
                <InputField
                  label="Email Address" required icon="mail"
                  placeholder="admin@school.com"
                  value={admin.ssms_user_email}
                  onChangeText={v => setA("ssms_user_email", v)}
                  keyboardType="email-address"
                />
                <InputField
                  label="Mobile Number" required icon="phone"
                  placeholder="+91 98765 43210"
                  value={admin.mobile_number}
                  onChangeText={v => setA("mobile_number", v)}
                  keyboardType="phone-pad"
                />
                {/* ── Date of Birth picker ── */}
                <View style={ts.fieldBlock}>
                  <Text style={ts.fieldLabel}>Date of Birth</Text>
                  <TouchableOpacity
                    style={ts.inputRow}
                    onPress={() => setShowDobPicker(true)}
                    activeOpacity={0.7}
                  >
                    <Feather name="calendar" size={16} color={C.muted} style={{ marginRight: 8 }} />
                    <Text style={[ts.input, !admin.user_dob && { color: C.placeholder }]}>
                      {admin.user_dob || "Select date of birth"}
                    </Text>
                    <Feather name="chevron-down" size={16} color={C.muted} />
                  </TouchableOpacity>
                </View>

                <CustomDatePicker
                  visible={showDobPicker}
                  value={dobDate}
                  onConfirm={(date) => {
                    setDobDate(date);
                    setA("user_dob", date.toISOString().split("T")[0]);
                    setShowDobPicker(false);
                  }}
                  onCancel={() => setShowDobPicker(false)}
                />
              </SectionCard>

              <SectionCard title="📸 Profile Photo" subtitle="Optional">
                <TouchableOpacity style={ts.photoBtn} onPress={() => pickPhoto(setUserPhoto)}>
                  <Feather name="camera" size={17} color="#fff" />
                  <Text style={ts.photoBtnText}>{userPhoto ? "Change Photo" : "Upload Photo"}</Text>
                </TouchableOpacity>
                {userPhoto?.uri
                  ? <Image source={{ uri: userPhoto.uri }} style={ts.logoPreview} />
                  : <View style={ts.photoPlaceholder}>
                      <Feather name="camera" size={28} color={C.muted} />
                      <Text style={ts.photoPlaceholderText}>No photo selected</Text>
                    </View>}
              </SectionCard>
            </>
          )}

          {/* ════ STEP 2: Review & Submit ════ */}
          {step === 2 && (
            <>
              <View style={ts.reviewHeader}>
                <Feather name="check-circle" size={32} color={C.success} />
                <Text style={ts.reviewHeaderTitle}>Review Your Details</Text>
                <Text style={ts.reviewHeaderSub}>
                  Please review before submitting. Go back to make changes.
                </Text>
              </View>

              <SectionCard title="🏫 School Information">
                <ReviewRow label="School Code"        value={school.ssms_client_code} />
                <ReviewRow label="Display Name"       value={school.ssms_client_header_text} />
                <ReviewRow label="Owner Name"         value={school.ssms_client_name} />
                <ReviewRow label="Address"            value={[school.ssms_client_address, school.ssms_client_city, school.ssms_client_state, school.ssms_client_zip].filter(Boolean).join(", ")} />
                <ReviewRow label="Email"              value={school.ssms_client_email} />
                <ReviewRow label="Phone"              value={school.ssms_client_phone} />
                <ReviewRow label="Currency"           value={school.currency} />
                <ReviewRow label="Enroll Prefix"      value={school.enroll_prefix} />
                <ReviewRow label="Reg Prefix"         value={school.registration_prefix} />
                <ReviewRow label="Trial Expiry"       value={school.ssms_client_expiry_date} />
                <ReviewRow label="Default Branch"     value={school.branch_name} />
              </SectionCard>

              <SectionCard title="👤 Admin Account">
                <ReviewRow label="Username"    value={admin.ssms_user_name} />
                <ReviewRow label="Full Name"   value={`${admin.ssms_user_firstname} ${admin.ssms_user_lastname}`} />
                <ReviewRow label="Email"       value={admin.ssms_user_email} />
                <ReviewRow label="Mobile"      value={admin.mobile_number} />
                <ReviewRow label="Role"        value="Owner" />
              </SectionCard>

              <View style={ts.termsBox}>
                <Feather name="info" size={16} color={C.primary} />
                <Text style={ts.termsText}>
                  By submitting you agree to our Terms of Service. Your trial expires on{" "}
                  <Text style={{ fontWeight: "700" }}>{school.ssms_client_expiry_date}</Text>.
                </Text>
              </View>
            </>
          )}

          {/* ════ STEP 3: Email Verification ════ */}
          {step === 3 && (
            <View style={ts.verifyContainer}>
              {/* Icon */}
              <View style={ts.verifyIconWrap}>
                <View style={ts.verifyIconCircle}>
                  <Feather name="mail" size={40} color={C.primary} />
                </View>
              </View>

              <Text style={ts.verifyTitle}>Verify Your Email</Text>

              {/* ── Manual entry when returning via "Verify Later" ── */}
              {!registeredEmail ? (
                <View style={{ width: '100%', marginBottom: 16 }}>
                  <Text style={[ts.verifySub, { marginBottom: 16 }]}>
                    Enter the credentials you used when registering:
                  </Text>
                  <InputField
                    label="Registered Email" icon="mail"
                    placeholder="your@school.com"
                    value={manualEmail}
                    onChangeText={setManualEmail}
                    keyboardType="email-address"
                  />
                  <InputField
                    label="Username" icon="user"
                    placeholder="your username"
                    value={manualUsername}
                    onChangeText={setManualUsername}
                  />
                  <TouchableOpacity
                    style={[ts.nextBtn, { marginBottom: 8 }]}
                    onPress={() => {
                      const e = manualEmail.trim();
                      const u = manualUsername.trim();
                      if (!e || !u) {
                        Alert.alert("Validation", "Please enter both your registered email and username.");
                        return;
                      }
                      if (!EMAIL_RE.test(e)) {
                        Alert.alert("Validation", "Please enter a valid email address.");
                        return;
                      }
                      setRegisteredEmail(e);
                      setRegisteredUsername(u);
                    }}
                  >
                    <Text style={ts.nextBtnText}>Continue to Verify</Text>
                    <Feather name="arrow-right" size={17} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={ts.verifySub}>
                    We've sent a 6-digit verification code to:
                  </Text>
                  <Text style={ts.verifyEmail}>{registeredEmail}</Text>
                  <Text style={ts.verifySub2}>
                    Enter the code below to activate your account.
                  </Text>

                  {/* 6-digit OTP boxes */}
                  <OtpInput value={verifyCode} onChange={setVerifyCode} />

                  {/* Verify button */}
                  <TouchableOpacity
                    style={[ts.verifyBtn, (verifying || verifyCode.length !== 6) && { opacity: 0.6 }]}
                    onPress={handleVerify}
                    disabled={verifying || verifyCode.length !== 6}
                  >
                    {verifying
                      ? <><ActivityIndicator color="#fff" size="small" /><Text style={ts.verifyBtnText}>  Verifying…</Text></>
                      : <><Feather name="check-circle" size={18} color="#fff" /><Text style={ts.verifyBtnText}>  Verify & Activate Account</Text></>}
                  </TouchableOpacity>

                  {/* Resend */}
                  <View style={ts.resendRow}>
                    <Text style={ts.resendText}>Didn't receive the code? </Text>
                    <TouchableOpacity onPress={handleResend} disabled={resending}>
                      {resending
                        ? <ActivityIndicator size="small" color={C.primary} />
                        : <Text style={ts.resendLink}>Resend Code</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* Info box */}
              <View style={ts.infoBox}>
                <Feather name="info" size={14} color={C.muted} />
                <Text style={ts.infoText}>
                  Check your spam/junk folder if you don't see the email. The code expires in 30 minutes. Use "Resend Code" to get a fresh one at any time.
                </Text>
              </View>

              {/* Verify Later — only show when email is known (user just registered) */}
              {!!registeredEmail && (
                <TouchableOpacity style={ts.verifyLaterBtn} onPress={handleVerifyLater}>
                  <Feather name="clock" size={15} color={C.muted} />
                  <Text style={ts.verifyLaterText}>Verify Later</Text>
                </TouchableOpacity>
              )}

              {/* Back to Login */}
              <TouchableOpacity
                style={ts.loginLink}
                onPress={() => navigation?.navigate("Login")}
              >
                <Text style={ts.loginLinkText}>← Back to Login</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Navigation buttons — hidden on verification step ── */}
          {step < 3 && (
          <View style={ts.navRow}>
            {step > 0 && (
              <TouchableOpacity
                style={ts.backBtnNav}
                onPress={() => setStep(s => s - 1)}
                disabled={checking || submitting}
              >
                <Feather name="arrow-left" size={17} color={C.primary} />
                <Text style={ts.backBtnNavText}>Back</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[ts.nextBtn, (submitting || checking) && { opacity: 0.65 }, step > 0 && { flex: 1 }]}
              onPress={step < 2 ? goNext : onSubmit}
              disabled={submitting || checking}
            >
              {checking
                ? <><ActivityIndicator color="#fff" size="small" />
                    <Text style={ts.nextBtnText}>  Checking…</Text></>
                : submitting
                  ? <><ActivityIndicator color="#fff" size="small" />
                      <Text style={ts.nextBtnText}>  Submitting{uploadPct ? ` ${uploadPct}%` : "…"}</Text></>
                  : step < 2
                    ? <><Text style={ts.nextBtnText}>Next: {STEPS[step + 1]}</Text>
                        <Feather name="arrow-right" size={17} color="#fff" /></>
                    : <><Feather name="send" size={17} color="#fff" />
                        <Text style={ts.nextBtnText}>  Submit Registration</Text></>}
            </TouchableOpacity>
          </View>
          )}

        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const ts = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  backBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.text },
  headerSub:   { fontSize: 12, color: C.muted, marginTop: 1 },
  stepPill:    { fontSize: 13, fontWeight: "700", color: C.primary, backgroundColor: "#dbeafe", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },

  stepRow:      { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 10, gap: 0 },
  stepDot:      { width: 30, height: 30, borderRadius: 15, backgroundColor: "#cbd5e1", alignItems: "center", justifyContent: "center" },
  stepDotActive:{ backgroundColor: C.primary },
  stepDotText:  { color: "#fff", fontWeight: "700", fontSize: 13 },
  stepLine:     { flex: 1, height: 3, backgroundColor: "#cbd5e1", marginHorizontal: 4 },
  stepLineActive:{ backgroundColor: C.primary },

  scroll:      { paddingHorizontal: 16, paddingTop: 8 },

  sectionCard: { backgroundColor: C.surface, borderRadius: 20, padding: 18, marginBottom: 14, elevation: 2, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  sectionTitle:{ fontSize: 16, fontWeight: "800", color: C.text, marginBottom: 4 },
  sectionSub:  { fontSize: 12, color: C.muted, marginBottom: 12 },

  fieldBlock:  { marginBottom: 12 },
  fieldLabel:  { fontSize: 13, fontWeight: "600", color: C.textSoft, marginBottom: 5 },
  inputRow:    { flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  input:       { flex: 1, fontSize: 14, color: C.text, paddingVertical: 10 },

  row:         { flexDirection: "row" },

  photoBtn:         { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 12 },
  photoBtnText:     { color: "#fff", fontWeight: "700", fontSize: 14 },
  logoPreview:      { width: 100, height: 100, borderRadius: 14, backgroundColor: "#e2e8f0", alignSelf: "center" },
  photoPlaceholder: { alignItems: "center", justifyContent: "center", paddingVertical: 20, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, borderStyle: "dashed", gap: 8 },
  photoPlaceholderText: { fontSize: 13, color: C.muted },

  reviewHeader:      { alignItems: "center", paddingVertical: 20, gap: 8 },
  reviewHeaderTitle: { fontSize: 20, fontWeight: "800", color: C.text },
  reviewHeaderSub:   { fontSize: 13, color: C.muted, textAlign: "center" },
  reviewRow:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  reviewLabel: { fontSize: 12, color: C.muted, fontWeight: "600", flex: 1 },
  reviewValue: { fontSize: 13, color: C.text, fontWeight: "700", flex: 2, textAlign: "right" },

  termsBox:   { flexDirection: "row", gap: 10, backgroundColor: "#eff6ff", borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#bfdbfe" },
  termsText:  { flex: 1, fontSize: 12, color: C.textSoft, lineHeight: 18 },

  navRow:      { flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 20 },
  backBtnNav:  { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1.5, borderColor: C.border },
  backBtnNavText: { fontSize: 14, fontWeight: "700", color: C.primary },
  nextBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, elevation: 3, shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  nextBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },

  // ── Verification step styles ──────────────────────────────────────────────
  verifyContainer: { alignItems: "center", paddingHorizontal: 8, paddingTop: 10, paddingBottom: 30 },
  verifyIconWrap:  { marginBottom: 24 },
  verifyIconCircle:{ width: 90, height: 90, borderRadius: 45, backgroundColor: "#dbeafe", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#bfdbfe" },
  verifyTitle:     { fontSize: 24, fontWeight: "800", color: C.text, marginBottom: 12, textAlign: "center" },
  verifySub:       { fontSize: 14, color: C.muted, textAlign: "center", marginBottom: 4 },
  verifyEmail:     { fontSize: 15, fontWeight: "700", color: C.primary, textAlign: "center", marginBottom: 8 },
  verifySub2:      { fontSize: 13, color: C.muted, textAlign: "center", marginBottom: 24 },
  verifyBtn:       { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.success, borderRadius: 14, paddingVertical: 16, marginBottom: 20, elevation: 3 },
  verifyBtnText:   { fontSize: 15, fontWeight: "800", color: "#fff" },
  resendRow:       { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  resendText:      { fontSize: 13, color: C.muted },
  resendLink:      { fontSize: 13, fontWeight: "700", color: C.primary },
  infoBox:         { flexDirection: "row", gap: 8, backgroundColor: "#f8fafc", borderRadius: 12, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: C.border, width: "100%" },
  infoText:        { flex: 1, fontSize: 12, color: C.muted, lineHeight: 18 },
  loginLink:       { paddingVertical: 10 },
  loginLinkText:   { fontSize: 14, fontWeight: "600", color: C.muted },

  verifyLaterBtn:  { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, marginBottom: 16 },
  verifyLaterText: { fontSize: 14, fontWeight: "600", color: C.muted },

});