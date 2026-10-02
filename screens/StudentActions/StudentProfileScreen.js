// screens/StudentActions/StudentProfileScreen.js
import React, { useContext, useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, Image, ScrollView, TextInput,
  TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  Modal, FlatList, Platform, Dimensions,
} from "react-native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AuthContext } from "../../context/AuthContext";
import { HOST_NAME } from "../../Environment/EnvironmentConfig";
import { fetchStudent, updateStudent } from "../../services/StudentServiceApi";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  primary:  '#2563eb',
  violet:   '#7c3aed',
  emerald:  '#059669',
  cyan:     '#0284c7',
  gold:     '#f59e0b',
  red:      '#dc2626',
  bg:       '#eef2f7',
  card:     '#ffffff',
  text:     '#0f172a',
  sub:      '#334155',
  muted:    '#64748b',
  border:   '#e2e8f0',
  light:    '#f8fafc',
};

const TABS = [
  { label: 'Personal', icon: 'user',      color: C.primary },
  { label: 'Academic', icon: 'book-open', color: C.violet  },
  { label: 'Parents',  icon: 'users',     color: C.emerald },
  { label: 'Address',  icon: 'map-pin',   color: C.cyan    },
];

// ── Course medium options ─────────────────────────────────────────────────────
const MEDIUM_OPTIONS = [
  { label: "Select Medium", value: "" },
  { label: "English",   value: "English"   },
  { label: "Hindi",     value: "Hindi"     },
  { label: "Urdu",      value: "Urdu"      },
  { label: "Arabic",    value: "Arabic"    },
  { label: "Assamese",  value: "Assamese"  },
  { label: "Bengali",   value: "Bengali"   },
  { label: "Dogri",     value: "Dogri"     },
  { label: "Gujarati",  value: "Gujarati"  },
  { label: "Kannada",   value: "Kannada"   },
  { label: "Kashmiri",  value: "Kashmiri"  },
  { label: "Maithili",  value: "Maithili"  },
  { label: "Malayalam", value: "Malayalam" },
  { label: "Marathi",   value: "Marathi"   },
  { label: "Nepali",    value: "Nepali"    },
  { label: "Odia",      value: "Odia"      },
  { label: "Pali",      value: "Pali"      },
  { label: "Prakrit",   value: "Prakrit"   },
  { label: "Punjabi",   value: "Punjabi"   },
  { label: "Sindhi",    value: "Sindhi"    },
  { label: "Tamil",     value: "Tamil"     },
  { label: "Telugu",    value: "Telugu"    },
  { label: "Others",    value: "Others"    },
];

const ENROLL_STATUS_OPTIONS = [
  { label: 'Select Status', value: ''          },
  { label: 'Pending',       value: 'pending'   },
  { label: 'Enrolled',      value: 'enrolled'  },
  { label: 'Cancelled',     value: 'cancelled' },
];

const BLOOD_GROUP_OPTIONS = [
  { label: 'Select Blood Group', value: '' },
  { label: 'A+',  value: 'A+'  },
  { label: 'A-',  value: 'A-'  },
  { label: 'B+',  value: 'B+'  },
  { label: 'B-',  value: 'B-'  },
  { label: 'AB+', value: 'AB+' },
  { label: 'AB-', value: 'AB-' },
  { label: 'O+',  value: 'O+'  },
  { label: 'O-',  value: 'O-'  },
];

// ── Calendar helpers ──────────────────────────────────────────────────────────
const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun",
                     "Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_LABELS  = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const THIS_YEAR   = new Date().getFullYear();
const YEARS       = Array.from({ length: THIS_YEAR - 1940 + 1 }, (_, i) => THIS_YEAR - i);

const parseDateSafe = (str) => {
  if (!str) return null;
  const s = typeof str === 'string' ? str.trim() : String(str);
  // Parse YYYY-MM-DD directly into local date to avoid UTC-offset shifting
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  // Fallback for any other format
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
};
const fmtYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtDisplay = (d) =>
  `${String(d.getDate()).padStart(2,'0')} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
const fmtDobStr = (str) => { const d = parseDateSafe(str); return d ? fmtDisplay(d) : (str ?? ''); };

// ── STATUS badge helper ───────────────────────────────────────────────────────
const STATUS_META = {
  active:   { bg: '#dcfce7', text: '#15803d', label: 'Active'   },
  pending:  { bg: '#fef9c3', text: '#b45309', label: 'Pending'  },
  inactive: { bg: '#fee2e2', text: '#b91c1c', label: 'Inactive' },
};
function StatusBadge({ status }) {
  const s = status?.toLowerCase() ?? 'pending';
  const m = STATUS_META[s] ?? STATUS_META.pending;
  return (
    <View style={[hd.badge, { backgroundColor: m.bg }]}>
      <View style={[hd.badgeDot, { backgroundColor: m.text }]} />
      <Text style={[hd.badgeTxt, { color: m.text }]}>{m.label}</Text>
    </View>
  );
}

// ── INFO ROW (view mode) ──────────────────────────────────────────────────────
function InfoRow({ label, value, icon, color }) {
  const clr = color ?? C.primary;
  return (
    <View style={ir.wrap}>
      <View style={[ir.iconBox, { backgroundColor: clr + '18' }]}>
        <Feather name={icon} size={13} color={clr} />
      </View>
      <View style={ir.body}>
        <Text style={ir.label}>{label}</Text>
        <Text style={ir.value} numberOfLines={2}>{value || '—'}</Text>
      </View>
    </View>
  );
}

// ── EDIT FIELD (edit mode) — matches FieldRef style from StudentRegistrationScreen
function EditField({ label, ref_, keyboard, icon, multiline }) {
  return (
    <View style={ef.wrap}>
      <Text style={ef.label}>{label}</Text>
      <View style={ef.row}>
        {icon && <MaterialIcons name={icon} size={17} color={C.muted} style={ef.icon} />}
        <TextInput
          style={[ef.input, multiline && { height: 80, textAlignVertical: 'top' }]}
          defaultValue={ref_.current}
          onChangeText={v => { ref_.current = v; }}
          keyboardType={keyboard ?? 'default'}
          placeholderTextColor={C.muted}
          placeholder={label}
          autoCorrect={false}
          multiline={!!multiline}
        />
      </View>
    </View>
  );
}

// ── EDIT DATE FIELD — matches st.dateBtn style from StudentRegistrationScreen
function EditDateField({ label, ref_ }) {
  const [display, setDisplay] = useState(() => fmtDobStr(ref_.current));
  const [open, setOpen]       = useState(false);
  return (
    <View style={ef.wrap}>
      <Text style={ef.label}>{label}</Text>
      <TouchableOpacity style={ef.dateBtn} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <MaterialIcons name="event" size={18} color={display ? C.primary : C.muted} />
        <Text style={[ef.dateBtnText, display && { color: C.text, fontWeight: '700' }]}>
          {display || 'Tap to pick date'}
        </Text>
      </TouchableOpacity>
      <CalendarModal
        visible={open}
        initial={parseDateSafe(ref_.current)}
        onConfirm={(d) => { ref_.current = fmtYMD(d); setDisplay(fmtDisplay(d)); setOpen(false); }}
        onCancel={() => setOpen(false)}
      />
    </View>
  );
}

// ── EDIT DROPDOWN (edit mode) — controlled, modal picker ─────────────────────
function EditDropdown({ label, value, onChange, icon, options }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <View style={ef.wrap}>
      <Text style={ef.label}>{label}</Text>
      <TouchableOpacity style={ef.row} onPress={() => setOpen(true)} activeOpacity={0.75}>
        {icon && <MaterialIcons name={icon} size={17} color={C.muted} style={ef.icon} />}
        <Text style={[ef.input, { color: value ? C.text : C.muted }]} numberOfLines={1}>
          {selected?.label || `Select ${label}`}
        </Text>
        <Feather name="chevron-down" size={15} color={C.muted} style={{ marginRight: 12 }} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dd.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={dd.sheet}>
            <Text style={dd.title}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[dd.option, o.value === value && dd.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[dd.optionTxt, o.value === value && dd.optionTxtActive]}>
                    {o.label}
                  </Text>
                  {o.value === value && <Feather name="check" size={14} color={C.primary} />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#f1f5f9' }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
const dd = StyleSheet.create({
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', paddingHorizontal: 20 },
  sheet:          { backgroundColor: '#fff', borderRadius: 18, padding: 16, maxHeight: '70%' },
  title:          { fontSize: 15, fontWeight: '800', color: C.text, marginBottom: 10 },
  option:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:   { backgroundColor: '#eff6ff' },
  optionTxt:      { fontSize: 14, color: C.text },
  optionTxtActive:{ color: C.primary, fontWeight: '700' },
});

// ── SECTION HEADER ────────────────────────────────────────────────────────────
function SectionHeader({ label, icon, color }) {
  const clr = color ?? C.primary;
  return (
    <View style={sh.row}>
      <View style={[sh.iconBox, { backgroundColor: clr }]}>
        <Feather name={icon} size={12} color="#fff" />
      </View>
      <Text style={[sh.label, { color: clr }]}>{label}</Text>
      <View style={[sh.line, { backgroundColor: clr + '30' }]} />
    </View>
  );
}

// ── MAIN SCREEN ───────────────────────────────────────────────────────────────
export default function StudentProfileScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const _params = (route && route.params) || {};
  const raw     = _params.student || {};
  const regId   = _params.regId || _params.studentId || raw.id || raw.registrationNo;
  const role   = (user?.ssmsUserRole ?? user?.role ?? '').toLowerCase().trim();
  const canEdit = role === 'admin' || role === 'owner';

  const [activeTab,      setActiveTab]      = useState(0);
  const [isEditing,      setIsEditing]      = useState(false);
  const [loading,        setLoading]        = useState(!!regId);
  const [saving,         setSaving]         = useState(false);
  const [formKey,        setFormKey]        = useState(0);
  const [courseMediumVal,  setCourseMediumVal]  = useState('');
  const [enrollStatusVal,  setEnrollStatusVal]  = useState('');
  const [bloodGroupVal,    setBloodGroupVal]    = useState('');

  // ── Display state (view mode) ─────────────────────────────────────────────
  const [disp, setDisp] = useState({
    firstName: raw.firstName ?? '', middleName: '', lastName: raw.lastName ?? '',
    gender: '', dob: '', email: '', mobile: '', placeOfBirth: '', nationality: '',
    registrationNo: raw.registrationNo ?? '', section: raw.section ?? '',
    className: raw.className ?? '', enrollStatus: '', photo: raw.photo ?? '',
    courseMedium: '', admissionType: '', physicalStatus: '',
    admissionNumber: '', admissionDate: '', caste: '', religion: '', bloodGroup: '',
    fatherName: '', fatherOccupation: '', fatherAge: '',
    motherName: '', motherOccupation: '', motherAge: '',
    cLine1: '', cLine2: '', cCity: '', cState: '', cZip: '', cPhone: '',
    pLine1: '', pLine2: '', pCity: '', pState: '', pZip: '', pPhone: '',
  });

  // ── Edit refs (one per field, top-level — Rules of Hooks) ─────────────────
  const rFirstName        = useRef(raw.firstName ?? '');
  const rMiddleName       = useRef('');
  const rLastName         = useRef(raw.lastName  ?? '');
  const rGender           = useRef('');
  const rDob              = useRef('');
  const rEmail            = useRef('');
  const rMobile           = useRef('');
  const rPlaceOfBirth     = useRef('');
  const rNationality      = useRef('');
  const rAdmissionNumber  = useRef('');
  const rAdmissionDate    = useRef('');
  const rCaste            = useRef('');
  const rReligion         = useRef('');
  const rCourseMedium     = useRef('');
  const rAdmissionType    = useRef('');
  const rPhysicalStatus   = useRef('');
  const rFatherName       = useRef('');
  const rFatherOccupation = useRef('');
  const rFatherAge        = useRef('');
  const rMotherName       = useRef('');
  const rMotherOccupation = useRef('');
  const rMotherAge        = useRef('');
  const rCLine1           = useRef('');
  const rCLine2           = useRef('');
  const rCCity            = useRef('');
  const rCState           = useRef('');
  const rCZip             = useRef('');
  const rCPhone           = useRef('');
  const rPLine1           = useRef('');
  const rPLine2           = useRef('');
  const rPCity            = useRef('');
  const rPState           = useRef('');
  const rPZip             = useRef('');
  const rPPhone           = useRef('');
  const rSection          = useRef(raw.section ?? '');
  const rRegistrationNo   = useRef(raw.registrationNo ?? '');

  // ── Sync disp state from refs ─────────────────────────────────────────────
  const pushDisp = useCallback((extra = {}) => {
    setDisp({
      firstName:       rFirstName.current,
      middleName:      rMiddleName.current,
      lastName:        rLastName.current,
      gender:          rGender.current,
      dob:             rDob.current,
      email:           rEmail.current,
      mobile:          rMobile.current,
      placeOfBirth:    rPlaceOfBirth.current,
      nationality:     rNationality.current,
      admissionNumber: rAdmissionNumber.current,
      caste:           rCaste.current,
      religion:        rReligion.current,
      registrationNo:  rRegistrationNo.current,
      section:         rSection.current,
      courseMedium:    rCourseMedium.current,
      admissionType:   rAdmissionType.current,
      physicalStatus:  rPhysicalStatus.current,
      fatherName:      rFatherName.current,
      fatherOccupation:rFatherOccupation.current,
      fatherAge:       rFatherAge.current,
      motherName:      rMotherName.current,
      motherOccupation:rMotherOccupation.current,
      motherAge:       rMotherAge.current,
      cLine1:          rCLine1.current,
      cLine2:          rCLine2.current,
      cCity:           rCCity.current,
      cState:          rCState.current,
      cZip:            rCZip.current,
      cPhone:          rCPhone.current,
      pLine1:          rPLine1.current,
      pLine2:          rPLine2.current,
      pCity:           rPCity.current,
      pState:          rPState.current,
      pZip:            rPZip.current,
      pPhone:          rPPhone.current,
      ...extra,
    });
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!regId) return;
    (async () => {
      try {
        setLoading(true);
        const s = await fetchStudent(regId, user);
        if (!s) return;
        rFirstName.current        = s.firstName        ?? s.first_name         ?? rFirstName.current;
        rMiddleName.current       = s.middleName       ?? s.middle_name        ?? '';
        rLastName.current         = s.lastName         ?? s.last_name          ?? rLastName.current;
        rGender.current           = s.gender           ?? '';
        rDob.current              = s.dob              ?? '';
        rEmail.current            = s.emailAddress     ?? s.email_address      ?? '';
        rMobile.current           = s.mobileNumber     ?? s.mobile_number      ?? '';
        rPlaceOfBirth.current     = s.placeOfBirth     ?? s.place_of_birth     ?? '';
        rNationality.current      = s.nationality      ?? '';
        rAdmissionNumber.current  = s.admissionNumber  ?? s.admission_number   ?? '';
        rAdmissionDate.current    = s.admissionDate    ?? s.admission_date     ?? '';
        rCaste.current            = s.caste            ?? '';
        rReligion.current         = s.religion         ?? '';
        rCourseMedium.current     = s.courseMedium     ?? s.course_medium      ?? '';
        setCourseMediumVal(rCourseMedium.current);
        setEnrollStatusVal(s.enrollStatus ?? '');
        setBloodGroupVal(s.bloodGroup ?? '');
        rAdmissionType.current    = s.admissionType    ?? s.admission_type     ?? '';
        rPhysicalStatus.current   = s.isPhysicallyChallenged ?? '';
        rFatherName.current       = s.fatherName       ?? s.father_name        ?? '';
        rFatherOccupation.current = s.fatherOccupation ?? s.father_occupation  ?? '';
        rFatherAge.current        = s.fatherAge != null ? String(s.fatherAge) : '';
        rMotherName.current       = s.motherName       ?? s.mother_name        ?? '';
        rMotherOccupation.current = s.motherOccupation ?? s.mother_occupation  ?? '';
        rMotherAge.current        = s.motherAge != null ? String(s.motherAge) : '';
        rSection.current          = s.section          ?? rSection.current;
        rRegistrationNo.current   = s.registrationNo   ?? rRegistrationNo.current;
        rCLine1.current           = s.cAddressLine1    ?? '';
        rCLine2.current           = s.cAddressLine2    ?? '';
        rCCity.current            = s.cAddressCity     ?? '';
        rCState.current           = s.cAddressState    ?? '';
        rCZip.current             = s.cAddressZipCode  ?? '';
        rCPhone.current           = s.cAddressHomephone ?? '';
        rPLine1.current           = s.pAddressLine1    ?? '';
        rPLine2.current           = s.pAddressLine2    ?? '';
        rPCity.current            = s.pAddressCity     ?? '';
        rPState.current           = s.pAddressState    ?? '';
        rPZip.current             = s.pAddressZipCode  ?? '';
        rPPhone.current           = s.pAddressHomephone ?? '';

        pushDisp({
          className:     s.className    ?? raw.className ?? '',
          bloodGroup:    s.bloodGroup   ?? '',
          enrollStatus:  s.enrollStatus ?? '',
          photo:         s.photo        ?? raw.photo     ?? '',
          admissionDate: s.admissionDate ?? s.admission_date ?? '',
        });
        setFormKey(k => k + 1);
      } catch (e) {
        Alert.alert('Error', e.message ?? 'Could not load student details.');
      } finally {
        setLoading(false);
      }
    })();
  }, [regId]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!regId) { Alert.alert('Error', 'Student ID not available.'); return; }
    try {
      setSaving(true);
      await updateStudent(regId, {
        firstName:              rFirstName.current,
        middleName:             rMiddleName.current,
        lastName:               rLastName.current,
        gender:                 rGender.current,
        dob:                    rDob.current,
        emailAddress:           rEmail.current,
        mobileNumber:           rMobile.current,
        placeOfBirth:           rPlaceOfBirth.current,
        nationality:            rNationality.current,
        admissionNumber:        rAdmissionNumber.current,
        admissionDate:          rAdmissionDate.current || null,
        caste:                  rCaste.current,
        religion:               rReligion.current,
        enrollStatus:           enrollStatusVal,
        courseMedium:           rCourseMedium.current,
        admissionType:          rAdmissionType.current,
        isPhysicallyChallenged: rPhysicalStatus.current,
        bloodGroup:             bloodGroupVal,
        section:                rSection.current,
        fatherName:             rFatherName.current,
        fatherOccupation:       rFatherOccupation.current,
        fatherAge:              rFatherAge.current,
        motherName:             rMotherName.current,
        motherOccupation:       rMotherOccupation.current,
        motherAge:              rMotherAge.current,
        cAddressLine1:          rCLine1.current,
        cAddressLine2:          rCLine2.current,
        cAddressCity:           rCCity.current,
        cAddressState:          rCState.current,
        cAddressZipCode:        rCZip.current,
        cAddressHomephone:      rCPhone.current,
        pAddressLine1:          rPLine1.current,
        pAddressLine2:          rPLine2.current,
        pAddressCity:           rPCity.current,
        pAddressState:          rPState.current,
        pAddressZipCode:        rPZip.current,
        pAddressHomephone:      rPPhone.current,
      }, user);
      pushDisp({ className: disp.className, enrollStatus: enrollStatusVal, bloodGroup: bloodGroupVal, photo: disp.photo });
      Alert.alert('Saved ✓', 'Student profile updated successfully.');
      setIsEditing(false);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  // ── Cancel — revert refs from disp, remount inputs ───────────────────────
  const handleCancel = useCallback(() => {
    rFirstName.current        = disp.firstName;
    rMiddleName.current       = disp.middleName;
    rLastName.current         = disp.lastName;
    rGender.current           = disp.gender;
    rDob.current              = disp.dob;
    rEmail.current            = disp.email;
    rMobile.current           = disp.mobile;
    rPlaceOfBirth.current     = disp.placeOfBirth;
    rNationality.current      = disp.nationality;
    rAdmissionNumber.current  = disp.admissionNumber;
    rAdmissionDate.current    = disp.admissionDate;
    rCaste.current            = disp.caste;
    rReligion.current         = disp.religion;
    rCourseMedium.current     = disp.courseMedium;
    setCourseMediumVal(disp.courseMedium);
    setEnrollStatusVal(disp.enrollStatus);
    setBloodGroupVal(disp.bloodGroup);
    rAdmissionType.current    = disp.admissionType;
    rPhysicalStatus.current   = disp.physicalStatus;
    rFatherName.current       = disp.fatherName;
    rFatherOccupation.current = disp.fatherOccupation;
    rFatherAge.current        = disp.fatherAge;
    rMotherName.current       = disp.motherName;
    rMotherOccupation.current = disp.motherOccupation;
    rMotherAge.current        = disp.motherAge;
    rCLine1.current           = disp.cLine1;
    rCLine2.current           = disp.cLine2;
    rCCity.current            = disp.cCity;
    rCState.current           = disp.cState;
    rCZip.current             = disp.cZip;
    rCPhone.current           = disp.cPhone;
    rPLine1.current           = disp.pLine1;
    rPLine2.current           = disp.pLine2;
    rPCity.current            = disp.pCity;
    rPState.current           = disp.pState;
    rPZip.current             = disp.pZip;
    rPPhone.current           = disp.pPhone;
    setFormKey(k => k + 1);
    setIsEditing(false);
  }, [disp]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const fullName = `${disp.firstName} ${disp.middleName} ${disp.lastName}`.replace(/\s+/g, ' ').trim();
  const photoUri = disp.photo
    ? `${HOST_NAME}/clients/${user?.ssmsClientCode}/Students/${disp.registrationNo}/${disp.photo}`
    : null;
  const tabColor = TABS[activeTab].color;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={st.loaderWrap}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={st.loaderText}>Loading student profile…</Text>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={st.root}>

      {/* ── HERO HEADER ─────────────────────────────────────────────────── */}
      <LinearGradient colors={['#1e3a8a', '#2563eb']} style={hd.gradient}>
        <View style={hd.photoRing}>
          <Image
            source={{ uri: photoUri || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(fullName || 'S') + '&background=c7d2fe&color=1e3a8a&size=200' }}
            style={hd.photo}
          />
        </View>
        <View style={hd.info}>
          <Text style={hd.name} numberOfLines={1}>{fullName || 'Student Name'}</Text>
          <View style={hd.metaRow}>
            {!!disp.registrationNo && (
              <View style={hd.metaChip}>
                <Feather name="hash" size={9} color="#93c5fd" />
                <Text style={hd.metaTxt}>{disp.registrationNo}</Text>
              </View>
            )}
            {!!disp.className && (
              <View style={hd.metaChip}>
                <Feather name="layers" size={9} color="#93c5fd" />
                <Text style={hd.metaTxt}>{disp.className}{disp.section ? ` · ${disp.section}` : ''}</Text>
              </View>
            )}
          </View>
          {!!disp.enrollStatus && <StatusBadge status={disp.enrollStatus} />}
        </View>
      </LinearGradient>

      {/* ── TAB BAR ─────────────────────────────────────────────────────── */}
      <View style={tb.bar}>
        {TABS.map((t, i) => {
          const active = i === activeTab;
          return (
            <TouchableOpacity
              key={t.label}
              style={[tb.tab, active && { backgroundColor: t.color }]}
              onPress={() => setActiveTab(i)}
              activeOpacity={0.75}
            >
              <Feather name={t.icon} size={13} color={active ? '#fff' : C.muted} />
              <Text style={[tb.tabTxt, active && tb.tabTxtActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── TAB CONTENT ─────────────────────────────────────────────────── */}
      <ScrollView
        style={st.scroll}
        contentContainerStyle={st.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View key={formKey}>

          {/* ══════════════ PERSONAL TAB ══════════════ */}
          {activeTab === 0 && (
            <View style={st.tabPane}>

              <SectionHeader label="Identity" icon="user" color={C.primary} />
              {isEditing ? (
                <>
                  <EditField label="First Name"    ref_={rFirstName}  icon="person-outline" />
                  <EditField label="Middle Name"   ref_={rMiddleName} icon="person-outline" />
                  <EditField label="Last Name"     ref_={rLastName}   icon="person-outline" />
                  <EditField label="Gender"        ref_={rGender}     icon="wc" />
                  <EditDateField label="Date of Birth" ref_={rDob} />
                </>
              ) : (
                <>
                  <InfoRow label="First Name"    value={disp.firstName}       icon="user"     color={C.primary} />
                  <InfoRow label="Middle Name"   value={disp.middleName}      icon="user"     color={C.primary} />
                  <InfoRow label="Last Name"     value={disp.lastName}        icon="user"     color={C.primary} />
                  <InfoRow label="Gender"        value={disp.gender}          icon="info"     color={C.primary} />
                  <InfoRow label="Date of Birth" value={fmtDobStr(disp.dob)} icon="calendar" color={C.primary} />
                </>
              )}

              <SectionHeader label="Contact" icon="phone" color={C.primary} />
              {isEditing ? (
                <>
                  <EditField label="Email"  ref_={rEmail}  keyboard="email-address" icon="mail-outline" />
                  <EditField label="Mobile" ref_={rMobile} keyboard="phone-pad"     icon="phone-iphone" />
                </>
              ) : (
                <>
                  <InfoRow label="Email"  value={disp.email}  icon="mail"  color={C.primary} />
                  <InfoRow label="Mobile" value={disp.mobile} icon="phone" color={C.primary} />
                </>
              )}

              <SectionHeader label="Birth & Nationality" icon="globe" color={C.primary} />
              {isEditing ? (
                <>
                  <EditField label="Place of Birth" ref_={rPlaceOfBirth} icon="place"  />
                  <EditField label="Nationality"    ref_={rNationality}  icon="public" />
                </>
              ) : (
                <>
                  <InfoRow label="Place of Birth" value={disp.placeOfBirth} icon="map-pin" color={C.primary} />
                  <InfoRow label="Nationality"    value={disp.nationality}  icon="globe"   color={C.primary} />
                </>
              )}

              <SectionHeader label="Optional Details" icon="tag" color={C.primary} />
              {isEditing ? (
                <>
                  <EditField label="Admission Number" ref_={rAdmissionNumber} icon="confirmation-number" />
                  <EditDateField label="Admission Date" ref_={rAdmissionDate} />
                  <EditField label="Caste"            ref_={rCaste}           icon="people" />
                  <EditField label="Religion"         ref_={rReligion}        icon="brightness-5" />
                  <EditDropdown
                    label="Blood Group"
                    value={bloodGroupVal}
                    onChange={v => setBloodGroupVal(v)}
                    icon="bloodtype"
                    options={BLOOD_GROUP_OPTIONS}
                  />
                </>
              ) : (
                <>
                  <InfoRow label="Admission Number" value={disp.admissionNumber}          icon="hash"     color={C.primary} />
                  <InfoRow label="Admission Date"   value={fmtDobStr(disp.admissionDate)} icon="calendar" color={C.primary} />
                  <InfoRow label="Caste"            value={disp.caste}                    icon="users"    color={C.primary} />
                  <InfoRow label="Religion"         value={disp.religion}        icon="heart"   color={C.primary} />
                  <InfoRow label="Blood Group"      value={disp.bloodGroup}      icon="droplet" color={C.primary} />
                </>
              )}
            </View>
          )}

          {/* ══════════════ ACADEMIC TAB ══════════════ */}
          {activeTab === 1 && (
            <View style={st.tabPane}>

              <SectionHeader label="Class Placement" icon="layers" color={C.violet} />
              {isEditing ? (
                <>
                  <EditField label="Section"          ref_={rSection}        icon="grid-on" />
                  <EditField label="Registration No." ref_={rRegistrationNo} icon="badge"   />
                  <EditDropdown
                    label="Enroll Status"
                    value={enrollStatusVal}
                    onChange={v => setEnrollStatusVal(v)}
                    icon="check-circle"
                    options={ENROLL_STATUS_OPTIONS}
                  />
                </>
              ) : (
                <>
                  <InfoRow label="Class"            value={disp.className}      icon="layers"       color={C.violet} />
                  <InfoRow label="Section"          value={disp.section}        icon="grid"         color={C.violet} />
                  <InfoRow label="Registration No." value={disp.registrationNo} icon="hash"         color={C.violet} />
                  <InfoRow label="Enroll Status"    value={disp.enrollStatus}   icon="check-circle" color={C.violet} />
                </>
              )}

              <SectionHeader label="Learning Profile" icon="book-open" color={C.violet} />
              {isEditing ? (
                <>
                  <EditDropdown
                    label="Course Medium"
                    value={courseMediumVal}
                    onChange={v => { setCourseMediumVal(v); rCourseMedium.current = v; }}
                    icon="translate"
                    options={MEDIUM_OPTIONS}
                  />
                  <EditField label="Admission Type"         ref_={rAdmissionType}  icon="label"        />
                  <EditField label="Physically Challenged?" ref_={rPhysicalStatus} icon="accessibility" />
                </>
              ) : (
                <>
                  <InfoRow label="Course Medium"         value={disp.courseMedium}  icon="message-circle" color={C.violet} />
                  <InfoRow label="Admission Type"        value={disp.admissionType} icon="tag"            color={C.violet} />
                  <InfoRow label="Physically Challenged" value={disp.physicalStatus} icon="activity"      color={C.violet} />
                </>
              )}
            </View>
          )}

          {/* ══════════════ PARENTS TAB ══════════════ */}
          {activeTab === 2 && (
            <View style={st.tabPane}>

              <SectionHeader label="Father's Details" icon="user" color={C.emerald} />
              {isEditing ? (
                <>
                  <EditField label="Father's Name" ref_={rFatherName}       icon="person"     />
                  <EditField label="Occupation"    ref_={rFatherOccupation} icon="work"       />
                  <EditField label="Age"           ref_={rFatherAge}        keyboard="number-pad" icon="cake" />
                </>
              ) : (
                <>
                  <InfoRow label="Father's Name" value={disp.fatherName}       icon="user"      color={C.emerald} />
                  <InfoRow label="Occupation"    value={disp.fatherOccupation} icon="briefcase" color={C.emerald} />
                  <InfoRow label="Age"           value={disp.fatherAge}        icon="calendar"  color={C.emerald} />
                </>
              )}

              <SectionHeader label="Mother's Details" icon="user" color={C.emerald} />
              {isEditing ? (
                <>
                  <EditField label="Mother's Name" ref_={rMotherName}       icon="person"     />
                  <EditField label="Occupation"    ref_={rMotherOccupation} icon="work"       />
                  <EditField label="Age"           ref_={rMotherAge}        keyboard="number-pad" icon="cake" />
                </>
              ) : (
                <>
                  <InfoRow label="Mother's Name" value={disp.motherName}        icon="user"       color={C.emerald} />
                  <InfoRow label="Occupation"    value={disp.motherOccupation}  icon="briefcase"  color={C.emerald} />
                  <InfoRow label="Age"           value={disp.motherAge}         icon="calendar"   color={C.emerald} />
                </>
              )}
            </View>
          )}

          {/* ══════════════ ADDRESS TAB ══════════════ */}
          {activeTab === 3 && (
            <View style={st.tabPane}>

              <SectionHeader label="Current Address" icon="home" color={C.cyan} />
              {isEditing ? (
                <>
                  <EditField label="Line 1" ref_={rCLine1} icon="place" />
                  <EditField label="Line 2" ref_={rCLine2} icon="place" />
                  <EditField label="City"   ref_={rCCity}  icon="location-city" />
                  <EditField label="State"  ref_={rCState} icon="map" />
                  <EditField label="ZIP"    ref_={rCZip}   keyboard="number-pad" icon="local-post-office" />
                  <EditField label="Phone"  ref_={rCPhone} keyboard="phone-pad"  icon="phone" />
                </>
              ) : (
                <>
                  <InfoRow label="Line 1" value={disp.cLine1} icon="map-pin" color={C.cyan} />
                  {!!disp.cLine2 && <InfoRow label="Line 2" value={disp.cLine2} icon="map-pin" color={C.cyan} />}
                  <InfoRow label="City"   value={disp.cCity}  icon="map"   color={C.cyan} />
                  <InfoRow label="State"  value={disp.cState} icon="map"   color={C.cyan} />
                  <InfoRow label="ZIP"    value={disp.cZip}   icon="hash"  color={C.cyan} />
                  <InfoRow label="Phone"  value={disp.cPhone} icon="phone" color={C.cyan} />
                </>
              )}

              <SectionHeader label="Permanent Address" icon="map-pin" color={C.cyan} />
              {isEditing ? (
                <>
                  <EditField label="Line 1" ref_={rPLine1} icon="place" />
                  <EditField label="Line 2" ref_={rPLine2} icon="place" />
                  <EditField label="City"   ref_={rPCity}  icon="location-city" />
                  <EditField label="State"  ref_={rPState} icon="map" />
                  <EditField label="ZIP"    ref_={rPZip}   keyboard="number-pad" icon="local-post-office" />
                  <EditField label="Phone"  ref_={rPPhone} keyboard="phone-pad"  icon="phone" />
                </>
              ) : (
                <>
                  <InfoRow label="Line 1" value={disp.pLine1} icon="map-pin" color={C.cyan} />
                  {!!disp.pLine2 && <InfoRow label="Line 2" value={disp.pLine2} icon="map-pin" color={C.cyan} />}
                  <InfoRow label="City"   value={disp.pCity}  icon="map"   color={C.cyan} />
                  <InfoRow label="State"  value={disp.pState} icon="map"   color={C.cyan} />
                  <InfoRow label="ZIP"    value={disp.pZip}   icon="hash"  color={C.cyan} />
                  <InfoRow label="Phone"  value={disp.pPhone} icon="phone" color={C.cyan} />
                </>
              )}
            </View>
          )}

        </View>

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* ── BOTTOM ACTION BAR ───────────────────────────────────────────── */}
      {canEdit && (
        <View style={ab.bar}>
          {isEditing ? (
            <>
              <TouchableOpacity style={ab.cancelBtn} onPress={handleCancel} disabled={saving}>
                <Feather name="x" size={16} color={C.muted} />
                <Text style={ab.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ab.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Feather name="check" size={16} color="#fff" /><Text style={ab.saveTxt}>Save Changes</Text></>
                }
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={[ab.editBtn, { backgroundColor: tabColor }]} onPress={() => setIsEditing(true)}>
              <Feather name="edit-2" size={16} color="#fff" />
              <Text style={ab.editTxt}>Edit Profile</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

    </View>
  );
}

// ── CALENDAR MODAL (unchanged from original) ──────────────────────────────────
function CalendarModal({ visible, initial, onConfirm, onCancel }) {
  const today   = new Date();
  const seed    = initial ?? today;
  const [mode,    setMode]    = useState('cal');
  const [viewY,   setViewY]   = useState(seed.getFullYear());
  const [viewM,   setViewM]   = useState(seed.getMonth());
  const [selDate, setSelDate] = useState(seed);

  useEffect(() => {
    if (visible) {
      const s = initial ?? today;
      setViewY(s.getFullYear()); setViewM(s.getMonth());
      setSelDate(s); setMode('cal');
    }
  }, [visible]);

  const firstDay  = new Date(viewY, viewM, 1).getDay();
  const daysInMon = new Date(viewY, viewM + 1, 0).getDate();
  const cells     = [...Array(firstDay).fill(null),
                     ...Array.from({ length: daysInMon }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const isSel    = (d) => d && selDate && selDate.getFullYear()===viewY && selDate.getMonth()===viewM && selDate.getDate()===d;
  const isToday  = (d) => d && today.getFullYear()===viewY && today.getMonth()===viewM && today.getDate()===d;
  const isFuture = (d) => !!d && new Date(viewY, viewM, d) > today;

  const prevMonth = () => { if (viewM===0){setViewM(11);setViewY(y=>y-1);}else setViewM(m=>m-1); };
  const nextMonth = () => {
    const nx = new Date(viewY, viewM+1, 1);
    if (nx <= today) { if (viewM===11){setViewM(0);setViewY(y=>y+1);}else setViewM(m=>m+1); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={cp.overlay}>
        <View style={cp.card}>
          {mode === 'cal' && (<>
            <View style={cp.navRow}>
              <TouchableOpacity onPress={prevMonth} style={cp.navBtn}><Feather name="chevron-left"  size={20} color={C.primary} /></TouchableOpacity>
              <View style={cp.navCenter}>
                <TouchableOpacity onPress={() => setMode('month')} style={cp.navLabel}>
                  <Text style={cp.navMonthTxt}>{MONTH_NAMES[viewM]}</Text>
                  <Feather name="chevron-down" size={13} color={C.violet} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMode('year')} style={cp.navLabel}>
                  <Text style={cp.navYearTxt}>{viewY}</Text>
                  <Feather name="chevron-down" size={13} color={C.violet} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={nextMonth} style={cp.navBtn}><Feather name="chevron-right" size={20} color={C.primary} /></TouchableOpacity>
            </View>
            <View style={cp.weekRow}>{DAY_LABELS.map(l => <Text key={l} style={cp.weekLabel}>{l}</Text>)}</View>
            <View style={cp.grid}>
              {cells.map((d, idx) => (
                <TouchableOpacity key={idx} style={[cp.cell, isSel(d)&&cp.cellSel, isToday(d)&&!isSel(d)&&cp.cellToday]}
                  onPress={() => { if (d && !isFuture(d)) setSelDate(new Date(viewY, viewM, d)); }}
                  disabled={!d || isFuture(d)} activeOpacity={0.7}>
                  <Text style={[cp.cellTxt, isSel(d)&&cp.cellTxtSel, isToday(d)&&!isSel(d)&&cp.cellTxtToday, isFuture(d)&&cp.cellTxtFuture, !d&&{opacity:0}]}>
                    {d ?? '·'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={cp.footer}>
              <TouchableOpacity style={cp.btnCancel} onPress={onCancel}><Text style={cp.btnCancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={cp.btnConfirm} onPress={() => onConfirm(selDate)}><Text style={cp.btnConfirmTxt}>Confirm  {fmtDisplay(selDate)}</Text></TouchableOpacity>
            </View>
          </>)}
          {mode === 'month' && (<>
            <Text style={cp.sheetTitle}>Select Month</Text>
            <View style={cp.monthGrid}>
              {MONTH_NAMES.map((name, idx) => (
                <TouchableOpacity key={name} style={[cp.monthCell, idx===viewM&&cp.monthCellActive]} onPress={()=>{setViewM(idx);setMode('cal');}}>
                  <Text style={[cp.monthCellTxt, idx===viewM&&cp.monthCellTxtActive]}>{MONTH_SHORT[idx]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={cp.backBtn} onPress={()=>setMode('cal')}><Text style={cp.backBtnTxt}>← Back</Text></TouchableOpacity>
          </>)}
          {mode === 'year' && (<>
            <Text style={cp.sheetTitle}>Select Year</Text>
            <FlatList data={YEARS} keyExtractor={y=>String(y)} style={{maxHeight:280}}
              initialScrollIndex={Math.max(0,YEARS.indexOf(viewY))}
              getItemLayout={(_,i)=>({length:44,offset:44*i,index:i})}
              renderItem={({item:y})=>(
                <TouchableOpacity style={[cp.yearRow,y===viewY&&cp.yearRowActive]} onPress={()=>{setViewY(y);setMode('cal');}}>
                  <Text style={[cp.yearRowTxt,y===viewY&&cp.yearRowTxtActive]}>{y}</Text>
                  {y===viewY&&<Feather name="check" size={16} color="#fff"/>}
                </TouchableOpacity>
              )}/>
            <TouchableOpacity style={cp.backBtn} onPress={()=>setMode('cal')}><Text style={cp.backBtnTxt}>← Back</Text></TouchableOpacity>
          </>)}
        </View>
      </View>
    </Modal>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root:         { flex: 1, backgroundColor: C.bg },
  loaderWrap:   { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: C.bg },
  loaderText:   { color: C.muted, fontSize: 14 },
  scroll:       { flex: 1 },
  scrollContent:{ paddingHorizontal: 14, paddingTop: 14 },
  tabPane:      { gap: 4 },
});

// Hero header
const hd = StyleSheet.create({
  gradient:  { paddingTop: 12, paddingBottom: 12, alignItems: 'center', paddingHorizontal: 16, flexDirection: 'row', gap: 14 },
  photoRing: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', padding: 2, backgroundColor: 'rgba(255,255,255,0.15)', flexShrink: 0 },
  photo:     { width: '100%', height: '100%', borderRadius: 37, backgroundColor: '#c7d2fe' },
  info:      { flex: 1 },
  name:      { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.2, marginBottom: 4 },
  metaRow:   { flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  metaChip:  { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  metaTxt:   { color: '#dbeafe', fontSize: 10, fontWeight: '600' },
  badge:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99, alignSelf: 'flex-start' },
  badgeDot:  { width: 5, height: 5, borderRadius: 3 },
  badgeTxt:  { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
});

// Tab bar
const tb = StyleSheet.create({
  bar:        { flexDirection: 'row', backgroundColor: C.card, marginHorizontal: 14, marginTop: -12, borderRadius: 16, padding: 4, elevation: 6, shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  tab:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, borderRadius: 12 },
  tabTxt:     { fontSize: 10.5, fontWeight: '700', color: C.muted },
  tabTxtActive:{ color: '#fff' },
});

// Section header
const sh = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 10 },
  iconBox: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  label:   { fontSize: 11.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 },
  line:    { flex: 2, height: 1 },
});

// Info row (view mode)
const ir = StyleSheet.create({
  wrap:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 6, elevation: 1, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  iconBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  body:    { flex: 1 },
  label:   { fontSize: 10.5, color: C.muted, fontWeight: '600', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  value:   { fontSize: 13.5, color: C.text, fontWeight: '700' },
});

// Edit field — mirrors ff.* from StudentRegistrationScreen exactly
const ef = StyleSheet.create({
  wrap:        { marginBottom: 14 },
  label:       { fontSize: 12, fontWeight: '700', color: C.muted, marginBottom: 6, letterSpacing: 0.2 },
  row:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f9fc', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, minHeight: 50, overflow: 'hidden' },
  icon:        { marginLeft: 13, marginRight: 6 },
  input:       { flex: 1, fontSize: 14, color: C.text, paddingVertical: 12, paddingRight: 14 },
  dateBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f9fc', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 0, gap: 10 },
  dateBtnText: { flex: 1, fontSize: 14, color: C.muted },
});

// Bottom action bar
const ab = StyleSheet.create({
  bar:       { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 10, padding: 14, paddingBottom: Platform.OS === 'ios' ? 28 : 14, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, elevation: 16, shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: -3 } },
  editBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14 },
  editTxt:   { color: '#fff', fontWeight: '800', fontSize: 15 },
  cancelBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: C.light, borderWidth: 1, borderColor: C.border },
  cancelTxt: { color: C.muted, fontWeight: '700', fontSize: 14 },
  saveBtn:   { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: C.emerald },
  saveTxt:   { color: '#fff', fontWeight: '800', fontSize: 15 },
});

// Calendar
const cp = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  card:        { backgroundColor: '#fff', borderRadius: 20, width: '100%', maxWidth: 360, padding: 16, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12 },
  navRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  navBtn:      { padding: 8 },
  navCenter:   { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  navLabel:    { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#f1f5f9' },
  navMonthTxt: { fontSize: 15, fontWeight: '700', color: C.primary },
  navYearTxt:  { fontSize: 15, fontWeight: '700', color: C.violet },
  weekRow:     { flexDirection: 'row', marginBottom: 4 },
  weekLabel:   { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.muted },
  grid:        { flexDirection: 'row', flexWrap: 'wrap' },
  cell:        { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellSel:     { backgroundColor: C.primary, borderRadius: 50 },
  cellToday:   { borderWidth: 1.5, borderColor: C.primary, borderRadius: 50 },
  cellTxt:        { fontSize: 13, color: C.text },
  cellTxtSel:     { color: '#fff', fontWeight: '700' },
  cellTxtToday:   { color: C.primary, fontWeight: '700' },
  cellTxtFuture:  { color: '#cbd5e1' },
  footer:      { flexDirection: 'row', gap: 8, marginTop: 14 },
  btnCancel:   { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: C.border },
  btnCancelTxt:{ color: C.muted, fontWeight: '600', fontSize: 13 },
  btnConfirm:  { flex: 2, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary },
  btnConfirmTxt:{ color: '#fff', fontWeight: '700', fontSize: 13 },
  sheetTitle:  { fontSize: 16, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 14 },
  monthGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 12 },
  monthCell:   { width: '28%', paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: C.border },
  monthCellActive:   { backgroundColor: C.primary, borderColor: C.primary },
  monthCellTxt:      { fontSize: 14, fontWeight: '600', color: C.sub },
  monthCellTxtActive:{ color: '#fff' },
  yearRow:       { paddingVertical: 12, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yearRowActive: { backgroundColor: C.primary, borderRadius: 10, marginHorizontal: 4 },
  yearRowTxt:    { fontSize: 16, color: C.sub },
  yearRowTxtActive:{ color: '#fff', fontWeight: '700' },
  backBtn:     { marginTop: 10, alignItems: 'center', paddingVertical: 10 },
  backBtnTxt:  { color: C.violet, fontWeight: '600', fontSize: 14 },
});
