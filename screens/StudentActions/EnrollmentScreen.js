import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  FlatList} from "react-native";
import { AuthContext } from "../../context/AuthContext";
import { Feather } from "@expo/vector-icons";
import {
  fetchBranches,
  fetchClasses,
  fetchSessions,
  fetchSections,
  enrollStudent,
} from "../../services/StudentServiceApi";


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

export default function EnrollmentScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const { regId, registrationNo } = route.params || {};

  const [loading, setLoading] = useState(false);
  const [loadingDropdowns, setLoadingDropdowns] = useState(true);
  const [loadingSections, setLoadingSections] = useState(false);
  const [showSectionModal, setShowSectionModal] = useState(false);

  const [branches, setBranches] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sections, setSections] = useState([]);

  const sectionRequestIdRef = useRef(0);

  const generatedEnrollmentId = useMemo(() => {
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    return `ENR-${registrationNo || "0000"}-${randomPart}`;
  }, [registrationNo]);

  const generatedRollNumber = useMemo(() => {
    return `RL-${Math.floor(100 + Math.random() * 900)}`;
  }, []);

  const [form, setForm] = useState({
    registrationNo: registrationNo || "",
    enrollmentId: "To be generated",
    rollNumber: "To be generated",
    branchId: "",
    classId: "",
    sectionId: "",
    sessionId: "",
    courseMedium: "",
  });

  const handleChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: String(value),
    }));
  };

  const handleClassChange = (value) => {
    const selectedClassId = String(value);

    setSections([]);
    setShowSectionModal(false);

    setForm((prev) => ({
      ...prev,
      classId: selectedClassId,
      sectionId: "",
    }));
  };

  const handleSectionChange = (value) => {
    setForm((prev) => ({
      ...prev,
      sectionId: String(value),
    }));
  };

  useEffect(() => {
    const loadDropdowns = async () => {
      try {
        setLoadingDropdowns(true);

        const [branchData, classData, sessionData] = await Promise.all([
          fetchBranches(user),
          fetchClasses(user),
          fetchSessions(user),
        ]);

        setBranches(Array.isArray(branchData) ? branchData : []);
        setClasses(Array.isArray(classData) ? classData : []);
        setSessions(Array.isArray(sessionData) ? sessionData : []);
      } catch (error) {
        Alert.alert("Error", error.message || "Failed to load enrollment dropdowns");
      } finally {
        setLoadingDropdowns(false);
      }
    };

    if (user) {
      loadDropdowns();
    }
  }, [user]);

  useEffect(() => {
    if (!user || !form.classId) {
      setSections([]);
      setLoadingSections(false);
      return;
    }

    let isMounted = true;
    const currentRequestId = ++sectionRequestIdRef.current;

    const loadSections = async () => {
      try {
        setLoadingSections(true);

        const raw = await fetchSections(user, form.classId);

        if (!isMounted || currentRequestId !== sectionRequestIdRef.current) {
          return;
        }

        const safeSections = Array.isArray(raw)
          ? raw
              .map((item, index) => ({
                id: String(item.section_id ?? item.id ?? `section-${index}`),
                name: item.section_name ?? item.name ?? `Section ${index + 1}`,
              }))
              .filter((item) => item.id && item.name)
          : [];

        setSections(safeSections);
      } catch (error) {
        if (!isMounted || currentRequestId !== sectionRequestIdRef.current) {
          return;
        }
        setSections([]);
        console.log("Section load error:", error.message || error);
      } finally {
        if (!isMounted || currentRequestId !== sectionRequestIdRef.current) {
          return;
        }
        setLoadingSections(false);
      }
    };

    loadSections();

    return () => {
      isMounted = false;
    };
  }, [user, form.classId]);

  const selectedSectionName =
    sections.find((s) => s.id === form.sectionId)?.name || "";

  const validateForm = () => {
    if (!form.registrationNo) return "Registration number is missing";
    if (!form.branchId) return "Please select branch";
    if (!form.classId) return "Please select class";
    if (!form.sectionId) return "Please select section";
    if (!form.sessionId) return "Please select session";
    if (!form.courseMedium.trim()) return "Please enter course medium";
    return null;
  };

  const handleSubmit = async () => {
    const error = validateForm();
    if (error) {
      Alert.alert("Validation Error", error);
      return;
    }

    try {
      setLoading(true);
          const payload = {
          registration_no: form.registrationNo,
          enrollment_id: form.enrollmentId,
          roll_number: form.rollNumber,
          branch_id: form.branchId,
          class_id: form.classId,
          section_id: form.sectionId,
          session_id: form.sessionId,
          course_medium: form.courseMedium,
        };

     // console.log("Enrollment payload:", payload);

      const result = await enrollStudent(user, payload, form.registrationNo);
      
      Alert.alert("Success", result.message || "Student enrolled successfully");

      navigation.navigate("StudentFee", {
            enrollmentId: result.enrollmentId,
            // registrationId: form.registrationNo,
            classId: form.classId,
            sessionId: form.sessionId,
            branchId: form.branchId,
            ssmsClientCode: user.ssmsClientCode,
            // studentsName: form.firstName + " " + form.lastName,
            // className: form.className,
              });
    } catch (err) {
      Alert.alert("Error", err.message || "Enrollment failed");
    } finally {
      setLoading(false);
    }
  };

  if (loadingDropdowns) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loaderText}>Loading enrollment setup...</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.title}>Student Enrollment</Text>
        <Text style={styles.subtitle}>
          Complete the enrollment details for the selected student.
        </Text>

        <Text style={styles.label}>Registration Number</Text>
        <TextInput
          style={[styles.input, styles.readonlyInput]}
          value={form.registrationNo}
          editable={false}
        />

        <Text style={styles.label}>Enrollment ID</Text>
        <TextInput
          style={[styles.input, styles.readonlyInput]}
          value={form.enrollmentId}
          editable={false}
        />

        <Text style={styles.label}>Roll Number</Text>
        <TextInput
          style={[styles.input, styles.readonlyInput]}
          value={form.rollNumber}
          editable={false}
        />

        <Text style={styles.label}>Branch Name</Text>
                  <Dropdown
            label="Select Branch"
            value={form.branchId}
            options={[
              { label: "Select Branch", value: "" },
              ...branches.map(item => ({ label: item.branch_name, value: String(item.branch_id) }))
            ]}
            onChange={(v) => handleChange("branchId", v)}
            disabled={loadingDropdowns}
          />

        <Text style={styles.label}>Session Enrolled</Text>
                  <Dropdown
            label="Select Session"
            value={form.sessionId}
            options={[
              { label: "Select Session", value: "" },
              ...sessions.map(item => ({ label: item.session_name || item.session_year, value: String(item.session_id) }))
            ]}
            onChange={(v) => handleChange("sessionId", v)}
            disabled={loadingDropdowns}
          />

        <Text style={styles.label}>Class Enrolled</Text>
                  <Dropdown
            label="Select Class"
            value={form.classId}
            options={[
              { label: "Select Class", value: "" },
              ...classes.map(item => ({ label: item.class_name, value: String(item.class_id) }))
            ]}
            onChange={handleClassChange}
            disabled={false}
          />

        <Text style={styles.label}>Section Enrolled</Text>
        <TouchableOpacity
          style={[
            styles.input,
            styles.sectionInput,
            (!form.classId || loadingSections) && styles.readonlyInput,
          ]}
          activeOpacity={0.8}
          onPress={() => {
            if (!form.classId || loadingSections) return;
            setShowSectionModal(true);
          }}
        >
          <Text style={{ color: form.sectionId ? "#0f172a" : "#64748b" }}>
            {!form.classId
              ? "Select Class First"
              : loadingSections
              ? "Loading Sections..."
              : form.sectionId
              ? selectedSectionName
              : "Select Section"}
          </Text>
        </TouchableOpacity>

        <Text style={styles.label}>Course Medium</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter course medium"
          value={form.courseMedium}
          onChangeText={(value) => handleChange("courseMedium", value)}
        />

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit Enrollment</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={showSectionModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSectionModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowSectionModal(false)}
        >
          <Pressable style={styles.modalBox} onPress={() => {}}>
            <Text style={styles.modalTitle}>Select Section</Text>

            {sections.length === 0 ? (
              <Text style={styles.modalEmpty}>No sections available</Text>
            ) : (
              sections.map((item, index) => (
                <TouchableOpacity
                  key={`section-${item.id}-${index}`}
                  style={styles.modalItem}
                  onPress={() => {
                    handleSectionChange(item.id);
                    setShowSectionModal(false);
                  }}
                >
                  <Text style={styles.modalItemText}>{item.name}</Text>
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowSectionModal(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8fafc",
  },
  loaderText: {
    marginTop: 10,
    color: "#64748b",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 6,
  },
  subtitle: {
    color: "#64748b",
    marginBottom: 20,
    lineHeight: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
    marginBottom: 15,
  },
  sectionInput: {
    justifyContent: "center",
    minHeight: 48,
  },
  readonlyInput: {
    backgroundColor: "#f1f5f9",
    color: "#475569",
  },
  dropdown: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    backgroundColor: "#fff",
    marginBottom: 15,
    overflow: "hidden",
  },
  submitButton: {
    backgroundColor: "#2563eb",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
    marginBottom: 30,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  submitText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  modalBox: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  modalItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  modalItemText: {
    fontSize: 15,
    color: "#0f172a",
  },
  modalEmpty: {
    color: "#64748b",
    marginBottom: 12,
  },
  modalCloseButton: {
    marginTop: 16,
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  modalCloseText: {
    color: "#fff",
    fontWeight: "700",
  },
});