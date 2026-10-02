/**
 * screens/Staff/StaffRegistrationScreen.js
 * Staff registration & edit form — all 26 fields
 * Uses custom Dropdown (dark-mode safe), DateTimePicker, ImagePicker
 */
import React, { useState, useContext, useEffect, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal, FlatList,
  Platform, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  fetchStaffCategories,
  saveStaffRegistration,
} from "../../services/StaffServiceApi";
import { fetchBranches } from "../../services/SetupServiceApi";

// ── Constants ─────────────────────────────────────────────────────────────────
const TITLES   = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."];
const GENDERS  = ["Male", "Female", "Other"];
const YES_NO   = [{ label: "Yes", value: "Y" }, { label: "No", value: "N" }];

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled, placeholder }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[sc.dropTrigger, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[sc.dropTxt, !selected?.value && sc.dropPh]} numberOfLines={1}>
          {selected?.label ?? placeholder ?? label}
        </Text>
        <Feather name="chevron-down" size={14} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={sc.dropOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={sc.dropSheet}>
            <Text style={sc.dropSheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[sc.dropOption, String(o.value) === String(value) && sc.dropOptionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[sc.dropOptionTxt, String(o.value) === String(value) && sc.dropOptionTxtActive]}>
                    {o.label}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#1e40af" />}
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

// ── DateField ─────────────────────────────────────────────────────────────────
function DateField({ label, value, onChange, disabled }) {
  const [show, setShow] = useState(false);
  const date = value ? new Date(value) : new Date();
  return (
    <>
      <TouchableOpacity
        style={[sc.dropTrigger, disabled && { opacity: 0.45 }]}
        onPress={() => !disabled && setShow(true)}
        activeOpacity={0.7}
      >
        <Text style={[sc.dropTxt, !value && sc.dropPh]}>
          {value || `Select ${label}`}
        </Text>
        <Feather name="calendar" size={14} color="#64748b" />
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(e, d) => {
            setShow(false);
            if (d) onChange(d.toISOString().split("T")[0]);
          }}
        />
      )}
    </>
  );
}

// ── FilePickerField ───────────────────────────────────────────────────────────
function FilePickerField({ label, value, onPick, type = "image", disabled }) {
  const hasFile = !!value?.uri;
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission required", "Please allow media access."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      onPick({ uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" });
    }
  };
  const pickDoc = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "application/pdf"],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      onPick({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? "application/pdf" });
    }
  };
  return (
    <TouchableOpacity
      style={[sc.fileField, disabled && { opacity: 0.45 }]}
      onPress={() => { if (!disabled) type === "image" ? pickImage() : pickDoc(); }}
      activeOpacity={0.7}
    >
      {hasFile && type === "image"
        ? <Image source={{ uri: value.uri }} style={sc.fileThumb} />
        : <Feather name={hasFile ? "check-circle" : "upload"} size={18}
            color={hasFile ? "#16a34a" : "#64748b"} />}
      <Text style={[sc.fileTxt, hasFile && { color: "#16a34a" }]} numberOfLines={1}>
        {hasFile ? (value.name ?? "File selected") : `Choose ${label}`}
      </Text>
      {hasFile && (
        <TouchableOpacity onPress={() => onPick(null)} style={{ padding: 4 }}>
          <Feather name="x" size={14} color="#dc2626" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────
const SectionHead = ({ icon, title }) => (
  <View style={sc.sectionHead}>
    <View style={sc.sectionIconWrap}>
      <Feather name={icon} size={14} color="#1e40af" />
    </View>
    <Text style={sc.sectionTitle}>{title}</Text>
  </View>
);

// ── Field wrapper ─────────────────────────────────────────────────────────────
const Field = ({ label, required, children }) => (
  <View style={sc.field}>
    <Text style={sc.fieldLabel}>
      {label}{required && <Text style={{ color: "#ef4444" }}> *</Text>}
    </Text>
    {children}
  </View>
);

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function StaffRegistrationScreen({ navigation, route }) {
  const { user } = useContext(AuthContext);
  const editStaff = route?.params?.staff ?? null;  // passed when editing

  // ── Form state ───────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    staff_title:          editStaff?.staff_title         ?? "",
    first_name:           editStaff?.first_name          ?? "",
    last_name:            editStaff?.last_name           ?? "",
    email_address:        editStaff?.email_address       ?? "",
    mobile_number:        editStaff?.mobile_number != null ? String(editStaff.mobile_number) : "",
    address:              editStaff?.address             ?? "",
    state:                editStaff?.state               ?? "",
    father_name:          editStaff?.father_name         ?? "",
    mother_name:          editStaff?.mother_name         ?? "",
    date_of_birth:        editStaff?.date_of_birth       ?? "",
    gender:               editStaff?.gender              ?? "",
    date_of_hiring:       editStaff?.date_of_hiring      ?? "",
    years_of_experience:  editStaff?.years_of_experience != null ? String(editStaff.years_of_experience) : "",
    specialty:            editStaff?.specialty           ?? "",
    salary:               editStaff?.salary != null ? String(editStaff.salary) : "",
    category_id:          editStaff?.category_id         ?? "",
    hired:                editStaff?.hired               ?? "Y",
    resigned:             editStaff?.resigned            ?? "N",
    resignation_date:     editStaff?.resignation_date    ?? "",
    branch_id:            editStaff?.branch_id           ?? "",
    // Files — null means unchanged on edit
    staff_photo:          null,
    id_proof:             null,
    address_proof:        null,
    experience_letter:    null,
  });

  const [categories, setCategories] = useState([]);
  const [branches,   setBranches]   = useState([]);
  const [loadingDropdowns, setLoadingDropdowns] = useState(false);
  const [saving,     setSaving]     = useState(false);

  const setField = useCallback((key, val) =>
    setForm(prev => ({ ...prev, [key]: val })), []);

  // ── Re-sync form on every focus from route.params ────────────────────────
  useFocusEffect(
    useCallback(() => {
      const s = route?.params?.staff ?? null;
      if (!s) return;
      setForm(prev => ({
        ...prev,
        staff_title:          s.staff_title         ?? "",
        first_name:           s.first_name          ?? "",
        last_name:            s.last_name           ?? "",
        email_address:        s.email_address       ?? "",
        mobile_number:        s.mobile_number != null ? String(s.mobile_number) : "",
        address:              s.address             ?? "",
        state:                s.state               ?? "",
        father_name:          s.father_name         ?? "",
        mother_name:          s.mother_name         ?? "",
        date_of_birth:        s.date_of_birth       ?? "",
        gender:               s.gender              ?? "",
        date_of_hiring:       s.date_of_hiring      ?? "",
        years_of_experience:  s.years_of_experience != null ? String(s.years_of_experience) : "",
        specialty:            s.specialty           ?? "",
        expected_salary:      s.expected_salary     ?? "",
        category_id:          s.category_id        ? String(s.category_id) : "",
        branch_id:            s.branch_id          ? String(s.branch_id)   : "",
      }));
    }, [])
  );

  // ── Load categories + branches ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingDropdowns(true);
    Promise.all([fetchStaffCategories(user), fetchBranches(user)])
      .then(([cats, brs]) => {
        if (cancelled) return;
        const catList = Array.isArray(cats) ? cats : cats?.data ?? [];
        const brList  = Array.isArray(brs)  ? brs  : brs?.data  ?? [];
        setCategories(catList);
        setBranches(brList);
      })
      .catch(e => Alert.alert("Error", e.message || "Failed to load data"))
      .finally(() => { if (!cancelled) setLoadingDropdowns(false); });
    return () => { cancelled = true; };
  }, [user]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.first_name.trim())    { Alert.alert("Validation", "First name is required.");    return; }
    if (!form.last_name.trim())     { Alert.alert("Validation", "Last name is required.");     return; }
    if (!form.mobile_number.trim()) { Alert.alert("Validation", "Mobile number is required."); return; }

    try {
      setSaving(true);
      const payload = {
        ...form,
        ...(editStaff?.staff_id ? { staff_id: editStaff.staff_id } : {}),
      };
      await saveStaffRegistration(user, payload);
      Alert.alert(
        "Success",
        editStaff ? "Staff updated successfully." : "Staff registered successfully.",
        [{ text: "OK", onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save staff");
    } finally {
      setSaving(false);
    }
  };

  // ── Options ──────────────────────────────────────────────────────────────
  const categoryOptions = [
    { label: "Select Category", value: "" },
    ...categories.map(c => ({ label: c.category_name, value: String(c.category_id) })),
  ];
  const branchOptions = [
    { label: "Select Branch", value: "" },
    ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
  ];
  const titleOptions   = TITLES.map(t => ({ label: t, value: t }));
  const genderOptions  = GENDERS.map(g => ({ label: g, value: g }));

  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={sc.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Personal Info ── */}
        <View style={sc.card}>
          <SectionHead icon="user" title="Personal Information" />

          <View style={sc.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Field label="Title">
                <Dropdown
                  label="Title"
                  value={form.staff_title}
                  options={titleOptions}
                  onChange={v => setField("staff_title", v)}
                  placeholder="Select"
                />
              </Field>
            </View>
            <View style={{ flex: 2 }}>
              <Field label="First Name" required>
                <TextInput
                  style={sc.input}
                  placeholder="First name"
                  placeholderTextColor="#94a3b8"
                  value={form.first_name}
                  onChangeText={v => setField("first_name", v)}
                />
              </Field>
            </View>
          </View>

          <Field label="Last Name" required>
            <TextInput
              style={sc.input}
              placeholder="Last name"
              placeholderTextColor="#94a3b8"
              value={form.last_name}
              onChangeText={v => setField("last_name", v)}
            />
          </Field>

          <Field label="Gender">
            <Dropdown
              label="Gender"
              value={form.gender}
              options={genderOptions}
              onChange={v => setField("gender", v)}
              placeholder="Select gender"
            />
          </Field>

          <Field label="Date of Birth">
            <DateField
              label="Date of Birth"
              value={form.date_of_birth}
              onChange={v => setField("date_of_birth", v)}
            />
          </Field>

          <Field label="Father Name">
            <TextInput
              style={sc.input}
              placeholder="Father's name"
              placeholderTextColor="#94a3b8"
              value={form.father_name}
              onChangeText={v => setField("father_name", v)}
            />
          </Field>

          <Field label="Mother Name">
            <TextInput
              style={sc.input}
              placeholder="Mother's name"
              placeholderTextColor="#94a3b8"
              value={form.mother_name}
              onChangeText={v => setField("mother_name", v)}
            />
          </Field>
        </View>

        {/* ── Contact ── */}
        <View style={sc.card}>
          <SectionHead icon="phone" title="Contact Details" />

          <Field label="Mobile Number" required>
            <TextInput
              style={sc.input}
              placeholder="+91 XXXXX XXXXX"
              placeholderTextColor="#94a3b8"
              value={form.mobile_number}
              onChangeText={v => setField("mobile_number", v)}
              keyboardType="phone-pad"
            />
          </Field>

          <Field label="Email Address">
            <TextInput
              style={sc.input}
              placeholder="email@example.com"
              placeholderTextColor="#94a3b8"
              value={form.email_address}
              onChangeText={v => setField("email_address", v)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </Field>

          <Field label="Address">
            <TextInput
              style={[sc.input, sc.textArea]}
              placeholder="Full address"
              placeholderTextColor="#94a3b8"
              value={form.address}
              onChangeText={v => setField("address", v)}
              multiline
              numberOfLines={3}
            />
          </Field>

          <Field label="State">
            <TextInput
              style={sc.input}
              placeholder="State"
              placeholderTextColor="#94a3b8"
              value={form.state}
              onChangeText={v => setField("state", v)}
            />
          </Field>
        </View>

        {/* ── Employment ── */}
        <View style={sc.card}>
          <SectionHead icon="briefcase" title="Employment Details" />

          {/* <Field label="Branch">
            <Dropdown
              label="Branch"
              value={form.branch_id}
              options={branchOptions}
              onChange={v => setField("branch_id", v)}
              placeholder="Select branch"
            />
          </Field> */}

          <Field label="Category">
            <Dropdown
              label="Category"
              value={form.category_id}
              options={categoryOptions}
              onChange={v => setField("category_id", v)}
              placeholder="Select category"
            />
          </Field>

          <Field label="Specialty">
            <TextInput
              style={sc.input}
              placeholder="e.g. Mathematics, Science"
              placeholderTextColor="#94a3b8"
              value={form.specialty}
              onChangeText={v => setField("specialty", v)}
            />
          </Field>

          <Field label="Date of Hiring">
            <DateField
              label="Date of Hiring"
              value={form.date_of_hiring}
              onChange={v => setField("date_of_hiring", v)}
            />
          </Field>

          <View style={sc.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Field label="Years of Exp.">
                <TextInput
                  style={sc.input}
                  placeholder="0"
                  placeholderTextColor="#94a3b8"
                  value={String(form.years_of_experience)}
                  onChangeText={v => setField("years_of_experience", v)}
                  keyboardType="numeric"
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Salary">
                <TextInput
                  style={sc.input}
                  placeholder="0.00"
                  placeholderTextColor="#94a3b8"
                  value={String(form.salary)}
                  onChangeText={v => setField("salary", v)}
                  keyboardType="numeric"
                />
              </Field>
            </View>
          </View>

          <View style={sc.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Field label="Hired">
                <Dropdown
                  label="Hired"
                  value={form.hired}
                  options={YES_NO}
                  onChange={v => setField("hired", v)}
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Resigned">
                <Dropdown
                  label="Resigned"
                  value={form.resigned}
                  options={YES_NO}
                  onChange={v => setField("resigned", v)}
                />
              </Field>
            </View>
          </View>

          {form.resigned === "Y" && (
            <Field label="Resignation Date">
              <DateField
                label="Resignation Date"
                value={form.resignation_date}
                onChange={v => setField("resignation_date", v)}
              />
            </Field>
          )}
        </View>

        {/* ── Documents ── */}
        <View style={sc.card}>
          <SectionHead icon="file-text" title="Documents & Photo" />

          <Field label="Staff Photo">
            <FilePickerField
              label="Staff Photo"
              value={form.staff_photo}
              onPick={v => setField("staff_photo", v)}
              type="image"
            />
          </Field>

          <Field label="ID Proof">
            <FilePickerField
              label="ID Proof"
              value={form.id_proof}
              onPick={v => setField("id_proof", v)}
              type="doc"
            />
          </Field>

          <Field label="Address Proof">
            <FilePickerField
              label="Address Proof"
              value={form.address_proof}
              onPick={v => setField("address_proof", v)}
              type="doc"
            />
          </Field>

          <Field label="Experience Letter">
            <FilePickerField
              label="Experience Letter"
              value={form.experience_letter}
              onPick={v => setField("experience_letter", v)}
              type="doc"
            />
          </Field>
        </View>

        {/* ── Save button ── */}
        <TouchableOpacity
          style={[sc.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <Feather name="check" size={18} color="#fff" />
                <Text style={sc.saveTxt}>
                  {editStaff ? "Update Staff" : "Register Staff"}
                </Text>
              </>}
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#f8fafc" },
  scroll:  { padding: 16 },
  loader:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loaderTxt: { color: "#64748b", fontSize: 14 },

  // Card
  card:    { backgroundColor: "#fff", borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },

  // Section header
  sectionHead:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  sectionIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  sectionTitle:    { fontSize: 12, fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.6 },

  // Field
  field:      { marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  row:        { flexDirection: "row" },

  // Input
  input:    { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: "#0f172a" },
  textArea: { minHeight: 80, textAlignVertical: "top" },

  // Dropdown
  dropTrigger:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  dropTxt:         { flex: 1, fontSize: 14, color: "#0f172a" },
  dropPh:          { color: "#94a3b8" },
  dropOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 40 },
  dropSheet:       { backgroundColor: "#fff", borderRadius: 18, padding: 16, width: "100%", maxHeight: "65%" },
  dropSheetTitle:  { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  dropOption:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  dropOptionActive:{ backgroundColor: "#eff6ff" },
  dropOptionTxt:   { fontSize: 14, color: "#0f172a" },
  dropOptionTxtActive: { color: "#1e40af", fontWeight: "700" },

  // File picker
  fileField: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, borderStyle: "dashed", padding: 12 },
  fileThumb: { width: 36, height: 36, borderRadius: 8 },
  fileTxt:   { flex: 1, fontSize: 13, color: "#64748b" },

  // Save button
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#1e40af", borderRadius: 16, paddingVertical: 16, shadowColor: "#1e40af", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  saveTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
});