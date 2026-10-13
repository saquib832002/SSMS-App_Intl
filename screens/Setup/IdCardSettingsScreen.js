// screens/Setup/IdCardSettingsScreen.js
import React, { useState, useEffect, useCallback, useContext } from "react";
import {
  View, Text, ScrollView, Switch, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, StyleSheet, StatusBar, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchIdCardConfig,
  saveIdCardConfig,
  ID_CARD_CONFIG_DEFAULTS,
} from "../../services/SchoolSettingsServiceApi";
import { _t, _tx } from "../../services/i18n";

// ── Field definitions grouped for display ────────────────────────────────────
const GROUPS = [
  {
    get title() { return _t("School Header"); },
    icon:  "home",
    color: "#1d4ed8",
    fields: [
      { key: "showSchoolLogo",    get label() { return _t("School Logo"); },              get desc() { return _t("School logo image in the card header"); } },
      { key: "showSchoolAddress", get label() { return _t("School Address"); },           get desc() { return _t("Address line below school name"); } },
      { key: "showSchoolPhone",   get label() { return _t("School Phone Number"); },      get desc() { return _t("Phone shown in card header"); } },
      { key: "showTagline",       get label() { return _t("School Tagline"); },           get desc() { return _t("\"Learn | Grow | Succeed\" line"); },
        textKey: "taglineText", textPlaceholder: "e.g. LEARN | GROW | SUCCEED" },
    ],
  },
  {
    get title() { return _t("Student Information"); },
    icon:  "user",
    color: "#065f46",
    fields: [
      { key: "showStudentPhoto",  get label() { return _t("Student Photo"); },            get desc() { return _t("Student photograph on the card"); } },
      { key: "showAdmissionNo",   get label() { return _t("Admission Number"); },         get desc() { return _t("Student's admission / roll number"); } },
      { key: "showDateOfBirth",   get label() { return _t("Date of Birth"); },            get desc() { return _t("Student's date of birth"); } },
      { key: "showBloodGroup",    get label() { return _t("Blood Group"); },              get desc() { return _t("Student's blood group"); } },
      { key: "showGender",        get label() { return _t("Gender"); },                   get desc() { return _t("Male / Female / Other"); } },
      { key: "showSessionYear",   get label() { return _t("Academic Session"); },         get desc() { return _t("e.g. Session 2025–26"); } },
    ],
  },
  {
    get title() { return _t("Parent / Family"); },
    icon:  "users",
    color: "#7c3aed",
    fields: [
      { key: "showFatherName",    get label() { return _t("Father's Name"); },            get desc() { return _t("Father's full name"); } },
      { key: "showMotherName",    get label() { return _t("Mother's Name"); },            get desc() { return _t("Mother's full name"); } },
      { key: "showParentPhone",   get label() { return _t("Parent Contact Number"); },    get desc() { return _t("Father's or mother's mobile (whichever is available)"); } },
      { key: "showStudentAddress",get label() { return _t("Student's Home Address"); },   get desc() { return _t("Residential address of student"); } },
    ],
  },
  {
    get title() { return _t("Transport"); },
    icon:  "truck",
    color: "#b45309",
    fields: [
      { key: "showBusRoute",      get label() { return _t("Bus Route"); },                get desc() { return _t("Assigned school bus route"); } },
    ],
  },
  {
    get title() { return _t("Card Features"); },
    icon:  "credit-card",
    color: "#0e7490",
    fields: [
      { key: "showEstdYear",           get label() { return _t("Establishment Year"); },       get desc() { return _t("e.g. \"ESTD. 2010\" badge on the card"); },
        textKey: "estdYear", textPlaceholder: "e.g. 2010" },
      { key: "showQrCode",             get label() { return _t("QR Code"); },                  get desc() { return _t("Scannable QR code on the card"); } },
      { key: "showPrincipalSignature", get label() { return _t("Principal's Signature"); },    get desc() { return _t("Signature image in card footer"); } },
      { key: "showValidityYear",       get label() { return _t("Card Validity Year"); },       get desc() { return _t("e.g. \"Valid: 2025–26\""); } },
    ],
  },
  {
    get title() { return _t("Footer Bar"); },
    icon:  "align-justify",
    color: "#be123c",
    fields: [
      { key: "showIfFoundBar",         get label() { return _t("\"If Found\" Return Message"); }, get desc() { return _t("\"If found, please return this card to the school\""); },
        textKey: "ifFoundText", textPlaceholder: "e.g. If found, please return this card to the school." },
      { key: "showSchoolPhoneInFooter",get label() { return _t("School Phone in Footer"); },    get desc() { return _t("Contact number appended to the If Found message"); } },
    ],
  },
];

export default function IdCardSettingsScreen() {
  const { user } = useContext(AuthContext);

  const [config,  setConfig]  = useState({ ...ID_CARD_CONFIG_DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await fetchIdCardConfig(user);
      setConfig(cfg);
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message) ?? _t("Could not load settings."));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Toggle ────────────────────────────────────────────────────────────────
  const toggle = (key) =>
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    try {
      await saveIdCardConfig(user, config);
      Alert.alert(_t("Saved"), _t("ID card settings updated successfully."));
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message) ?? _t("Could not save settings."));
    } finally {
      setSaving(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#1d4ed8" />
        <Text style={s.loadingText}>{_t("Loading settings…")}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      <StatusBar barStyle="dark-content" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        <Text style={s.intro}>{_t("Choose which fields appear on each student ID card. Changes apply to all cards generated after saving.")}</Text>

        {/* ── Language Picker ──────────────────────────────── */}
        <View style={s.card}>
          <View style={[s.groupHeader, { borderLeftColor: "#0369a1" }]}>
            <View style={[s.groupIconBox, { backgroundColor: "#0369a118" }]}>
              <Feather name="globe" size={16} color="#0369a1" />
            </View>
            <Text style={[s.groupTitle, { color: "#0369a1" }]}>{_t("Card Language")}</Text>
          </View>
          <View style={s.langRow}>
            {[
              { code: "en", label: _t("English"),  native: "English" },
              { code: "hi", label: _t("Hindi"),    native: "हिन्दी"  },
              { code: "ur", label: _t("Urdu"),     native: "اردو"    },
            ].map(lang => {
              const active = config.cardLanguage === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[s.langBtn, active && { backgroundColor: "#0369a1", borderColor: "#0369a1" }]}
                  onPress={() => setConfig(prev => ({ ...prev, cardLanguage: lang.code }))}
                  activeOpacity={0.75}
                >
                  <Text style={[s.langNative, active && { color: "#fff" }]}>{_tx(lang.native)}</Text>
                  <Text style={[s.langSub,    active && { color: "rgba(255,255,255,0.75)" }]}>{_tx(lang.label)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {GROUPS.map(group => (
          <View key={group.title} style={s.card}>
            {/* Group header */}
            <View style={[s.groupHeader, { borderLeftColor: group.color }]}>
              <View style={[s.groupIconBox, { backgroundColor: group.color + "18" }]}>
                <Feather name={group.icon} size={16} color={group.color} />
              </View>
              <Text style={[s.groupTitle, { color: group.color }]}>{_tx(group.title)}</Text>
            </View>

            {/* Fields */}
            {group.fields.map((field, idx) => (
              <View key={field.key}>
                {/* Toggle row */}
                <View style={[s.row, (!field.textKey || !config[field.key]) && idx < group.fields.length - 1 && s.rowBorder]}>
                  <View style={s.rowText}>
                    <Text style={s.rowLabel}>{_tx(field.label)}</Text>
                    <Text style={s.rowDesc}>{_tx(field.desc)}</Text>
                  </View>
                  <Switch
                    value={!!config[field.key]}
                    onValueChange={() => toggle(field.key)}
                    trackColor={{ false: "#d1d5db", true: group.color + "66" }}
                    thumbColor={config[field.key] ? group.color : "#9ca3af"}
                    ios_backgroundColor="#d1d5db"
                  />
                </View>
                {/* Inline text input — shown when toggle is ON and field has a textKey */}
                {field.textKey && config[field.key] && (
                  <View style={[s.textInputWrap, idx < group.fields.length - 1 && s.rowBorder]}>
                    <Text style={[s.textInputLabel, { color: group.color }]}>{_t("Custom text")}</Text>
                    <TextInput
                      style={s.textInput}
                      value={config[field.textKey] ?? ""}
                      onChangeText={v => setConfig(prev => ({ ...prev, [field.textKey]: v }))}
                      placeholder={_tx(field.textPlaceholder)}
                      placeholderTextColor="#9ca3af"
                      maxLength={300}
                      returnKeyType="done"
                    />
                  </View>
                )}
              </View>
            ))}
          </View>
        ))}

        <View style={s.bottomPad} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Save button */}
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : (
              <>
                <Feather name="save" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={s.saveTxt}>{_t("Save Settings")}</Text>
              </>
            )
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#f3f4f6" },
  center:        { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f3f4f6" },
  loadingText:   { marginTop: 12, color: "#6b7280", fontSize: 14 },
  scroll:        { padding: 16 },
  intro:         { fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 18 },

  card:          { backgroundColor: "#fff", borderRadius: 12, marginBottom: 16,
                   shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8,
                   shadowOffset: { width: 0, height: 2 }, elevation: 2, overflow: "hidden" },

  groupHeader:   { flexDirection: "row", alignItems: "center", padding: 14,
                   borderLeftWidth: 4, backgroundColor: "#fafafa" },
  groupIconBox:  { width: 28, height: 28, borderRadius: 8, alignItems: "center",
                   justifyContent: "center", marginRight: 10 },
  groupTitle:    { fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },

  row:           { flexDirection: "row", alignItems: "center",
                   paddingHorizontal: 14, paddingVertical: 13 },
  rowBorder:     { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  rowText:       { flex: 1, paddingRight: 12 },
  rowLabel:      { fontSize: 14, fontWeight: "600", color: "#111827" },
  rowDesc:       { fontSize: 11.5, color: "#6b7280", marginTop: 2 },

  textInputWrap:  { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 },
  textInputLabel: { fontSize: 11, fontWeight: "700", marginBottom: 5, letterSpacing: 0.3 },
  textInput:      { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0",
                    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
                    fontSize: 13, color: "#111827" },

  langRow:       { flexDirection: "row", padding: 14, gap: 8 },
  langBtn:       { flex: 1, alignItems: "center", paddingVertical: 10, paddingHorizontal: 4,
                   borderRadius: 10, borderWidth: 1.5, borderColor: "#d1d5db",
                   backgroundColor: "#f9fafb" },
  langNative:    { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 2 },
  langSub:       { fontSize: 11, color: "#6b7280" },

  footer:        { backgroundColor: "#fff", padding: 16,
                   borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e7eb" },
  saveBtn:       { backgroundColor: "#1d4ed8", borderRadius: 10, height: 48,
                   flexDirection: "row", alignItems: "center", justifyContent: "center" },
  saveBtnDisabled: { opacity: 0.6 },
  saveTxt:       { color: "#fff", fontSize: 15, fontWeight: "700" },
  bottomPad:     { height: 8 },
});
