/**
 * EnrolledStudentsScreen.js
 * 
 * KEY FIX: Replaced @react-native-picker/picker with custom JS dropdowns.
 * The native Picker on Android freezes the JS thread — it opens a system
 * dialog that blocks React Native's bridge entirely. Custom dropdowns using
 * Modal + FlatList are fully JS-side and never hang.
 */
import React, {
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, TextInput, ActivityIndicator, Alert,
  Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { wasJustLocked } from "../../services/apiInterceptor";
import { fetchClasses, fetchSections, fetchBranches, uploadStudentPhoto, updateEnrollment } from "../../services/StudentServiceApi";
import { getHostelEnrolledStudents, updateHostelEnrollment } from "../../services/HostelServiceApi";

import { HOST_NAME } from "../../Environment/EnvironmentConfig";

// expo-image-picker must be installed: npx expo install expo-image-picker expo-image-manipulator
let ImagePicker, ImageManipulator;
try { ImagePicker     = require('expo-image-picker');     } catch { ImagePicker     = null; }
try { ImageManipulator = require('expo-image-manipulator'); } catch { ImageManipulator = null; }

// ─── Custom Dropdown — replaces Picker, no native thread blocking ─────────────
function Dropdown({ label, value, options, onChange, disabled, loading: isLoading }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <>
      <TouchableOpacity
        style={[dd.trigger, disabled && dd.triggerDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[dd.triggerTxt, !selected?.value && dd.placeholder]} numberOfLines={1}>
          {isLoading ? "Loading…" : (selected?.label ?? label)}
        </Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color="#6366f1" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={dd.sheet}>
            <Text style={dd.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={o => o.value}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[dd.option, o.value === value && dd.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[dd.optionTxt, o.value === value && dd.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {o.value === value && <Feather name="check" size={14} color="#6366f1" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={dd.sep} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─── Stable separator ─────────────────────────────────────────────────────────
const Separator = () => <View style={{ height: 12 }} />;

// ─── Photo Update Modal ───────────────────────────────────────────────────────
function PhotoUpdateModal({ visible, student, user, onClose, onSuccess }) {
  const [photo,      setPhoto]      = useState(null); // { uri, fileName, type }
  const [uploading,  setUploading]  = useState(false);
  const [progress,   setProgress]   = useState(0);

  // Reset state every time modal opens
  useEffect(() => {
    if (visible) { setPhoto(null); setProgress(0); }
  }, [visible]);

  const compress = async (asset) => {
    if (!ImageManipulator) return asset;
    const result = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: 600 } }],
      { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG }
    );
    return { ...asset, uri: result.uri, type: 'image/jpeg' };
  };

  const pickFrom = async (source) => {
    if (!ImagePicker) {
      Alert.alert("Missing package", "Run: npx expo install expo-image-picker expo-image-manipulator");
      return;
    }
    try {
      let perm, result;
      if (source === 'camera') {
        perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') { Alert.alert("Permission required", "Allow camera access."); return; }
        result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [3, 4], quality: 1 });
      } else {
        perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') { Alert.alert("Permission required", "Allow photo library access."); return; }
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4], quality: 1 });
      }
      if (!result.canceled && result.assets?.[0]) {
        const compressed = await compress(result.assets[0]);
        setPhoto(compressed);
      }
    } catch (e) {
      Alert.alert("Error", e.message || "Could not open picker");
    }
  };

  const handleUpload = async () => {
    if (!photo) { Alert.alert("No photo", "Please select or take a photo first."); return; }
    try {
      setUploading(true);
      setProgress(0);
      await uploadStudentPhoto(user, student.registrationNo, photo, setProgress);
      Alert.alert("✅ Success", "Student photo updated successfully.");
      onSuccess?.();
      onClose();
    } catch (e) {
      Alert.alert("Upload failed", e.message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  if (!student) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ph.overlay} onPress={!uploading ? onClose : undefined} activeOpacity={1}>
        <TouchableOpacity style={ph.sheet} onPress={() => {}} activeOpacity={1}>
          <View style={ph.handle} />
          <Text style={ph.title}>Update Student Photo</Text>
          <Text style={ph.subtitle}>{student.firstName} {student.lastName} • {student.registrationNo}</Text>

          {/* Preview */}
          <View style={ph.previewWrap}>
            {photo
              ? <Image source={{ uri: photo.uri }} style={ph.preview} />
              : <View style={ph.previewPlaceholder}>
                  <Feather name="user" size={52} color="#a5b4fc" />
                  <Text style={ph.previewHint}>No photo selected</Text>
                </View>}
          </View>

          {/* Source buttons */}
          <View style={ph.sourceRow}>
            <TouchableOpacity style={ph.sourceBtn} onPress={() => pickFrom('camera')} disabled={uploading}>
              <Feather name="camera" size={20} color="#6366f1" />
              <Text style={ph.sourceTxt}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ph.sourceBtn} onPress={() => pickFrom('library')} disabled={uploading}>
              <Feather name="image" size={20} color="#6366f1" />
              <Text style={ph.sourceTxt}>Gallery</Text>
            </TouchableOpacity>
          </View>

          {/* Progress bar */}
          {uploading && (
            <View style={ph.progressWrap}>
              <View style={ph.progressTrack}>
                <View style={[ph.progressFill, { width: `${progress}%` }]} />
              </View>
              <Text style={ph.progressTxt}>Uploading… {progress}%</Text>
            </View>
          )}

          {/* Upload button */}
          <TouchableOpacity
            style={[ph.uploadBtn, (!photo || uploading) && ph.uploadBtnDisabled]}
            onPress={handleUpload}
            disabled={!photo || uploading}
          >
            {uploading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Feather name="upload" size={18} color="#fff" />}
            <Text style={ph.uploadTxt}>{uploading ? "Uploading…" : "Upload Photo"}</Text>
          </TouchableOpacity>

          {/* Cancel */}
          {!uploading && (
            <TouchableOpacity style={ph.cancelBtn} onPress={onClose}>
              <Text style={ph.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Update Enrollment Modal ──────────────────────────────────────────────────
function UpdateEnrollmentModal({ visible, student, user, onClose, onSuccess }) {
  const [branches,       setBranches]       = useState([]);
  const [classes,        setClasses]        = useState([]);
  const [sections,       setSections]       = useState([]);
  const [branchId,       setBranchId]       = useState("");
  const [classId,        setClassId]        = useState("");
  const [sectionId,      setSectionId]      = useState("");
  const [loadingInit,    setLoadingInit]     = useState(false);
  const [loadingSections,setLoadingSections] = useState(false);
  const [saving,         setSaving]          = useState(false);

  // Pre-populate with current enrollment values when modal opens
  useEffect(() => {
    if (!visible || !student) return;
    setBranchId(String(student.branchId  ?? ""));
    setClassId( String(student.classId   ?? ""));
    setSectionId(String(student.sectionId ?? student.section ?? ""));

    let dead = false;
    setLoadingInit(true);
    Promise.all([
      fetchBranches(user),
      fetchClasses(user),
    ])
      .then(([br, cl]) => {
        if (dead) return;
        setBranches(br || []);
        setClasses(cl  || []);
      })
      .catch(e => { if (!dead) Alert.alert("Error", e.message); })
      .finally(() => { if (!dead) setLoadingInit(false); });
    return () => { dead = true; };
  }, [visible, student]);

  // Load sections whenever classId changes inside this modal
  useEffect(() => {
    setSections([]);
    if (!classId) return;
    let dead = false;
    setLoadingSections(true);
    fetchSections(user, classId)
      .then(d  => { if (!dead) setSections(d || []); })
      .catch(() => {})
      .finally(() => { if (!dead) setLoadingSections(false); });
    return () => { dead = true; };
  }, [classId]);

  const handleSave = async () => {
    if (!classId)   { Alert.alert("Validation", "Please select a class.");   return; }
    if (!sectionId) { Alert.alert("Validation", "Please select a section."); return; }
    try {
      setSaving(true);
      await updateEnrollment(user, {
        enrollmentId: student.enrollmentId,
        branchId:     branchId  || null,
        classId:      classId,
        sectionId:    sectionId,
      });
      Alert.alert("✅ Updated", "Enrollment updated successfully.");
      onSuccess?.();
      onClose();
    } catch (e) {
      Alert.alert("Update Failed", e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!student) return null;

  const branchOptions  = [
    { label: "— Select Branch —",  value: "" },
    ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
  ];
  const classOptions   = [
    { label: "— Select Class —",   value: "" },
    ...classes.map(c  => ({ label: c.class_name,   value: String(c.class_id)   })),
  ];
  const sectionOptions = [
    { label: classId ? "— Select Section —" : "Select class first", value: "" },
    ...sections.map(s => ({
      label: s.section_name ?? s.section ?? `Section ${s}`,
      value: String(s.section_id ?? s.section_name ?? s.section ?? s),
    })),
  ];

  const hasChanged =
    String(student.branchId  ?? "") !== branchId  ||
    String(student.classId   ?? "") !== classId   ||
    String(student.sectionId ?? student.section ?? "") !== sectionId;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ue.overlay} onPress={!saving ? onClose : undefined} activeOpacity={1}>
        <TouchableOpacity style={ue.sheet} onPress={() => {}} activeOpacity={1}>
          <View style={ue.handle} />

          {/* Header */}
          <Text style={ue.title}>Update Enrollment</Text>
          <View style={ue.studentBadge}>
            <Feather name="user" size={14} color="#6366f1" />
            <Text style={ue.studentBadgeTxt} numberOfLines={1}>
              {student.firstName} {student.lastName}  •  {student.enrollmentId}
            </Text>
          </View>

          {loadingInit
            ? <View style={ue.loadingWrap}>
                <ActivityIndicator color="#6366f1" />
                <Text style={ue.loadingTxt}>Loading options…</Text>
              </View>
            : <>
                {/* Current values info row */}
                <View style={ue.currentRow}>
                  <View style={ue.currentItem}>
                    <Text style={ue.currentLabel}>Current Class</Text>
                    <Text style={ue.currentValue}>{student.className ?? "—"}</Text>
                  </View>
                  <View style={ue.currentItem}>
                    <Text style={ue.currentLabel}>Current Section</Text>
                    <Text style={ue.currentValue}>{student.section ?? "—"}</Text>
                  </View>
                </View>

                {/* Branch */}
                <Text style={ue.fieldLabel}>Branch</Text>
                <Dropdown
                  label="— Select Branch —"
                  value={branchId}
                  options={branchOptions}
                  onChange={setBranchId}
                  disabled={saving}
                />

                {/* Class */}
                <Text style={ue.fieldLabel}>New Class</Text>
                <Dropdown
                  label="— Select Class —"
                  value={classId}
                  options={classOptions}
                  onChange={(val) => { setClassId(val); setSectionId(""); }}
                  disabled={saving}
                />

                {/* Section */}
                <Text style={ue.fieldLabel}>
                  New Section{loadingSections ? "  (loading…)" : ""}
                </Text>
                <Dropdown
                  label={classId ? "— Select Section —" : "Select class first"}
                  value={sectionId}
                  options={sectionOptions}
                  onChange={setSectionId}
                  disabled={!classId || loadingSections || saving}
                  loading={loadingSections}
                />

                {/* Save button */}
                <TouchableOpacity
                  style={[ue.saveBtn, (!hasChanged || saving) && ue.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={!hasChanged || saving}
                >
                  {saving
                    ? <><ActivityIndicator color="#fff" size="small" /><Text style={ue.saveTxt}> Saving…</Text></>
                    : <><Feather name="check-circle" size={18} color="#fff" /><Text style={ue.saveTxt}> Save Changes</Text></>}
                </TouchableOpacity>

                {/* Cancel */}
                {!saving && (
                  <TouchableOpacity style={ue.cancelBtn} onPress={onClose}>
                    <Text style={ue.cancelTxt}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </>}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Action Menu ─────────────────────────────────────────────────────────────
function ActionMenu({ visible, student, onClose, navigation, canFinance, isAdminOrOwner, onUpdatePhoto, onUpdateEnrollment }) {
  if (!student) return null;

  const actions = [
    { icon: "eye",         label: "View Details",       color: "#2563eb", bg: "#eff6ff",
      onPress: () => navigation.navigate("StudentProfile", { student, studentId: student.id ?? student.registrationNo }) },
    ...(canFinance ? [
      { icon: "dollar-sign", label: "Payments",          color: "#16a34a", bg: "#f0fdf4",
        onPress: () => navigation.navigate("HostelFee", {
          enrollmentId: student.enrollmentId, registrationId: student.id,
          classId: student.classId, sessionId: student.sessionId,
          branchId: student.branchId, ssmsClientCode: student.ssmsClientCode,
          studentsName: `${student.firstName} ${student.lastName}`, className: student.className,
        }) },
      { icon: "clock",       label: "Payment History",   color: "#0369a1", bg: "#f0f9ff",
        onPress: () => navigation.navigate("HostelFee", {
          enrollmentId: student.enrollmentId, registrationId: student.id,
          classId: student.classId, sessionId: student.sessionId,
          branchId: student.branchId, ssmsClientCode: student.ssmsClientCode,
          studentsName: `${student.firstName} ${student.lastName}`, className: student.className,
          initialTab: "history",
        }) },
    ] : []),
    { icon: "credit-card", label: "ID Card",             color: "#7c3aed", bg: "#f5f3ff",
      onPress: () => navigation.navigate("StudentIdCard", { preselect: { classId: student.classId, sessionId: student.sessionId } }) },
    { icon: "camera",      label: "Update Photo",        color: "#0891b2", bg: "#ecfeff",
      onPress: () => onUpdatePhoto(student) },
    ...(isAdminOrOwner ? [
      { icon: "refresh-cw",  label: "Update Enrollment",  color: "#059669", bg: "#ecfdf5",
        onPress: () => onUpdateEnrollment(student) },
    ] : []),
    // { icon: "home",        label: "Hostel Enrollment",    color: "#b45309", bg: "#fffbeb",
    //   onPress: () => navigation.navigate("HostelEnrollment", { student }) },
    { icon: "truck",       label: "Transport Enrollment", color: "#0f766e", bg: "#f0fdfa",
      onPress: () => navigation.navigate("TransportEnrollment", { student }) },
    ...(isAdminOrOwner ? [
      { icon: "edit-2",    label: "Edit Profile",        color: "#475569", bg: "#f8fafc",
        onPress: () => navigation.navigate("StudentProfile", { student, studentId: student.id ?? student.registrationNo, editMode: true }) },
    ] : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={am.overlay} onPress={onClose} activeOpacity={1}>
        <TouchableOpacity style={am.sheet} onPress={() => {}} activeOpacity={1}>
          <View style={am.handle} />
          <View style={am.studentRow}>
            <View style={am.avatar}><Feather name="user" size={20} color="#6366f1" /></View>
            <View style={{ flex: 1 }}>
              <Text style={am.studentName} numberOfLines={1}>{student.firstName} {student.lastName}</Text>
              <Text style={am.studentMeta}>{student.className}{student.section ? ` • Sec ${student.section}` : ""} • {student.enrollmentId}</Text>
            </View>
          </View>
          <View style={am.grid}>
            {actions.map(a => (
              <TouchableOpacity key={a.label} style={[am.item, { backgroundColor: a.bg }]}
                onPress={() => { onClose(); setTimeout(a.onPress, 300); }}>
                <View style={[am.itemIcon, { backgroundColor: a.color + "22" }]}>
                  <Feather name={a.icon} size={20} color={a.color} />
                </View>
                <Text style={[am.itemLabel, { color: a.color }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={am.cancel} onPress={onClose}>
            <Text style={am.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Student Card ─────────────────────────────────────────────────────────────
const StudentCard = React.memo(function StudentCard({ item, navigation, canFinance, ssmsClientCode, onMore }) {
  const photoUri = item.photo
    ? `${HOST_NAME}/clients/${item.ssmsClientCode ?? ssmsClientCode}/Students/${item.registrationNo}/${item.photo}`
    : null;
  return (
    <View style={cs.card}>
      <View style={cs.photoWrap}>
        {photoUri
          ? <Image source={{ uri: photoUri }} style={cs.photo} />
          : <View style={cs.photoPlaceholder}><Feather name="user" size={30} color="#6366f1" /></View>}
        <View style={cs.badge}>
          <Text style={cs.badgeTxt} numberOfLines={1}>{item.className ?? `C${item.classId ?? ""}`}</Text>
        </View>
      </View>
      <View style={cs.info}>
        <Text style={cs.name} numberOfLines={2}>{item.firstName} {item.lastName}</Text>
        <View style={cs.metaRow}><Feather name="hash" size={10} color="#6366f1" /><Text style={cs.metaTxt}>{item.enrollmentId}</Text></View>
        {!!item.section && <View style={cs.metaRow}><Feather name="grid" size={10} color="#64748b" /><Text style={cs.metaTxt}>Sec {item.section}</Text></View>}
      </View>
      <View style={cs.actions}>
        <TouchableOpacity style={cs.btn}
          onPress={() => navigation.navigate("StudentProfile", { student: item, studentId: item.id ?? item.registrationNo })}>
          <Feather name="eye" size={13} color="#2563eb" />
          <Text style={[cs.btnTxt, { color: "#2563eb" }]}>Details</Text>
        </TouchableOpacity>
        {canFinance && (
          <TouchableOpacity style={[cs.btn, cs.btnGreen]}
            onPress={() => navigation.navigate("HostelFee", {
              enrollmentId: item.enrollmentId, registrationId: item.id,
              classId: item.classId, sessionId: item.sessionId,
              branchId: item.branchId, ssmsClientCode: item.ssmsClientCode,
              studentsName: `${item.firstName} ${item.lastName}`, className: item.className,
            })}>
            <Feather name="dollar-sign" size={13} color="#16a34a" />
            <Text style={[cs.btnTxt, { color: "#16a34a" }]}>Pay</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[cs.btn, cs.btnMore]} onPress={() => onMore(item)}>
          <Feather name="more-horizontal" size={13} color="#7c3aed" />
          <Text style={[cs.btnTxt, { color: "#7c3aed" }]}>More</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Card Row ─────────────────────────────────────────────────────────────────
const CardRow = React.memo(function CardRow({ left, right, navigation, canFinance, ssmsClientCode, onMore }) {
  return (
    <View style={sc.row}>
      <StudentCard item={left} navigation={navigation} canFinance={canFinance} ssmsClientCode={ssmsClientCode} onMore={onMore} />
      {right
        ? <StudentCard item={right} navigation={navigation} canFinance={canFinance} ssmsClientCode={ssmsClientCode} onMore={onMore} />
        : <View style={cs.phantom} />}
    </View>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HostelEnrolledStudentsScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const userRole       = (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim();
  const isAdminOrOwner = ['admin','owner'].includes(userRole);
  const canFinance     = isAdminOrOwner;

  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  const [classes,         setClasses]        = useState([]);
  const [sections,        setSections]       = useState([]);
  const [classId,         setClassId]        = useState("");
  const [section,         setSection]        = useState("");
  const [searchText,      setSearchText]     = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loadingFilters,  setLoadingFilters] = useState(true);
  const [loadingSections, setLoadingSections]= useState(false);
  const [students,        setStudents]       = useState([]);
  const [page,            setPage]           = useState(1);
  const [hasNextPage,     setHasNextPage]    = useState(true);
  const [loading,         setLoading]        = useState(true);
  const [loadingMore,     setLoadingMore]    = useState(false);
  const [refreshing,      setRefreshing]     = useState(false);
  const [menuStudent,     setMenuStudent]    = useState(null);
  const [menuVisible,     setMenuVisible]    = useState(false);
  const [photoStudent,    setPhotoStudent]   = useState(null);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);
  const [enrollStudent,   setEnrollStudent]  = useState(null);
  const [enrollModalVisible, setEnrollModalVisible] = useState(false);

  const openMenu       = useCallback((s) => { setMenuStudent(s);  setMenuVisible(true);  }, []);
  const closeMenu      = useCallback(() => setMenuVisible(false), []);
  const openPhotoModal = useCallback((s) => { setPhotoStudent(s);  setPhotoModalVisible(true); }, []);
  const closePhotoModal = useCallback(() => setPhotoModalVisible(false), []);
  const openEnrollModal = useCallback((s) => { setEnrollStudent(s); setEnrollModalVisible(true); }, []);
  const closeEnrollModal = useCallback(() => setEnrollModalVisible(false), []);

  const handlePhotoSuccess = useCallback(() => {
    fetchStudents({ pg: 1, reset: true, cls: classId, sec: section, srch: debouncedSearch });
  }, [fetchStudents, classId, section, debouncedSearch]);

  const handleEnrollSuccess = useCallback(() => {
    fetchStudents({ pg: 1, reset: true, cls: classId, sec: section, srch: debouncedSearch });
  }, [fetchStudents, classId, section, debouncedSearch]);

  // Search debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText.trim()), 500);
    return () => clearTimeout(t);
  }, [searchText]);

  // Load classes once
  const userToken = user?.token ?? "";
  useEffect(() => {
    if (!userToken) return;
    let dead = false;
    setLoadingFilters(true);
    fetchClasses(userRef.current)
      .then(d  => { if (!dead) setClasses(d || []); })
      .catch(e => { if (!dead) Alert.alert("Error", e.message); })
      .finally(()=> { if (!dead) setLoadingFilters(false); });
    return () => { dead = true; };
  }, [userToken]);

  // Load sections when classId changes
  useEffect(() => {
    setSections([]);
    if (!classId) return;
    let dead = false;
    setLoadingSections(true);
    fetchSections(userRef.current, classId)
      .then(d  => { if (!dead) setSections(d || []); })
      .catch(() => {})
      .finally(()=> { if (!dead) setLoadingSections(false); });
    return () => { dead = true; };
  }, [classId]);

  // Core fetch — all params explicit, zero stale-closure risk
  const fetchStudents = useCallback(async ({ pg=1, reset=false, isRefresh=false, cls="", sec="", srch="" }) => {
    console.log("Fetching students with", { pg, reset, isRefresh, cls, sec, srch });
    try {
      if (reset) setLoading(pg === 1 && !isRefresh);
      else       setLoadingMore(true);
      const result = await getHostelEnrolledStudents(userRef.current, { page: pg, limit: 20, classId: cls, section: sec, search: srch });
      const rows = result.students   || [];
      const pagi = result.pagination || {};
      setStudents(prev => reset ? rows : [...prev, ...rows]);
      setPage(pg);
      setHasNextPage(Boolean(pagi.hasNextPage));
    } catch (e) {
      // Stop "load more" retrying forever (an empty list keeps firing onEndReached)
      setHasNextPage(false);
      if (!wasJustLocked()) Alert.alert("Error", e.message || "Failed to load students");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, []); // no deps — values passed as params

  // Trigger fetch when filters change
  useEffect(() => {
    fetchStudents({ pg: 1, reset: true, cls: classId, sec: section, srch: debouncedSearch });
  }, [classId, section, debouncedSearch, fetchStudents]);

  const handleClassChange   = useCallback((val) => { setClassId(val); setSection(""); }, []);
  const handleSectionChange = useCallback((val) => setSection(val), []);

  const handleRefresh  = useCallback(() => {
    setRefreshing(true);
    fetchStudents({ pg: 1, reset: true, isRefresh: true, cls: classId, sec: section, srch: debouncedSearch });
  }, [fetchStudents, classId, section, debouncedSearch]);

  const handleLoadMore = useCallback(() => {
    if (!loading && !loadingMore && hasNextPage)
      fetchStudents({ pg: page + 1, cls: classId, sec: section, srch: debouncedSearch });
  }, [loading, loadingMore, hasNextPage, page, fetchStudents, classId, section, debouncedSearch]);

  const studentRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < students.length; i += 2)
      rows.push({ key: `r${students[i]?.enrollmentId ?? i}`, left: students[i], right: students[i+1] ?? null });
    return rows;
  }, [students]);

  const classOptions = useMemo(() => [
    { label: "All Classes", value: "" },
    ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) })),
  ], [classes]);

  const sectionOptions = useMemo(() => [
    { label: classId ? "All Sections" : "Select class first", value: "" },
    ...sections.map(s => ({
      label: s.section_name ?? s.section ?? `Section ${s}`,
      value: s.section_name ?? s.section ?? String(s),
    })),
  ], [sections, classId]);

  const ssmsClientCode = user?.ssmsClientCode ?? "";

  const renderRow = useCallback(({ item }) => (
    <CardRow left={item.left} right={item.right}
      navigation={navigation} canFinance={canFinance}
      ssmsClientCode={ssmsClientCode} onMore={openMenu} />
  ), [canFinance, ssmsClientCode, openMenu]);

  const renderFooter = useCallback(() =>
    loadingMore
      ? <View style={sc.footerWrap}><ActivityIndicator size="small" color="#6366f1" /><Text style={sc.footerTxt}>Loading more…</Text></View>
      : <View style={{ height: 24 }} />,
  [loadingMore]);

  return (
    <View style={sc.container}>
      <FlatList
        data={studentRows}
        keyExtractor={r => r.key}
        renderItem={renderRow}
        numColumns={1}
        ItemSeparatorComponent={Separator}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={sc.listContent}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={renderFooter}
        removeClippedSubviews
        maxToRenderPerBatch={6}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={sc.header}>
            {/* Search */}
            <View style={sc.searchWrap}>
              <Feather name="search" size={16} color="#94a3b8" style={{ marginRight: 8 }} />
              <TextInput style={sc.searchInput} placeholder="Search by name, enr no…"
                placeholderTextColor="#94a3b8" value={searchText} onChangeText={setSearchText} />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText("")}>
                  <Feather name="x" size={16} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Custom dropdowns — no native Picker */}
            <View style={sc.filterRow}>
              <View style={sc.filterCol}>
                <Text style={sc.filterLabel}>Class</Text>
                <Dropdown label="All Classes" value={classId}
                  options={classOptions} onChange={handleClassChange}
                  disabled={loadingFilters} loading={loadingFilters} />
              </View>
              <View style={sc.filterCol}>
                <Text style={sc.filterLabel}>Section</Text>
                <Dropdown label={classId ? "All Sections" : "Select class"} value={section}
                  options={sectionOptions} onChange={handleSectionChange}
                  disabled={!classId || loadingSections} loading={loadingSections} />
              </View>
            </View>

            {/* Active chips */}
            {(classId || section || debouncedSearch) ? (
              <View style={sc.chips}>
                {classId ? (
                  <View style={sc.chip}>
                    <Text style={sc.chipTxt}>{classOptions.find(c => c.value === classId)?.label}</Text>
                    <TouchableOpacity onPress={() => handleClassChange("")}><Feather name="x" size={11} color="#6366f1" /></TouchableOpacity>
                  </View>
                ) : null}
                {section ? (
                  <View style={sc.chip}>
                    <Text style={sc.chipTxt}>Sec {section}</Text>
                    <TouchableOpacity onPress={() => setSection("")}><Feather name="x" size={11} color="#6366f1" /></TouchableOpacity>
                  </View>
                ) : null}
                {debouncedSearch ? (
                  <View style={sc.chip}>
                    <Text style={sc.chipTxt}>"{debouncedSearch}"</Text>
                    <TouchableOpacity onPress={() => setSearchText("")}><Feather name="x" size={11} color="#6366f1" /></TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Count / loader / empty */}
            {students.length > 0 && (
              <Text style={sc.countTxt}>{students.length} student{students.length !== 1 ? "s" : ""}{hasNextPage ? "+" : ""}</Text>
            )}
            {loading && (
              <View style={sc.listLoader}>
                <ActivityIndicator color="#6366f1" />
                <Text style={sc.listLoaderTxt}>Loading students…</Text>
              </View>
            )}
            {!loading && students.length === 0 && (
              <View style={sc.empty}>
                <Feather name="users" size={44} color="#cbd5e1" />
                <Text style={sc.emptyTitle}>No students found</Text>
                <Text style={sc.emptyText}>Try adjusting your filters</Text>
              </View>
            )}
          </View>
        }
      />

      <ActionMenu visible={menuVisible} student={menuStudent} onClose={closeMenu}
        navigation={navigation} canFinance={canFinance} isAdminOrOwner={isAdminOrOwner}
        onUpdatePhoto={(s) => { closeMenu(); setTimeout(() => openPhotoModal(s), 350); }}
        onUpdateEnrollment={(s) => { closeMenu(); setTimeout(() => openEnrollModal(s), 350); }} />

      <PhotoUpdateModal
        visible={photoModalVisible}
        student={photoStudent}
        user={user}
        onClose={closePhotoModal}
        onSuccess={handlePhotoSuccess}
      />

      <UpdateEnrollmentModal
        visible={enrollModalVisible}
        student={enrollStudent}
        user={user}
        onClose={closeEnrollModal}
        onSuccess={handleEnrollSuccess}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const dd = StyleSheet.create({
  trigger:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1, borderColor: "#e0e7ff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 46 },
  triggerDisabled:{ opacity: 0.45 },
  triggerTxt:     { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "500" },
  placeholder:    { color: "#94a3b8" },
  overlay:        { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:          { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  sheetTitle:     { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 12 },
  option:         { paddingVertical: 13, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optionActive:   { backgroundColor: "#ede9fe", borderRadius: 10, paddingHorizontal: 10 },
  optionTxt:      { fontSize: 14, color: "#334155", fontWeight: "500" },
  optionTxtActive:{ color: "#6366f1", fontWeight: "700" },
  sep:            { height: 1, backgroundColor: "#f1f5f9" },
});

const cs = StyleSheet.create({
  card:        { flex: 1, backgroundColor: "#fff", borderRadius: 18, overflow: "hidden", elevation: 2, shadowColor: "#6366f1", shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, borderWidth: 1, borderColor: "#e0e7ff" },
  phantom:     { flex: 1 },
  photoWrap:   { position: "relative", width: "100%", height: 130, backgroundColor: "#f5f3ff" },
  photo:       { width: "100%", height: "100%", resizeMode: "cover" },
  photoPlaceholder: { width: "100%", height: "100%", backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  badge:       { position: "absolute", top: 8, right: 8, backgroundColor: "#6366f1", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 80 },
  badgeTxt:    { color: "#fff", fontSize: 9, fontWeight: "800" },
  info:        { padding: 10, paddingBottom: 6 },
  name:        { fontSize: 13, fontWeight: "800", color: "#0f172a", marginBottom: 5, lineHeight: 17 },
  metaRow:     { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  metaTxt:     { fontSize: 10, color: "#64748b", fontWeight: "500" },
  actions:     { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#f1f5f9", marginTop: 6 },
  btn:         { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, gap: 3, backgroundColor: "#eff6ff" },
  btnGreen:    { backgroundColor: "#f0fdf4", borderLeftWidth: 1, borderRightWidth: 1, borderColor: "#f1f5f9" },
  btnMore:     { backgroundColor: "#faf5ff" },
  btnTxt:      { fontSize: 10, fontWeight: "700" },
});

const sc = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#f8fafc" },
  listContent:  { paddingBottom: 30 },
  row:          { flexDirection: "row", gap: 10, paddingHorizontal: 16 },
  header:       { padding: 16, paddingBottom: 8 },
  searchWrap:   { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 14, marginBottom: 14, borderWidth: 1, borderColor: "#e0e7ff", height: 46 },
  searchInput:  { flex: 1, fontSize: 14, color: "#0f172a" },
  filterRow:    { flexDirection: "row", gap: 10, marginBottom: 4 },
  filterCol:    { flex: 1 },
  filterLabel:  { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 5 },
  chips:        { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip:         { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#ede9fe", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  chipTxt:      { fontSize: 11, fontWeight: "600", color: "#6366f1" },
  countTxt:     { fontSize: 12, color: "#94a3b8", fontWeight: "600", marginTop: 10, marginBottom: 4 },
  listLoader:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 20 },
  listLoaderTxt:{ color: "#6366f1", fontSize: 13, fontWeight: "600" },
  footerWrap:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  footerTxt:    { color: "#64748b", fontSize: 13 },
  empty:        { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyTitle:   { fontSize: 16, fontWeight: "700", color: "#475569" },
  emptyText:    { fontSize: 13, color: "#94a3b8" },
});

const am = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12 },
  handle:      { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  studentRow:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18, padding: 12, backgroundColor: "#f5f3ff", borderRadius: 14 },
  avatar:      { width: 40, height: 40, borderRadius: 20, backgroundColor: "#ede9fe", alignItems: "center", justifyContent: "center" },
  studentName: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  studentMeta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  grid:        { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  item:        { width: "47%", flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: "#f1f5f9" },
  itemIcon:    { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  itemLabel:   { fontSize: 12, fontWeight: "700", flex: 1 },
  cancel:      { backgroundColor: "#f1f5f9", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelTxt:   { fontSize: 15, fontWeight: "700", color: "#475569" },
});

const ph = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:            { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12 },
  handle:           { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title:            { fontSize: 18, fontWeight: "800", color: "#0f172a", textAlign: "center", marginBottom: 4 },
  subtitle:         { fontSize: 13, color: "#64748b", textAlign: "center", marginBottom: 16 },
  previewWrap:      { alignSelf: "center", marginBottom: 16 },
  preview:          { width: 140, height: 175, borderRadius: 14, borderWidth: 2.5, borderColor: "#6366f1" },
  previewPlaceholder:{ width: 140, height: 175, borderRadius: 14, borderWidth: 2, borderColor: "#e0e7ff", backgroundColor: "#f5f3ff", alignItems: "center", justifyContent: "center", gap: 10 },
  previewHint:      { fontSize: 12, color: "#94a3b8", fontWeight: "600" },
  sourceRow:        { flexDirection: "row", gap: 12, marginBottom: 16 },
  sourceBtn:        { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#f5f3ff", borderWidth: 1.5, borderColor: "#c7d2fe", borderRadius: 14, paddingVertical: 14 },
  sourceTxt:        { fontSize: 14, fontWeight: "700", color: "#6366f1" },
  progressWrap:     { marginBottom: 14 },
  progressTrack:    { height: 6, backgroundColor: "#e0e7ff", borderRadius: 3, overflow: "hidden", marginBottom: 6 },
  progressFill:     { height: "100%", backgroundColor: "#6366f1", borderRadius: 3 },
  progressTxt:      { fontSize: 12, color: "#6366f1", fontWeight: "600", textAlign: "center" },
  uploadBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#6366f1", borderRadius: 14, paddingVertical: 16, marginBottom: 10 },
  uploadBtnDisabled:{ opacity: 0.5 },
  uploadTxt:        { fontSize: 15, fontWeight: "800", color: "#fff" },
  cancelBtn:        { backgroundColor: "#f1f5f9", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelTxt:        { fontSize: 15, fontWeight: "700", color: "#475569" },
});
const ue = StyleSheet.create({
  overlay:        { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:          { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12, maxHeight: "90%" },
  handle:         { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title:          { fontSize: 18, fontWeight: "800", color: "#0f172a", textAlign: "center", marginBottom: 8 },
  studentBadge:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#ede9fe", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "center", marginBottom: 16 },
  studentBadgeTxt:{ fontSize: 12, fontWeight: "600", color: "#6366f1" },
  loadingWrap:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 30 },
  loadingTxt:     { fontSize: 14, color: "#6366f1", fontWeight: "600" },
  currentRow:     { flexDirection: "row", gap: 10, marginBottom: 16, padding: 12, backgroundColor: "#f8fafc", borderRadius: 14, borderWidth: 1, borderColor: "#e0e7ff" },
  currentItem:    { flex: 1 },
  currentLabel:   { fontSize: 10, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  currentValue:   { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  fieldLabel:     { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 6, marginTop: 12 },
  saveBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#059669", borderRadius: 14, paddingVertical: 16, marginTop: 20, marginBottom: 10 },
  saveBtnDisabled:{ opacity: 0.45 },
  saveTxt:        { fontSize: 15, fontWeight: "800", color: "#fff" },
  cancelBtn:      { backgroundColor: "#f1f5f9", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  cancelTxt:      { fontSize: 15, fontWeight: "700", color: "#475569" },
});