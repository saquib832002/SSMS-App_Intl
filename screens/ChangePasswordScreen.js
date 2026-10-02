// screens/ChangePasswordScreen.js
import React, { useContext, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AuthContext } from "../context/AuthContext";
import { changePassword } from "../services/UserServiceApi";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  primary: '#2563eb',
  text:    '#0f172a',
  sub:     '#334155',
  muted:   '#64748b',
  border:  '#e2e8f0',
  bg:      '#eef2f7',
  card:    '#ffffff',
  error:   '#dc2626',
  errorBg: '#fef2f2',
  success: '#16a34a',
};

// ── Password strength ─────────────────────────────────────────────────────────
function getStrength(pw) {
  if (!pw) return { level: 0, label: '', color: C.border };
  let score = 0;
  if (pw.length >= 8)            score++;
  if (pw.length >= 12)           score++;
  if (pw.length >= 16)           score++;
  if (/[0-9]/.test(pw))         score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { level: 1, label: 'Weak',      color: '#ef4444' };
  if (score === 2) return { level: 2, label: 'Fair',      color: '#f97316' };
  if (score === 3) return { level: 3, label: 'Good',      color: '#eab308' };
  if (score === 4) return { level: 4, label: 'Strong',    color: '#22c55e' };
                   return { level: 5, label: 'Very Strong', color: '#16a34a' };
}

function StrengthBar({ password }) {
  const { level, label, color } = getStrength(password);
  if (!password) return null;
  return (
    <View style={sb.wrap}>
      <View style={sb.bars}>
        {[1,2,3,4,5].map(i => (
          <View
            key={i}
            style={[sb.bar, { backgroundColor: i <= level ? color : C.border }]}
          />
        ))}
      </View>
      <Text style={[sb.label, { color }]}>{label}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  wrap:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 2 },
  bars:  { flexDirection: 'row', gap: 4, flex: 1 },
  bar:   { flex: 1, height: 4, borderRadius: 2 },
  label: { fontSize: 11, fontWeight: '700', minWidth: 64, textAlign: 'right' },
});

// ── Password field ────────────────────────────────────────────────────────────
function PasswordField({ label, value, onChangeText, error, inputRef, onSubmitEditing, returnKeyType, children }) {
  const [show, setShow] = useState(false);
  const hasError = !!error;
  return (
    <View style={pf.wrap}>
      <Text style={pf.label}>{label}</Text>
      <View style={[pf.row, hasError && pf.rowError]}>
        <MaterialIcons name="lock-outline" size={18} color={hasError ? C.error : C.muted} style={pf.icon} />
        <TextInput
          ref={inputRef}
          style={pf.input}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType={returnKeyType ?? 'next'}
          onSubmitEditing={onSubmitEditing}
          placeholderTextColor={C.muted}
          placeholder={label}
        />
        <TouchableOpacity onPress={() => setShow(s => !s)} style={pf.eye} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name={show ? 'eye-off' : 'eye'} size={17} color={C.muted} />
        </TouchableOpacity>
      </View>
      {hasError && (
        <View style={pf.errorRow}>
          <Feather name="alert-circle" size={12} color={C.error} />
          <Text style={pf.errorTxt}>{error}</Text>
        </View>
      )}
      {children}
    </View>
  );
}
const pf = StyleSheet.create({
  wrap:     { marginBottom: 16 },
  label:    { fontSize: 12, fontWeight: '700', color: C.sub, marginBottom: 6, letterSpacing: 0.2 },
  row:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f9fc', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, minHeight: 52, overflow: 'hidden' },
  rowError: { borderColor: C.error, backgroundColor: C.errorBg },
  icon:     { marginLeft: 13, marginRight: 6 },
  input:    { flex: 1, fontSize: 14, color: C.text, paddingVertical: 13, paddingRight: 4 },
  eye:      { paddingHorizontal: 13 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  errorTxt: { fontSize: 12, color: C.error, fontWeight: '500', flex: 1 },
});

// ── Validation rules displayed as checklist ───────────────────────────────────
function RuleItem({ met, text }) {
  return (
    <View style={rl.row}>
      <Feather name={met ? 'check-circle' : 'circle'} size={13} color={met ? C.success : C.muted} />
      <Text style={[rl.txt, met && rl.met]}>{text}</Text>
    </View>
  );
}
const rl = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  txt: { fontSize: 12, color: C.muted },
  met: { color: C.success, fontWeight: '600' },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function ChangePasswordScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [current,    setCurrent]    = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirm,    setConfirm]    = useState('');
  const [errors,     setErrors]     = useState({});
  const [loading,    setLoading]    = useState(false);
  const [done,       setDone]       = useState(false);

  const refNew     = useRef(null);
  const refConfirm = useRef(null);

  // ── Live validation helpers ───────────────────────────────────────────────
  const rules = {
    minLen:  newPw.length >= 8,
    hasNum:  /[0-9]/.test(newPw),
    noSpace: !/\s/.test(newPw) && newPw.length > 0,
    matches: newPw.length > 0 && newPw === confirm,
  };

  const validate = () => {
    const e = {};
    if (!current.trim())
      e.current = 'Current password is required';
    if (!newPw)
      e.newPw = 'New password is required';
    else if (newPw.length < 8)
      e.newPw = 'At least 8 characters required';
    else if (!/[0-9]/.test(newPw))
      e.newPw = 'Must include at least one number';
    else if (/\s/.test(newPw))
      e.newPw = 'Password cannot contain spaces';
    else if (newPw === current.trim())
      e.newPw = 'New password must differ from current password';
    if (!confirm)
      e.confirm = 'Please re-enter your new password';
    else if (confirm !== newPw)
      e.confirm = 'Passwords do not match';
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;

    try {
      setLoading(true);
      await changePassword(current.trim(), newPw, user);
      setDone(true);
    } catch (err) {
      if (err.message?.toLowerCase().includes('current password')) {
        setErrors({ current: err.message });
      } else {
        Alert.alert('Error', err.message || 'Failed to change password');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ─────────────────────────────────────────────────────────
  if (done) {
    return (
      <View style={s.root}>
        <LinearGradient colors={['#1e3a8a', '#2563eb']} style={s.heroSmall} />
        <View style={s.successCard}>
          <View style={s.successIcon}>
            <Feather name="check-circle" size={52} color={C.success} />
          </View>
          <Text style={s.successTitle}>Password Changed!</Text>
          <Text style={s.successSub}>
            Your password has been updated successfully. Use your new password next time you sign in.
          </Text>
          <TouchableOpacity style={s.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={s.doneBtnTxt}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      {/* Gradient top band — compact row */}
      <LinearGradient colors={['#1e3a8a', '#2563eb']} style={s.hero}>
        <View style={s.heroIcon}>
          <MaterialIcons name="lock-reset" size={22} color="#fff" />
        </View>
        <View>
          <Text style={s.heroTitle}>Change Password</Text>
          <Text style={s.heroSub}>Keep your account secure</Text>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.card}>

          {/* Current password */}
          <PasswordField
            label="Current Password"
            value={current}
            onChangeText={v => { setCurrent(v); if (errors.current) setErrors(e => ({ ...e, current: '' })); }}
            error={errors.current}
            onSubmitEditing={() => refNew.current?.focus()}
          />

          {/* Divider */}
          <View style={s.divider} />

          {/* New password */}
          <PasswordField
            label="New Password"
            value={newPw}
            onChangeText={v => { setNewPw(v); if (errors.newPw) setErrors(e => ({ ...e, newPw: '' })); }}
            error={errors.newPw}
            inputRef={refNew}
            onSubmitEditing={() => refConfirm.current?.focus()}
          >
            <StrengthBar password={newPw} />
          </PasswordField>

          {/* Rules checklist — visible once user starts typing new pw */}
          {newPw.length > 0 && (
            <View style={s.rulesBox}>
              <RuleItem met={rules.minLen}  text="At least 8 characters" />
              <RuleItem met={rules.hasNum}  text="At least one number (0–9)" />
              <RuleItem met={rules.noSpace} text="No spaces" />
            </View>
          )}

          {/* Confirm password */}
          <PasswordField
            label="Confirm New Password"
            value={confirm}
            onChangeText={v => { setConfirm(v); if (errors.confirm) setErrors(e => ({ ...e, confirm: '' })); }}
            error={errors.confirm}
            inputRef={refConfirm}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          >
            {/* Inline match hint */}
            {confirm.length > 0 && !errors.confirm && (
              <View style={pf.errorRow}>
                <Feather
                  name={rules.matches ? 'check-circle' : 'x-circle'}
                  size={12}
                  color={rules.matches ? C.success : C.error}
                />
                <Text style={[pf.errorTxt, { color: rules.matches ? C.success : C.error }]}>
                  {rules.matches ? 'Passwords match' : 'Passwords do not match'}
                </Text>
              </View>
            )}
          </PasswordField>

          {/* Submit */}
          <TouchableOpacity
            style={[s.submitBtn, loading && { opacity: 0.65 }]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : (
                <>
                  <Feather name="shield" size={17} color="#fff" />
                  <Text style={s.submitTxt}>Update Password</Text>
                </>
              )
            }
          </TouchableOpacity>

        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: '#eef2f7' },

  // Hero band — compact
  hero:       { paddingTop: Platform.OS === 'ios' ? 16 : 12, paddingBottom: 14, paddingHorizontal: 24, alignItems: 'center', flexDirection: 'row', gap: 12 },
  heroSmall:  { height: Platform.OS === 'ios' ? 60 : 44 },
  heroIcon:   { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  heroTitle:  { fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 2 },
  heroSub:    { fontSize: 12, color: '#bfdbfe' },

  // Scroll / card
  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingTop: 20, paddingBottom: 40 },
  card:          { backgroundColor: C.card, borderRadius: 20, padding: 22, elevation: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },

  // Divider
  divider: { height: 1, backgroundColor: C.border, marginVertical: 4, marginBottom: 16 },

  // Rules box
  rulesBox: { backgroundColor: '#f0fdf4', borderRadius: 10, padding: 12, marginTop: -4, marginBottom: 16, borderWidth: 1, borderColor: '#bbf7d0' },

  // Submit button
  submitBtn: { backgroundColor: C.primary, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 8, marginTop: 8 },
  submitTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // Success
  successCard:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon:  { width: 90, height: 90, borderRadius: 45, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderWidth: 2, borderColor: '#bbf7d0' },
  successTitle: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 10 },
  successSub:   { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 30 },
  doneBtn:      { backgroundColor: C.primary, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 48 },
  doneBtnTxt:   { color: '#fff', fontWeight: '800', fontSize: 15 },
});
