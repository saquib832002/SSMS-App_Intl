/**
 * screens/Setup/InstituteDetailsScreen.js
 * View & edit institute details from ssms_clients table.
 * Read-only: ssms_client_code, ssms_client_expiry_date, created, modified.
 * Logo: tap to pick from camera roll, uploads via multipart.
 */
import React, { useState, useContext, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { AuthContext } from "../../context/AuthContext";
import { fetchInstituteDetails, updateInstituteDetails } from "../../services/UserServiceApi";
import { BASE_URL, HOST_NAME } from "../../Environment/EnvironmentConfig";

// ── Field components ──────────────────────────────────────────────────────────
const Field = ({ label, value, onChangeText, editable = true, multiline, keyboardType, hint, placeholder, autoCapitalize }) => (
  <View style={sc.fieldWrap}>
    <Text style={sc.fieldLabel}>{label}</Text>
    {editable
      ? <TextInput
          style={[sc.input, multiline && sc.inputMulti]}
          value={value}
          onChangeText={onChangeText}
          editable
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
          keyboardType={keyboardType ?? "default"}
          placeholderTextColor="#94a3b8"
          placeholder={placeholder ?? `Enter ${label.replace(" *", "")}`}
          autoCapitalize={autoCapitalize ?? "sentences"}
        />
      : <View style={sc.readOnlyWrap}>
          <Text style={sc.readOnlyTxt}>{value || "—"}</Text>
          {!!hint && <Text style={sc.hintTxt}>{hint}</Text>}
        </View>}
  </View>
);

const SectionTitle = ({ title }) => (
  <Text style={sc.sectionTitle}>{title}</Text>
);

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function InstituteDetailsScreen() {
  const { user } = useContext(AuthContext);
  const isAdmin  = ['admin','owner'].includes(
    (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim()
  );

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [logoAsset,setLogoAsset]= useState(null);  // picked image
  const [logoUrl,  setLogoUrl]  = useState(null);  // current logo from server

  const [form, setForm] = useState({
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
    currency:                "",
    ssms_client_expiry_date: "",
    enroll_prefix:           "",
    registration_prefix:     "",
    upi_id:                    "",
    pay_account_name:          "",
    whatsapp_community_link:   "",
    whatsapp_channel_link:     "",
    created:                   "",
    modified:                  "",
  });

  const setField = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await fetchInstituteDetails(user);
      if (!data) { Alert.alert("Error", "Institute details not found."); return; }
      setForm({
        ssms_client_code:        data.ssms_client_code        ?? "",
        ssms_client_name:        data.ssms_client_name        ?? "",
        ssms_client_address:     data.ssms_client_address     ?? "",
        ssms_client_city:        data.ssms_client_city        ?? "",
        ssms_client_state:       data.ssms_client_state       ?? "",
        ssms_client_zip:         data.ssms_client_zip         ?? "",
        ssms_client_email:       data.ssms_client_email       ?? "",
        ssms_client_phone:       String(data.ssms_client_phone)       ?? "",
        ssms_client_header_text: data.ssms_client_header_text ?? "",
        logo_name:               data.logo_name               ?? "",
        currency:                data.currency                ?? "",
        ssms_client_expiry_date: data.ssms_client_expiry_date ?? "",
        enroll_prefix:           data.enroll_prefix           ?? "",
        registration_prefix:     data.registration_prefix     ?? "",
        upi_id:                    data.upi_id                    ?? "",
        pay_account_name:          data.pay_account_name          ?? "",
        whatsapp_community_link:   data.whatsapp_community_link   ?? "",
        whatsapp_channel_link:     data.whatsapp_channel_link     ?? "",
        created:                   data.created                   ?? "",
        modified:                  data.modified                  ?? "",
      });
      // Build logo URL
      if (data.logo_name) {
        const appRoot = HOST_NAME
          .replace(/\/[A-Za-z]+ServiceApi.*/, "")
          .replace(/\/[A-Za-z]+Api.*/,        "");
        setLogoUrl(`${appRoot}/clients/${data.ssms_client_code}/${data.logo_name}`);
        console.log("Logo URL:", `${appRoot}clients/${data.ssms_client_code}/${data.logo_name}`);
      }
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to load institute details");
    } finally { setLoading(false); }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Pick logo ─────────────────────────────────────────────────────────────
  const handlePickLogo = async () => {
    if (!isAdmin) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg","image/png","image/webp","image/gif"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const ext = (asset.name?.split(".").pop() ?? "").toLowerCase();
      if (!["jpg","jpeg","png","webp","gif"].includes(ext)) {
        Alert.alert("Invalid File", "Please select a JPG, PNG or WEBP image.");
        return;
      }
      setLogoAsset({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
    } catch (e) {
      Alert.alert("Error", e.message || "Could not open file picker");
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.ssms_client_name?.trim()) {
      Alert.alert("Validation", "Institute name is required.");
      return;
    }
    try {
      setSaving(true);
      const res = await updateInstituteDetails(user, form, logoAsset);
      // Update logo URL if a new logo was uploaded
      if (res.data?.logo_name) {
        const appRoot = BASE_URL
          .replace(/\/[A-Za-z]+ServiceApi.*/, "")
          .replace(/\/[A-Za-z]+Api.*/,        "");
        setLogoUrl(`${appRoot}/clients/${form.ssms_client_code}/${res.data.logo_name}`);
        setLogoAsset(null);
      }
      Alert.alert("Saved", "Institute details updated successfully.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally { setSaving(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>
      <View style={sc.loader}>
        <ActivityIndicator size="large" color="#1e40af" />
        <Text style={sc.loaderTxt}>Loading institute details…</Text>
      </View>
    </SafeAreaView>
  );

  const displayLogo = logoAsset?.uri ?? logoUrl;

  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={sc.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Logo ── */}
        <View style={sc.logoSection}>
          <View style={sc.logoWrap}>
            {displayLogo
              ? <Image source={{ uri: displayLogo }} style={sc.logoImg} />
              : <View style={sc.logoPlaceholder}>
                  <Feather name="image" size={32} color="#94a3b8" />
                  <Text style={sc.logoPlaceholderTxt}>No Logo</Text>
                </View>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sc.instituteName}>{form.ssms_client_name || "Institute Name"}</Text>
            <Text style={sc.clientCode}>{form.ssms_client_code}</Text>
          </View>
        </View>

        {/* ── Basic Info ── */}
        <View style={sc.card}>
          <SectionTitle title="Basic Information" />
          <Field label="Client Code" value={form.ssms_client_code} editable={false} />
          <Field label="Institute Name *" value={form.ssms_client_name}
            onChangeText={v => setField("ssms_client_name", v)} editable={isAdmin} />
          <Field label="Header Text" value={form.ssms_client_header_text}
            onChangeText={v => setField("ssms_client_header_text", v)}
            editable={isAdmin} multiline />
        </View>

        {/* ── Contact ── */}
        <View style={sc.card}>
          <SectionTitle title="Contact Details" />
          <Field label="Email" value={form.ssms_client_email}
            onChangeText={v => setField("ssms_client_email", v)}
            editable={isAdmin} keyboardType="email-address" />
          <Field label="Phone" value={form.ssms_client_phone}
            onChangeText={v => setField("ssms_client_phone", v)}
            editable={isAdmin} keyboardType="phone-pad" />
        </View>

        {/* ── Address ── */}
        <View style={sc.card}>
          <SectionTitle title="Address" />
          <Field label="Address" value={form.ssms_client_address}
            onChangeText={v => setField("ssms_client_address", v)}
            editable={isAdmin} multiline />
          <View style={sc.row}>
            <View style={sc.half}>
              <Field label="City" value={form.ssms_client_city}
                onChangeText={v => setField("ssms_client_city", v)} editable={isAdmin} />
            </View>
            <View style={sc.half}>
              <Field label="State" value={form.ssms_client_state}
                onChangeText={v => setField("ssms_client_state", v)} editable={isAdmin} />
            </View>
          </View>
          <Field label="ZIP / Postal Code" value={form.ssms_client_zip}
            onChangeText={v => setField("ssms_client_zip", v)}
            editable={isAdmin} keyboardType="numeric" />
        </View>

        {/* ── Academic Config ── */}
        <View style={sc.card}>
          <SectionTitle title="Academic Configuration" />
          <View style={sc.row}>
            <View style={sc.half}>
              <Field label="Enroll Prefix" value={form.enroll_prefix}
                onChangeText={v => setField("enroll_prefix", v)} editable={isAdmin} />
            </View>
            <View style={sc.half}>
              <Field label="Registration Prefix" value={form.registration_prefix}
                onChangeText={v => setField("registration_prefix", v)} editable={isAdmin} />
            </View>
          </View>
          <Field label="Currency" value={form.currency}
            onChangeText={v => setField("currency", v)} editable={isAdmin} />

          {/* ── Logo Upload ── */}
          <View style={sc.fieldWrap}>
            <Text style={sc.fieldLabel}>Institute Logo</Text>
            <View style={sc.logoUploadRow}>
              <View style={sc.logoPreviewBox}>
                {(logoAsset?.uri ?? logoUrl)
                  ? <Image source={{ uri: logoAsset?.uri ?? logoUrl }}
                      style={sc.logoPreviewImg} resizeMode="contain" />
                  : <View style={sc.logoPreviewEmpty}>
                      <Feather name="image" size={24} color="#94a3b8" />
                      <Text style={sc.logoPreviewEmptyTxt}>No Logo</Text>
                    </View>}
              </View>
              <View style={sc.logoUploadControls}>
                {logoAsset
                  ? <Text style={sc.logoFileName} numberOfLines={2}>{logoAsset.name}</Text>
                  : form.logo_name
                    ? <Text style={sc.logoFileName} numberOfLines={2}>{form.logo_name}</Text>
                    : <Text style={sc.logoFileNameEmpty}>No logo uploaded yet</Text>}
                {isAdmin && (
                  <>
                    <TouchableOpacity
                      style={sc.logoPickBtn}
                      onPress={handlePickLogo}
                      activeOpacity={0.8}
                    >
                      <Feather name="upload" size={14} color="#fff" />
                      <Text style={sc.logoPickBtnTxt}>
                        {logoAsset ? "Change Logo" : "Upload Logo"}
                      </Text>
                    </TouchableOpacity>
                    {logoAsset && (
                      <TouchableOpacity
                        style={sc.logoClearBtn}
                        onPress={() => setLogoAsset(null)}
                      >
                        <Feather name="x" size={12} color="#dc2626" />
                        <Text style={sc.logoClearBtnTxt}>Remove selection</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={sc.logoHint}>JPG, PNG or WEBP · no crop</Text>
                  </>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* ── Payment ── */}
        <View style={sc.card}>
          <SectionTitle title="Payment Details" />
          <Field label="UPI ID" value={form.upi_id}
            onChangeText={v => setField("upi_id", v)} editable={isAdmin} />
          <Field label="Account Name" value={form.pay_account_name}
            onChangeText={v => setField("pay_account_name", v)} editable={isAdmin} />
        </View>

        {/* ── WhatsApp Community ── */}
        <View style={sc.card}>
          <SectionTitle title="WhatsApp Community" />
          <View style={sc.waHint}>
            <Feather name="info" size={12} color="#15803d" />
            <Text style={sc.waHintTxt}>
              Paste your WhatsApp community invite link here. Students and parents will see a
              "Join Community" button on their dashboard.
            </Text>
          </View>
          <Field
            label="Community Invite Link"
            value={form.whatsapp_community_link}
            onChangeText={v => setField("whatsapp_community_link", v)}
            editable={isAdmin}
            keyboardType="url"
            autoCapitalize="none"
            placeholder="https://chat.whatsapp.com/..."
          />
          <Field
            label="Channel Link"
            value={form.whatsapp_channel_link}
            onChangeText={v => setField("whatsapp_channel_link", v)}
            editable={isAdmin}
            keyboardType="url"
            autoCapitalize="none"
            placeholder="https://whatsapp.com/channel/..."
          />
        </View>

        {/* ── System (read-only) ── */}
        <View style={sc.card}>
          <SectionTitle title="System Information" />
          <Field label="Expiry Date" value={form.ssms_client_expiry_date}
            editable={false} />
          <View style={sc.row}>
            <View style={sc.half}>
              <Field label="Created" value={form.created?.slice(0, 10)} editable={false} />
            </View>
            <View style={sc.half}>
              <Field label="Last Modified" value={form.modified?.slice(0, 10)} editable={false} />
            </View>
          </View>
        </View>

        {/* ── Save button (admin only) ── */}
        {isAdmin && (
          <TouchableOpacity
            style={[sc.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="check" size={16} color="#fff" />
                  <Text style={sc.saveBtnTxt}>Save Changes</Text></>}
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#f8fafc" },
  scroll:      { padding: 16 },
  loader:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt:   { fontSize: 13, color: "#64748b" },

  // Logo section
  logoSection:       { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16, backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#e2e8f0" },
  logoWrap:          { position: "relative" },
  logoImg:           { width: 72, height: 72, borderRadius: 12, resizeMode: "contain", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0" },
  logoPlaceholder:   { width: 72, height: 72, borderRadius: 12, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#e2e8f0", gap: 4 },
  logoPlaceholderTxt:{ fontSize: 9, color: "#94a3b8" },
  logoEditBadge:     { position: "absolute", bottom: -4, right: -4, width: 24, height: 24, borderRadius: 8, backgroundColor: "#1e40af", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  instituteName:     { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  clientCode:        { fontSize: 11, color: "#1e40af", fontWeight: "600", marginTop: 2 },
  tapToChange:       { fontSize: 10, color: "#94a3b8", marginTop: 4 },

  // Cards
  card:          { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  sectionTitle:  { fontSize: 11, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 14 },

  // WhatsApp Community
  waHint:    { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: "#f0fdf4", borderRadius: 9, padding: 10, marginBottom: 12 },
  waHintTxt: { flex: 1, fontSize: 11, color: "#15803d", lineHeight: 16 },

  // Fields
  fieldWrap:     { marginBottom: 14 },
  fieldLabel:    { fontSize: 11, fontWeight: "700", color: "#374151", marginBottom: 6 },
  input:         { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: "#0f172a" },
  inputMulti:    { minHeight: 70, textAlignVertical: "top" },
  readOnlyWrap:  { backgroundColor: "#f1f5f9", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  readOnlyTxt:   { fontSize: 13, color: "#475569", fontWeight: "500" },
  hintTxt:       { fontSize: 10, color: "#94a3b8", marginTop: 3 },

  row:   { flexDirection: "row", gap: 10 },
  half:  { flex: 1 },

  // Save button
  logoUploadRow:       { flexDirection: "row", alignItems: "flex-start", gap: 14, backgroundColor: "#f8fafc", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#e2e8f0" },
  logoPreviewBox:      { width: 72, height: 72, borderRadius: 10, overflow: "hidden", backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  logoPreviewImg:      { width: 72, height: 72 },
  logoPreviewEmpty:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  logoPreviewEmptyTxt: { fontSize: 9, color: "#94a3b8" },
  logoUploadControls:  { flex: 1, justifyContent: "center", gap: 8 },
  logoFileName:        { fontSize: 11, color: "#1e40af", fontWeight: "600" },
  logoFileNameEmpty:   { fontSize: 11, color: "#94a3b8", fontStyle: "italic" },
  logoPickBtn:         { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1e40af", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, alignSelf: "flex-start", shadowColor: "#1e40af", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  logoPickBtnTxt:      { color: "#fff", fontSize: 12, fontWeight: "700" },
  logoClearBtn:        { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 4 },
  logoClearBtnTxt:     { fontSize: 11, color: "#dc2626", fontWeight: "600" },
  logoHint:            { fontSize: 9, color: "#94a3b8", marginTop: 2 },
  // Save button
  saveBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1e40af", borderRadius: 14, paddingVertical: 15, marginBottom: 8, shadowColor: "#1e40af", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  saveBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
});