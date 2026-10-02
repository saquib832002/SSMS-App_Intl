/**
 * screens/Setup/SchoolSettingsScreen.js
 * Per-client school configuration:
 *   • Working days  (day toggles Mon–Sun)
 *   • Session start month
 *   • School start / end time
 *   • Principal's digital signature (image upload)
 */
import React, { useState, useEffect, useCallback, useContext } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, TextInput, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AuthContext } from "../../context/AuthContext";
import { fetchSchoolSettings, saveSchoolSettings } from "../../services/SchoolSettingsServiceApi";
import { HOST_NAME as _HOST_NAME } from "../../Environment/EnvironmentConfig";
const HOST_NAME = (_HOST_NAME ?? '').replace(/\/+$/, '');

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 7 },
];

const MONTHS = [
  { label: "January",   value: 1  },
  { label: "February",  value: 2  },
  { label: "March",     value: 3  },
  { label: "April",     value: 4  },
  { label: "May",       value: 5  },
  { label: "June",      value: 6  },
  { label: "July",      value: 7  },
  { label: "August",    value: 8  },
  { label: "September", value: 9  },
  { label: "October",   value: 10 },
  { label: "November",  value: 11 },
  { label: "December",  value: 12 },
];

// ── Month Picker ──────────────────────────────────────────────────────────────

function MonthPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = MONTHS.find(m => m.value === value);

  return (
    <>
      <TouchableOpacity style={s.pickerBtn} onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
        <Text style={s.pickerBtnTxt}>{selected?.label ?? "Select month"}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color="#475569" />
      </TouchableOpacity>
      {open && (
        <View style={s.pickerDropdown}>
          {MONTHS.map(m => (
            <TouchableOpacity
              key={m.value}
              style={[s.pickerOption, m.value === value && s.pickerOptionActive]}
              onPress={() => { onChange(m.value); setOpen(false); }}
              activeOpacity={0.7}
            >
              <Text style={[s.pickerOptionTxt, m.value === value && s.pickerOptionTxtActive]}>
                {m.label}
              </Text>
              {m.value === value && <Feather name="check" size={14} color="#6d28d9" />}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function SchoolSettingsScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [success, setSuccess]   = useState(false);
  const [fetchErr, setFetchErr] = useState(null);

  // Settings state
  const [workingDays,       setWorkingDays]       = useState([1, 2, 3, 4, 5]);
  const [sessionStartMonth, setSessionStartMonth] = useState(4);
  const [schoolStartTime,   setSchoolStartTime]   = useState("08:00");
  const [schoolEndTime,     setSchoolEndTime]      = useState("14:00");

  // Signature state
  const [existingSigUrl,  setExistingSigUrl]  = useState(null);  // URL from server
  const [signatureAsset,  setSignatureAsset]  = useState(null);  // newly picked image

  // ── Load existing settings ─────────────────────────────────────────────────
  const loadSettings = useCallback(() => {
    setLoading(true);
    setFetchErr(null);
    fetchSchoolSettings(user)
      .then(data => {
        const days = (data.working_days ?? "1,2,3,4,5")
          .split(",")
          .map(Number)
          .filter(n => n >= 1 && n <= 7);
        setWorkingDays(days);
        setSessionStartMonth(data.session_start_month ?? 4);
        setSchoolStartTime((data.school_start_time ?? "08:00").slice(0, 5));
        setSchoolEndTime((data.school_end_time ?? "14:00").slice(0, 5));
        setExistingSigUrl(data.principal_signature ?? null);
      })
      .catch(e => setFetchErr(e.message))
      .finally(() => setLoading(false));
  }, [user]);

  // Run on mount
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Re-run whenever this screen comes back into focus
  useEffect(() => {
    const unsub = navigation.addListener('focus', loadSettings);
    return unsub;
  }, [navigation, loadSettings]);

  // ── Pick signature image ───────────────────────────────────────────────────
  const pickSignature = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Please allow access to your photo library to upload a signature.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,   // shows native crop UI after selection
      aspect: [3, 1],        // landscape ratio — ideal for a signature
      quality: 1,
    });
    if (!result.canceled && result.assets?.length) {
      setSignatureAsset(result.assets[0]);
      setSuccess(false);
    }
  };

  const removeSignature = () => {
    setSignatureAsset(null);
    setSuccess(false);
  };

  // ── Toggle a working day ───────────────────────────────────────────────────
  const toggleDay = (dayVal) => {
    setSuccess(false);
    setWorkingDays(prev =>
      prev.includes(dayVal)
        ? prev.filter(d => d !== dayVal)
        : [...prev, dayVal].sort((a, b) => a - b)
    );
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (workingDays.length === 0) {
      Alert.alert("Validation", "Please select at least one working day.");
      return;
    }
    const timeRe = /^\d{1,2}:\d{2}$/;
    if (!timeRe.test(schoolStartTime) || !timeRe.test(schoolEndTime)) {
      Alert.alert("Validation", "Times must be in HH:MM format (e.g. 08:00).");
      return;
    }

    const allDayNums  = ALL_DAYS.map(d => d.value);
    const weekendDays = allDayNums.filter(d => !workingDays.includes(d));

    setSaving(true);
    setSuccess(false);
    try {
      await saveSchoolSettings(
        user,
        {
          working_days:        workingDays.join(","),
          weekend_days:        weekendDays.join(",") || "",
          session_start_month: sessionStartMonth,
          school_start_time:   schoolStartTime,
          school_end_time:     schoolEndTime,
        },
        signatureAsset   // null if not changed
      );
      // If a new signature was uploaded, update the preview with the server URL
      // (append timestamp to bust React Native's image cache)
      if (signatureAsset) {
        const clientCode = user?.ssmsClientCode ?? '';
        setExistingSigUrl(
          `${HOST_NAME}/clients/${clientCode}/principal_signature.png?t=${Date.now()}`
        );
        setSignatureAsset(null);
      }
      setSuccess(true);
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.centre}>
        <ActivityIndicator size="large" color="#6d28d9" />
        <Text style={s.loadingTxt}>Loading settings…</Text>
      </View>
    );
  }

  if (fetchErr) {
    return (
      <View style={s.centre}>
        <Feather name="alert-circle" size={32} color="#ef4444" />
        <Text style={[s.loadingTxt, { color: "#ef4444", marginTop: 8 }]}>{fetchErr}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={() => { setFetchErr(null); setLoading(true); }}>
          <Text style={s.retryTxt}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const previewUri = signatureAsset?.uri ?? existingSigUrl;

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Working Days ─────────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardIconWrap}>
              <Feather name="calendar" size={16} color="#6d28d9" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Working Days</Text>
              <Text style={s.cardSub}>Tap to toggle. Selected days appear in the timetable.</Text>
            </View>
          </View>

          <View style={s.dayRow}>
            {ALL_DAYS.map(day => {
              const active = workingDays.includes(day.value);
              return (
                <TouchableOpacity
                  key={day.value}
                  style={[s.dayBtn, active && s.dayBtnActive]}
                  onPress={() => toggleDay(day.value)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.dayBtnTxt, active && s.dayBtnTxtActive]}>
                    {day.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {workingDays.length < 7 && (
            <View style={s.weekendRow}>
              <Feather name="moon" size={13} color="#94a3b8" />
              <Text style={s.weekendTxt}>
                Off days:{" "}
                {ALL_DAYS.filter(d => !workingDays.includes(d.value))
                  .map(d => d.label)
                  .join(", ") || "None"}
              </Text>
            </View>
          )}
        </View>

        {/* ── Session Start Month ─────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardIconWrap}>
              <Feather name="book-open" size={16} color="#6d28d9" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Session Start Month</Text>
              <Text style={s.cardSub}>The month the academic year begins.</Text>
            </View>
          </View>
          <MonthPicker value={sessionStartMonth} onChange={(v) => { setSessionStartMonth(v); setSuccess(false); }} />
        </View>

        {/* ── School Timings ───────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardIconWrap}>
              <Feather name="clock" size={16} color="#6d28d9" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>School Timings</Text>
              <Text style={s.cardSub}>Overall school hours in HH:MM (24-hour).</Text>
            </View>
          </View>

          <View style={s.timeRow}>
            <View style={s.timeField}>
              <Text style={s.fieldLabel}>Start Time</Text>
              <TextInput
                style={s.timeInput}
                value={schoolStartTime}
                onChangeText={t => { setSchoolStartTime(t); setSuccess(false); }}
                placeholder="08:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
            <Feather name="arrow-right" size={18} color="#cbd5e1" style={{ marginTop: 28 }} />
            <View style={s.timeField}>
              <Text style={s.fieldLabel}>End Time</Text>
              <TextInput
                style={s.timeInput}
                value={schoolEndTime}
                onChangeText={t => { setSchoolEndTime(t); setSuccess(false); }}
                placeholder="14:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
          </View>
        </View>

        {/* ── Principal Signature ──────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardIconWrap}>
              <Feather name="edit-3" size={16} color="#6d28d9" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Principal's Signature</Text>
              <Text style={s.cardSub}>
                Used on student ID cards. Upload a PNG/JPG on a white or transparent background.
              </Text>
            </View>
          </View>

          {/* Preview */}
          {previewUri ? (
            <View style={s.sigPreviewWrap}>
              <Image
                source={{ uri: previewUri }}
                style={s.sigPreview}
                resizeMode="contain"
              />
              <View style={s.sigActions}>
                <TouchableOpacity style={s.sigChangeBtn} onPress={pickSignature} activeOpacity={0.8}>
                  <Feather name="refresh-cw" size={13} color="#6d28d9" />
                  <Text style={s.sigChangeTxt}>Change</Text>
                </TouchableOpacity>
                {signatureAsset && (
                  <TouchableOpacity style={s.sigRemoveBtn} onPress={removeSignature} activeOpacity={0.8}>
                    <Feather name="x" size={13} color="#ef4444" />
                    <Text style={s.sigRemoveTxt}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
              {signatureAsset && (
                <Text style={s.sigNewBadge}>New signature ready — save to apply</Text>
              )}
            </View>
          ) : (
            <TouchableOpacity style={s.sigUploadBtn} onPress={pickSignature} activeOpacity={0.8}>
              <Feather name="upload" size={20} color="#6d28d9" />
              <Text style={s.sigUploadTxt}>Tap to upload signature</Text>
              <Text style={s.sigUploadHint}>PNG or JPG recommended</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Success banner ───────────────────────────────────────── */}
        {success && (
          <View style={s.successBanner}>
            <Feather name="check-circle" size={16} color="#15803d" />
            <Text style={s.successTxt}>Settings saved successfully.</Text>
          </View>
        )}

        {/* ── Save Button ──────────────────────────────────────────── */}
        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <Feather name="save" size={16} color="#fff" />
                <Text style={s.saveBtnTxt}>Save Settings</Text>
              </>
          }
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#f8fafc" },
  scroll: { padding: 16, gap: 14 },

  centre:     { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  loadingTxt: { color: "#64748b", marginTop: 12, fontSize: 14 },
  retryBtn:   { marginTop: 16, backgroundColor: "#6d28d9", borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt:   { color: "#fff", fontWeight: "700" },

  // Card
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardHeader:  { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 14 },
  cardIconWrap:{ width: 34, height: 34, borderRadius: 10, backgroundColor: "#f3f0ff", alignItems: "center", justifyContent: "center" },
  cardTitle:   { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  cardSub:     { fontSize: 12, color: "#94a3b8", marginTop: 1 },

  // Day toggles
  dayRow:          { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayBtn:          { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: "#e2e8f0", backgroundColor: "#f8fafc", minWidth: 52, alignItems: "center" },
  dayBtnActive:    { backgroundColor: "#6d28d9", borderColor: "#6d28d9" },
  dayBtnTxt:       { fontSize: 13, fontWeight: "600", color: "#64748b" },
  dayBtnTxtActive: { color: "#fff" },
  weekendRow:      { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  weekendTxt:      { fontSize: 12, color: "#94a3b8" },

  // Month picker
  pickerBtn:             { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#f8fafc" },
  pickerBtnTxt:          { fontSize: 14, color: "#1e293b", fontWeight: "500" },
  pickerDropdown:        { marginTop: 4, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, backgroundColor: "#fff", overflow: "hidden" },
  pickerOption:          { paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickerOptionActive:    { backgroundColor: "#f3f0ff" },
  pickerOptionTxt:       { fontSize: 14, color: "#374151" },
  pickerOptionTxtActive: { color: "#6d28d9", fontWeight: "700" },

  // Time
  timeRow:   { flexDirection: "row", alignItems: "center", gap: 12 },
  timeField: { flex: 1 },
  fieldLabel:{ fontSize: 11, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  timeInput: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16, fontWeight: "600", color: "#1e293b", backgroundColor: "#f8fafc", textAlign: "center" },

  // Signature upload
  sigUploadBtn:  { borderWidth: 1.5, borderColor: "#c4b5fd", borderStyle: "dashed", borderRadius: 12, padding: 24, alignItems: "center", gap: 8, backgroundColor: "#faf5ff" },
  sigUploadTxt:  { fontSize: 14, fontWeight: "600", color: "#6d28d9" },
  sigUploadHint: { fontSize: 11, color: "#94a3b8" },

  sigPreviewWrap: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, overflow: "hidden", backgroundColor: "#f8fafc" },
  sigPreview:     { width: "100%", height: 120, backgroundColor: "#f1f5f9" },
  sigActions:     { flexDirection: "row", gap: 10, padding: 10 },
  sigChangeBtn:   { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "#c4b5fd", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#f3f0ff" },
  sigChangeTxt:   { fontSize: 12, fontWeight: "600", color: "#6d28d9" },
  sigRemoveBtn:   { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "#fecaca", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#fff5f5" },
  sigRemoveTxt:   { fontSize: 12, fontWeight: "600", color: "#ef4444" },
  sigNewBadge:    { fontSize: 11, color: "#15803d", backgroundColor: "#f0fdf4", paddingHorizontal: 12, paddingVertical: 6, fontWeight: "600" },

  // Success / Save
  successBanner:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f0fdf4", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#bbf7d0" },
  successTxt:     { fontSize: 13, color: "#15803d", fontWeight: "600" },
  saveBtn:        { backgroundColor: "#6d28d9", borderRadius: 12, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnDisabled:{ opacity: 0.6 },
  saveBtnTxt:     { color: "#fff", fontSize: 15, fontWeight: "700" },
});
