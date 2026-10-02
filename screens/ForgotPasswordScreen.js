/**
 * screens/ForgotPasswordScreen.js
 *
 * 3-step password recovery with two verification paths:
 *   • Email   — username + email  → 6-digit code via email  → new password
 *   • WhatsApp — username + mobile → 6-digit code via WhatsApp (wa.me deep-link) → new password
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Keyboard, Platform, Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  sendForgotPasswordCode,
  verifyForgotPasswordCode,
  resetForgotPassword,
} from "../services/UserServiceApi";

// ─────────────────────────────────────────────────────────────────────────────
export default function ForgotPasswordScreen({ navigation }) {

  // ── Mode: 'email' | 'whatsapp' ────────────────────────────────────────────
  const [mode, setMode]   = useState("email");

  // ── Step 1 — 3 ────────────────────────────────────────────────────────────
  const [step, setStep]   = useState(1);
  const [loading, setLoading] = useState(false);

  // ── Fields ────────────────────────────────────────────────────────────────
  const [username,        setUsername]        = useState("");
  const [email,           setEmail]           = useState("");
  const [mobile,          setMobile]          = useState("");
  const [verificationCode,setVerificationCode]= useState("");
  const [newPassword,     setNewPassword]     = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPwd,      setShowNewPwd]      = useState(false);
  const [showConfPwd,     setShowConfPwd]     = useState(false);

  // Returned by backend after WhatsApp path — open this to deliver the code
  const [waUrl, setWaUrl] = useState(null);

  // ── Keyboard padding ──────────────────────────────────────────────────────
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Platform.OS === "android" ? "keyboardDidShow" : "keyboardWillShow";
    const hide = Platform.OS === "android" ? "keyboardDidHide" : "keyboardWillHide";
    const s = Keyboard.addListener(show, e => setKbHeight(e.endCoordinates.height));
    const h = Keyboard.addListener(hide, ()  => setKbHeight(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  // Reset when mode changes
  const switchMode = useCallback((m) => {
    setMode(m);
    setStep(1);
    setEmail("");
    setMobile("");
    setVerificationCode("");
    setNewPassword("");
    setConfirmPassword("");
    setWaUrl(null);
  }, []);

  // ── Step 1: validate + send code ─────────────────────────────────────────
  const handleSendCode = async () => {
    if (!username.trim()) {
      return alert("Please enter your username.");
    }
    if (mode === "email" && !email.trim()) {
      return alert("Please enter your email address.");
    }
    if (mode === "whatsapp" && !mobile.replace(/\D/g, "")) {
      return alert("Please enter your registered mobile number with country code (e.g. +919876543210 or 919876543210).");
    }

    try {
      setLoading(true);
      const payload = { username: username.trim() };
      if (mode === "email")     payload.email  = email.trim();
      else                      payload.mobile = mobile.replace(/\D/g, "");

      const res = await sendForgotPasswordCode(payload);

      if (mode === "whatsapp" && res.whatsapp_url) {
        setWaUrl(res.whatsapp_url);
        // Auto-open WhatsApp
        Linking.openURL(res.whatsapp_url).catch(() => {});
      }
      setStep(2);
    } catch (e) {
      alert(e.message || "Failed to send verification code. Please check your details.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: verify code ───────────────────────────────────────────────────
  const handleVerifyCode = async () => {
    if (!verificationCode.trim()) {
      return alert("Please enter the verification code.");
    }
    try {
      setLoading(true);
      const payload = { username: username.trim(), code: verificationCode.trim() };
      if (mode === "email")     payload.email  = email.trim();
      else                      payload.mobile = mobile.replace(/\D/g, "");

      await verifyForgotPasswordCode(payload);
      setStep(3);
    } catch (e) {
      alert(e.message || "Invalid verification code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: reset password ────────────────────────────────────────────────
  const handleResetPassword = async () => {
    if (!newPassword.trim()) {
      return alert("Please enter a new password.");
    }
    if (newPassword.length < 6) {
      return alert("Password must be at least 6 characters.");
    }
    if (newPassword !== confirmPassword) {
      return alert("Passwords do not match.");
    }
    try {
      setLoading(true);
      const payload = {
        username: username.trim(),
        code:     verificationCode.trim(),
        newPassword,
      };
      if (mode === "email")   payload.email  = email.trim();
      else                    payload.mobile = mobile.replace(/\D/g, "");

      await resetForgotPassword(payload);
      alert("Password reset successfully! Please log in with your new password.");
      navigation.navigate("Login");
    } catch (e) {
      alert(e.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ScrollView
      contentContainerStyle={[s.scroll, { paddingBottom: kbHeight + 40 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <View style={s.lockWrap}>
          <Feather name="shield" size={32} color="#fff" />
        </View>
        <Text style={s.title}>Forgot Password</Text>
        <Text style={s.subtitle}>Recover your account in 3 steps</Text>
      </View>

      <View style={s.card}>

        {/* ── Mode toggle ── */}
        <View style={s.modeRow}>
          <TouchableOpacity
            style={[s.modeTab, mode === "email" && s.modeTabActive]}
            onPress={() => switchMode("email")}
            activeOpacity={0.8}
          >
            <Feather name="mail" size={15} color={mode === "email" ? "#fff" : "#64748b"} />
            <Text style={[s.modeTabTxt, mode === "email" && s.modeTabTxtActive]}>Email</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeTab, mode === "whatsapp" && s.modeTabActiveWa]}
            onPress={() => switchMode("whatsapp")}
            activeOpacity={0.8}
          >
            <Feather name="message-circle" size={15} color={mode === "whatsapp" ? "#fff" : "#64748b"} />
            <Text style={[s.modeTabTxt, mode === "whatsapp" && s.modeTabTxtActive]}>WhatsApp</Text>
          </TouchableOpacity>
        </View>

        {/* ── Step indicator ── */}
        <View style={s.stepRow}>
          {[1, 2, 3].map((n, i) => (
            <React.Fragment key={n}>
              <View style={[s.stepCircle, step >= n && (mode === "whatsapp" ? s.stepCircleWa : s.stepCircleActive)]}>
                {step > n
                  ? <Feather name="check" size={14} color="#fff" />
                  : <Text style={s.stepTxt}>{n}</Text>}
              </View>
              {i < 2 && <View style={[s.stepLine, step > n && (mode === "whatsapp" ? s.stepLineWa : s.stepLineActive)]} />}
            </React.Fragment>
          ))}
        </View>
        <Text style={s.stepLabel}>
          {step === 1 ? "Identity Verification"
           : step === 2 ? "Enter Code"
           : "Set New Password"}
        </Text>

        {/* ══════ STEP 1 ══════ */}
        {step === 1 && (
          <>
            <Label>Username</Label>
            <Input
              value={username}
              onChangeText={setUsername}
              placeholder="Your login username"
              autoCapitalize="none"
              icon="user"
            />

            {mode === "email" ? (
              <>
                <Label>Email Address</Label>
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Registered email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  icon="mail"
                />
              </>
            ) : (
              <>
                <Label>Mobile Number (with country code)</Label>
                <Input
                  value={mobile}
                  onChangeText={setMobile}
                  placeholder="+919876543210"
                  keyboardType="phone-pad"
                  icon="phone"
                />
                <View style={s.waNote}>
                  <Feather name="info" size={12} color="#15803d" />
                  <Text style={s.waNoteText}>
                    Include the country code exactly as registered. Example:{"\n"}
                    <Text style={{ fontWeight: "700" }}>+919876543210</Text>{"\n"}
                    (India +91 · UK +44 · US +1)
                  </Text>
                </View>
              </>
            )}

            <Btn
              label={mode === "email" ? "Send Verification Code" : "Get Code on WhatsApp"}
              icon={mode === "whatsapp" ? "message-circle" : "send"}
              onPress={handleSendCode}
              loading={loading}
              wa={mode === "whatsapp"}
            />
          </>
        )}

        {/* ══════ STEP 2 ══════ */}
        {step === 2 && (
          <>
            {mode === "whatsapp" && waUrl ? (
              <View style={s.waCard}>
                <View style={s.waCardIcon}>
                  <Feather name="message-circle" size={28} color="#15803d" />
                </View>
                <Text style={s.waCardTitle}>Check Your WhatsApp</Text>
                <Text style={s.waCardSub}>
                  A message with your 6-digit code has been prepared.
                  If WhatsApp didn't open automatically, tap the button below.
                </Text>
                <TouchableOpacity
                  style={s.waOpenBtn}
                  onPress={() => Linking.openURL(waUrl).catch(() => {})}
                  activeOpacity={0.8}
                >
                  <Feather name="external-link" size={14} color="#fff" />
                  <Text style={s.waOpenBtnTxt}>Open WhatsApp</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={s.infoTxt}>
                A 6-digit verification code has been sent to your email address.
              </Text>
            )}

            <Label>Enter 6-Digit Code</Label>
            <TextInput
              style={s.codeInput}
              placeholder="– – – – – –"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              maxLength={6}
              value={verificationCode}
              onChangeText={setVerificationCode}
            />

            <Btn
              label="Verify Code"
              icon="check-circle"
              onPress={handleVerifyCode}
              loading={loading}
              wa={mode === "whatsapp"}
            />

            <TouchableOpacity style={s.resendBtn} onPress={() => { setStep(1); setVerificationCode(""); setWaUrl(null); }}>
              <Feather name="refresh-cw" size={13} color="#64748b" />
              <Text style={s.resendTxt}>Resend / change details</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══════ STEP 3 ══════ */}
        {step === 3 && (
          <>
            <View style={s.successBadge}>
              <Feather name="check-circle" size={20} color="#15803d" />
              <Text style={s.successBadgeTxt}>Identity verified — set your new password</Text>
            </View>

            <Label>New Password</Label>
            <View style={s.pwdRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                placeholder="At least 6 characters"
                placeholderTextColor="#94a3b8"
                secureTextEntry={!showNewPwd}
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <TouchableOpacity style={s.eyeBtn} onPress={() => setShowNewPwd(v => !v)}>
                <Feather name={showNewPwd ? "eye-off" : "eye"} size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Label>Confirm Password</Label>
            <View style={s.pwdRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                placeholder="Re-enter new password"
                placeholderTextColor="#94a3b8"
                secureTextEntry={!showConfPwd}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity style={s.eyeBtn} onPress={() => setShowConfPwd(v => !v)}>
                <Feather name={showConfPwd ? "eye-off" : "eye"} size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {!!newPassword && !!confirmPassword && newPassword !== confirmPassword && (
              <View style={s.mismatch}>
                <Feather name="alert-circle" size={13} color="#dc2626" />
                <Text style={s.mismatchTxt}>Passwords do not match</Text>
              </View>
            )}

            <Btn
              label="Reset Password"
              icon="lock"
              onPress={handleResetPassword}
              loading={loading}
              wa={mode === "whatsapp"}
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ── Small shared sub-components ───────────────────────────────────────────────
function Label({ children }) {
  return <Text style={s.label}>{children}</Text>;
}

function Input({ icon, ...props }) {
  return (
    <View style={s.inputWrap}>
      {icon && <Feather name={icon} size={16} color="#94a3b8" style={s.inputIcon} />}
      <TextInput
        style={[s.input, icon && { paddingLeft: 38 }]}
        placeholderTextColor="#94a3b8"
        {...props}
      />
    </View>
  );
}

function Btn({ label, icon, onPress, loading, wa }) {
  const bg = wa ? "#16a34a" : "#1e40af";
  return (
    <TouchableOpacity
      style={[s.btn, { backgroundColor: bg }, loading && { opacity: 0.65 }]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
    >
      {loading
        ? <ActivityIndicator color="#fff" />
        : <>
            <Feather name={icon} size={16} color="#fff" />
            <Text style={s.btnTxt}>{label}</Text>
          </>}
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: "#f0f4ff", padding: 0 },

  // Header
  header:    { backgroundColor: "#1e40af", paddingTop: 60, paddingBottom: 40, paddingHorizontal: 24, alignItems: "center" },
  backBtn:   { position: "absolute", top: 56, left: 16, width: 36, height: 36, borderRadius: 10, backgroundColor: "#fff2", alignItems: "center", justifyContent: "center" },
  lockWrap:  { width: 68, height: 68, borderRadius: 20, backgroundColor: "#ffffff22", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title:     { fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  subtitle:  { fontSize: 13, color: "#bfdbfe", marginTop: 4 },

  // Card
  card: { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -20, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 32, minHeight: 500 },

  // Mode toggle
  modeRow:           { flexDirection: "row", backgroundColor: "#f1f5f9", borderRadius: 14, padding: 4, marginBottom: 24 },
  modeTab:           { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 10, borderRadius: 11 },
  modeTabActive:     { backgroundColor: "#1e40af" },
  modeTabActiveWa:   { backgroundColor: "#16a34a" },
  modeTabTxt:        { fontSize: 13, fontWeight: "700", color: "#64748b" },
  modeTabTxtActive:  { color: "#fff" },

  // Steps
  stepRow:         { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  stepCircle:      { width: 32, height: 32, borderRadius: 16, backgroundColor: "#e2e8f0", alignItems: "center", justifyContent: "center" },
  stepCircleActive:{ backgroundColor: "#1e40af" },
  stepCircleWa:    { backgroundColor: "#16a34a" },
  stepTxt:         { fontSize: 13, fontWeight: "700", color: "#94a3b8" },
  stepLine:        { width: 44, height: 3, backgroundColor: "#e2e8f0", marginHorizontal: 4 },
  stepLineActive:  { backgroundColor: "#1e40af" },
  stepLineWa:      { backgroundColor: "#16a34a" },
  stepLabel:       { textAlign: "center", fontSize: 12, color: "#64748b", fontWeight: "600", marginBottom: 22, textTransform: "uppercase", letterSpacing: 0.5 },

  // Fields
  label:     { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6 },
  inputWrap: { marginBottom: 14, position: "relative" },
  inputIcon: { position: "absolute", left: 12, top: 14, zIndex: 1 },
  input:     { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: "#0f172a", marginBottom: 14 },
  pwdRow:    { flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, marginBottom: 14 },
  eyeBtn:    { paddingHorizontal: 13, paddingVertical: 13 },

  // Code input
  codeInput: { borderWidth: 1, borderColor: "#1e40af", borderRadius: 14, paddingVertical: 16, fontSize: 28, fontWeight: "800", color: "#1e40af", textAlign: "center", letterSpacing: 10, backgroundColor: "#eff6ff", marginBottom: 14 },

  // Button
  btn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 14, paddingVertical: 16, marginTop: 6, marginBottom: 4 },
  btnTxt: { fontSize: 15, fontWeight: "700", color: "#fff" },

  // WhatsApp info note (step 1)
  waNote:     { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: "#f0fdf4", borderRadius: 10, padding: 11, marginBottom: 14, borderWidth: 1, borderColor: "#86efac" },
  waNoteText: { flex: 1, fontSize: 12, color: "#15803d", lineHeight: 17 },

  // WhatsApp card (step 2)
  waCard:       { backgroundColor: "#f0fdf4", borderRadius: 16, padding: 18, alignItems: "center", marginBottom: 18, borderWidth: 1, borderColor: "#86efac" },
  waCardIcon:   { width: 56, height: 56, borderRadius: 16, backgroundColor: "#dcfce7", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  waCardTitle:  { fontSize: 16, fontWeight: "800", color: "#15803d", marginBottom: 6 },
  waCardSub:    { fontSize: 12, color: "#16a34a", textAlign: "center", lineHeight: 18, marginBottom: 14 },
  waOpenBtn:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#16a34a", borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  waOpenBtnTxt: { fontSize: 13, fontWeight: "700", color: "#fff" },

  // Misc
  infoTxt:       { fontSize: 13, color: "#64748b", textAlign: "center", marginBottom: 16, lineHeight: 19 },
  resendBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  resendTxt:     { fontSize: 12, color: "#64748b" },
  successBadge:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f0fdf4", borderRadius: 11, padding: 12, marginBottom: 18, borderWidth: 1, borderColor: "#86efac" },
  successBadgeTxt:{ fontSize: 12, fontWeight: "600", color: "#15803d", flex: 1 },
  mismatch:      { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -10, marginBottom: 10 },
  mismatchTxt:   { fontSize: 12, color: "#dc2626" },
});
