/**
 * screens/Exams/ExamDatesheetScreen.js
 *
 * Admin: Create & publish exam date sheets.
 * Flow: Pick Branch → Pick Session → Pick Exam → Pick Class → Set date+time → Save → Publish
 */
import React, {
  useState, useEffect, useCallback, useContext,
} from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Modal,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialIcons, Feather } from "@expo/vector-icons";
import * as Print      from "expo-print";
import * as Sharing    from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { AuthContext } from "../../context/AuthContext";
import { fetchExams, fetchSchoolInfo } from "../../services/ExamServiceApi";
import { fetchClasses, fetchBranches, fetchSessions } from "../../services/SetupServiceApi";
import { BASE_URL, HOST_NAME } from "../../Environment/EnvironmentConfig";
import {
  fetchDatesheet, saveDatesheet, togglePublish, fetchAllDatesheets,
} from "../../services/DatesheetServiceApi";

// ── tiny helpers ──────────────────────────────────────────────────────────────

const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// 24h "HH:MM" → { display: "H:MM", period: "AM"|"PM" }
function from24H(t24) {
  if (!t24) return { display: "", period: "AM" };
  const [hStr, mStr] = t24.split(":");
  let h = parseInt(hStr, 10);
  if (isNaN(h)) return { display: "", period: "AM" };
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return { display: `${h}:${(mStr ?? "00").padStart(2,"0")}`, period };
}

// { display: "H:MM", period } → 24h "HH:MM"
function to24H(display, period) {
  if (!display) return null;
  const parts = display.split(":");
  let h = parseInt(parts[0] ?? "0", 10);
  const m = (parts[1] ?? "00").padStart(2, "0");
  if (isNaN(h)) return null;
  if (period === "AM") { if (h === 12) h = 0; }
  else                 { if (h !== 12) h = (h + 12) % 24; }
  return `${String(h).padStart(2,"0")}:${m}`;
}

function fmtDate(ymd) {
  if (!ymd) return null;
  const d = new Date(ymd + "T00:00:00");
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── CalendarPicker (inline, self-contained) ───────────────────────────────────

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}
function firstDayOfMonth(y, m) {
  return new Date(y, m, 1).getDay();
}
function toYMD(y, m, d) {
  return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function CalendarPicker({ visible, onClose, value, onChange, minDate }) {
  const parsed = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear,  setViewYear]  = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth());

  useEffect(() => {
    if (visible) {
      const d = value ? new Date(value + "T00:00:00") : new Date();
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [visible]);

  const minParsed = minDate ? new Date(minDate + "T00:00:00") : null;
  const isDisabled = (y, m, d) => {
    if (!minParsed) return false;
    const cell = new Date(y, m, d);
    return cell < minParsed;
  };

  const selectDay = (d) => {
    onChange(toYMD(viewYear, viewMonth, d));
    onClose();
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const totalDays = daysInMonth(viewYear, viewMonth);
  const startDay  = firstDayOfMonth(viewYear, viewMonth);
  const cells     = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedDay = value
    ? (() => { const p = new Date(value+"T00:00:00"); return p.getFullYear()===viewYear && p.getMonth()===viewMonth ? p.getDate() : null; })()
    : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={cal.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={cal.sheet}>
          {/* Nav */}
          <View style={cal.nav}>
            <TouchableOpacity onPress={prevMonth} style={cal.navBtn}>
              <Feather name="chevron-left" size={18} color="#1e40af" />
            </TouchableOpacity>
            <Text style={cal.navTxt}>
              {MONTHS[viewMonth]} {viewYear}
            </Text>
            <TouchableOpacity onPress={nextMonth} style={cal.navBtn}>
              <Feather name="chevron-right" size={18} color="#1e40af" />
            </TouchableOpacity>
          </View>
          {/* Day headers */}
          <View style={cal.row}>
            {DAYS.map(d => (
              <Text key={d} style={cal.dayHead}>{d}</Text>
            ))}
          </View>
          {/* Date grid */}
          {Array.from({ length: cells.length / 7 }).map((_, wi) => (
            <View key={wi} style={cal.row}>
              {cells.slice(wi * 7, wi * 7 + 7).map((day, ci) => {
                if (!day) return <View key={ci} style={cal.cell} />;
                const disabled = isDisabled(viewYear, viewMonth, day);
                const selected = day === selectedDay;
                return (
                  <TouchableOpacity
                    key={ci} style={[cal.cell, selected && cal.cellSel, disabled && cal.cellDis]}
                    onPress={() => !disabled && selectDay(day)}
                    activeOpacity={0.75}
                  >
                    <Text style={[cal.cellTxt, selected && cal.cellTxtSel, disabled && cal.cellTxtDis]}>
                      {day}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          <TouchableOpacity style={cal.clearBtn} onPress={() => { onChange(null); onClose(); }}>
            <Text style={cal.clearTxt}>Clear date</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Dropdown picker ───────────────────────────────────────────────────────────
// options: [{ key, label }]   value: currently selected key

function DropdownPicker({ icon, label, value, displayValue, options, onSelect, placeholder }) {
  const [open, setOpen] = useState(false);
  const canOpen = options.length > 1;

  return (
    <>
      <TouchableOpacity
        style={dp.row}
        onPress={() => canOpen && setOpen(true)}
        activeOpacity={canOpen ? 0.7 : 1}
      >
        <View style={dp.left}>
          <Feather name={icon} size={14} color="#64748b" />
          <Text style={dp.rowLabel}>{label}</Text>
        </View>
        <View style={dp.right}>
          <Text style={[dp.rowValue, !displayValue && dp.rowPlaceholder]} numberOfLines={1}>
            {displayValue || placeholder}
          </Text>
          {canOpen && <Feather name="chevron-down" size={15} color="#94a3b8" style={{ marginLeft: 4 }} />}
        </View>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={dp.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={dp.sheet}>
            <Text style={dp.sheetTitle}>{placeholder}</Text>
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {options.map(opt => {
                const active = opt.key === value;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[dp.option, active && dp.optionActive]}
                    onPress={() => { onSelect(opt); setOpen(false); }}
                  >
                    <Text style={[dp.optionTxt, active && dp.optionActiveTxt]}>{opt.label}</Text>
                    {active && <Feather name="check" size={14} color="#1e40af" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── AM/PM time sub-component ──────────────────────────────────────────────────

function TimeField({ value24h, onChange24h, placeholder }) {
  const parsed = from24H(value24h);
  const [display, setDisplay] = useState(parsed.display);
  const [period,  setPeriod]  = useState(parsed.period);

  // Sync when parent resets the slot (e.g. different exam/class loaded)
  useEffect(() => {
    const p = from24H(value24h);
    setDisplay(p.display);
    setPeriod(p.period);
  }, [value24h]);

  const commit = (d, p) => {
    const t24 = to24H(d, p);
    onChange24h(t24);
  };

  const togglePeriod = () => {
    const newP = period === "AM" ? "PM" : "AM";
    setPeriod(newP);
    commit(display, newP);
  };

  return (
    <View style={ss.timeField}>
      <TextInput
        style={ss.timeInput}
        value={display}
        onChangeText={setDisplay}
        onBlur={() => commit(display, period)}
        placeholder={placeholder}
        placeholderTextColor="#cbd5e1"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
      />
      <TouchableOpacity style={ss.ampmBtn} onPress={togglePeriod}>
        <Text style={ss.ampmTxt}>{period}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Subject slot card ─────────────────────────────────────────────────────────

function SubjectSlot({ item, onChange }) {
  const [calOpen, setCalOpen] = useState(false);

  const hasDate = !!item.exam_date;

  return (
    <View style={ss.card}>
      {/* Subject name row */}
      <View style={ss.nameRow}>
        <View style={ss.subjectDot} />
        <Text style={ss.subjectName}>{item.subject_name}</Text>
        {hasDate && <Feather name="check-circle" size={14} color="#16a34a" style={{ marginLeft: 4 }} />}
      </View>

      {/* Date row */}
      <TouchableOpacity style={ss.field} onPress={() => setCalOpen(true)} activeOpacity={0.8}>
        <Feather name="calendar" size={14} color={hasDate ? "#1e40af" : "#94a3b8"} />
        <Text style={[ss.fieldTxt, !hasDate && ss.fieldPlaceholder]}>
          {hasDate ? fmtDate(item.exam_date) : "Tap to set date"}
        </Text>
        <Feather name="chevron-down" size={13} color="#94a3b8" />
      </TouchableOpacity>

      {/* Time row — 12h with AM/PM toggles */}
      <View style={ss.timeRow}>
        <Feather name="clock" size={13} color="#64748b" style={{ marginRight: 6 }} />
        <Text style={ss.timeLabel}>From</Text>
        <TimeField
          value24h={item.start_time}
          onChange24h={v => onChange({ ...item, start_time: v })}
          placeholder="9:00"
        />
        <Text style={ss.timeSep}>–</Text>
        <Text style={ss.timeLabel}>To</Text>
        <TimeField
          value24h={item.end_time}
          onChange24h={v => onChange({ ...item, end_time: v })}
          placeholder="12:00"
        />
      </View>

      {/* Venue (optional) */}
      <TextInput
        style={ss.venueInput}
        value={item.venue ?? ""}
        onChangeText={v => onChange({ ...item, venue: v })}
        placeholder="Venue / Hall (optional)"
        placeholderTextColor="#cbd5e1"
      />

      <CalendarPicker
        visible={calOpen}
        onClose={() => setCalOpen(false)}
        value={item.exam_date}
        onChange={d => onChange({ ...item, exam_date: d })}
        minDate={today()}
      />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ExamDatesheetScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [exams,          setExams]          = useState([]);
  const [classes,        setClasses]        = useState([]);
  const [branches,       setBranches]       = useState([]);
  const [sessions,       setSessions]       = useState([]);
  const [selectedExam,   setSelectedExam]   = useState(null);
  const [selectedClass,  setSelectedClass]  = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);  // null = All
  const [selectedSession,setSelectedSession]= useState(null);  // null = All
  const [entries,        setEntries]        = useState([]);
  const [isPublished,    setIsPublished]    = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [publishing,     setPublishing]     = useState(false);
  const [printing,       setPrinting]       = useState(false);
  const [schoolInfo,     setSchoolInfo]     = useState(null);

  const branchId  = selectedBranch?.branch_id  ?? 0;  // 0 = All Branches (intentional wildcard)
  const sessionId = selectedSession?.session_id ?? 0;  // 0 only before data loads; always set once loaded

  // ── Load exams + classes + branches + sessions once ──────────────────────
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const [ex, cl, br, se] = await Promise.all([
          fetchExams(user),
          fetchClasses(user),
          fetchBranches(user).then(d => (Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [])).catch(() => []),
          fetchSessions(user).then(d => (Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [])).catch(() => []),
        ]);
        const examList  = Array.isArray(ex) ? ex : (Array.isArray(ex?.data) ? ex.data : []);
        const classList = Array.isArray(cl) ? cl : (Array.isArray(cl?.data) ? cl.data : []);
        setExams(examList);
        setClasses(classList);
        setBranches(br);
        // Show all active sessions; active stored as 'Yes'/'No', is_current as 'Y'/'N'
        const activeSessions = se.filter(s => s.active === 'Yes');
        setSessions(activeSessions);
        if (!selectedExam  && examList.length)  setSelectedExam(examList[0]);
        if (!selectedClass && classList.length) setSelectedClass(classList[0]);
        // Auto-select the current session (is_current === 'Y') if not already chosen
        if (!selectedSession && activeSessions.length) {
          const current = activeSessions.find(s => s.is_current === 'Y') ?? activeSessions[0];
          setSelectedSession(current);
        }
      } catch (e) {
        Alert.alert("Error", e.message || "Failed to load data.");
      }
    })();
  }, [user]));

  // ── Load school info + logo (base64 for expo-print) ─────────────────────
  useEffect(() => {
    if (!user) return;
    fetchSchoolInfo(user).then(async info => {
      if (!info) return;
      const base    = (HOST_NAME ?? "").replace(/\/+$/, "");
      const logoUrl = info.logo_name
        ? `${base}/clients/${user?.ssmsClientCode}/${info.logo_name}`
        : null;
      let logo = null;
      if (logoUrl) {
        try {
          const ext  = (info.logo_name.split(".").pop() || "jpg").toLowerCase();
          const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
          const tmp  = FileSystem.cacheDirectory + "school_logo_ds." + ext;
          await FileSystem.downloadAsync(logoUrl, tmp);
          const b64 = await FileSystem.readAsStringAsync(tmp, { encoding: FileSystem.EncodingType.Base64 });
          logo = `data:${mime};base64,${b64}`;
        } catch (_) {}
      }
      setSchoolInfo({
        name:    info.ssms_client_name    ?? "",
        address: info.ssms_client_address ?? "",
        phone:   info.ssms_client_phone   ?? "",
        logo,
      });
    }).catch(() => {});
  }, [user]);

  // ── Load datesheet whenever exam / class / branch / session changes ──────
  useEffect(() => {
    if (!selectedExam || !selectedClass) return;
    (async () => {
      try {
        setLoading(true);
        setEntries([]);
        const result = await fetchDatesheet(
          user, selectedExam.exam_id, selectedClass.class_id, branchId, sessionId
        );
        setEntries(result.entries ?? []);
        setIsPublished(result.is_published ?? false);
      } catch (e) {
        Alert.alert("Error", e.message || "Failed to load date sheet.");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedExam, selectedClass, selectedBranch, selectedSession]);

  // ── Update a single entry ────────────────────────────────────────────────
  const updateEntry = useCallback((updated) => {
    setEntries(prev => prev.map(e =>
      e.subject_id === updated.subject_id ? updated : e
    ));
  }, []);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const filled = entries.filter(e => e.exam_date);
    if (!filled.length) {
      Alert.alert("Nothing to save", "Please set at least one exam date.");
      return;
    }
    if (!selectedSession) {
      Alert.alert("No Session", "Please wait for session data to load or select a session.");
      return;
    }
    try {
      setSaving(true);
      await saveDatesheet(user, {
        exam_id:    selectedExam.exam_id,
        class_id:   selectedClass.class_id,
        branch_id:  branchId,
        session_id: sessionId,
        entries:    filled,
      });
      Alert.alert("Saved", "Date sheet saved successfully.");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  // ── Publish toggle ────────────────────────────────────────────────────────
  const handlePublish = async () => {
    const action = isPublished ? "Unpublish" : "Publish";
    Alert.alert(
      `${action} Date Sheet`,
      isPublished
        ? "Students will no longer see this date sheet."
        : "Students and parents will be able to view this date sheet.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: action,
          style: isPublished ? "destructive" : "default",
          onPress: async () => {
            try {
              setPublishing(true);
              const res = await togglePublish(user, selectedExam.exam_id, selectedClass.class_id, branchId, sessionId);
              setIsPublished(res.is_published ?? !isPublished);
              Alert.alert("Done", res.message ?? `Date sheet ${action.toLowerCase()}ed.`);
            } catch (e) {
              Alert.alert("Error", e.message || "Failed.");
            } finally {
              setPublishing(false);
            }
          },
        },
      ]
    );
  };

  // ── Print / PDF (landscape matrix: classes × dates) ──────────────────────
  const handlePrint = async () => {
    if (!selectedExam) {
      Alert.alert("Select Exam", "Please select an exam first.");
      return;
    }
    try {
      setPrinting(true);
      const data = await fetchAllDatesheets(user, selectedExam.exam_id, branchId, sessionId);
      if (!data.classes || data.classes.length === 0) {
        Alert.alert("Nothing to print", "No published date sheets found for this exam.");
        return;
      }

      // ── helpers ──
      const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const DAYS_SHORT   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const fmtDateShort = (ymd) => {
        if (!ymd) return "";
        const d = new Date(ymd + "T00:00:00");
        return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
      };
      const fmtTime12 = (t24) => {
        if (!t24) return "";
        const [hStr, mStr] = t24.split(":");
        let h = parseInt(hStr, 10);
        if (isNaN(h)) return "";
        const ap = h >= 12 ? "PM" : "AM";
        if (h === 0) h = 12; else if (h > 12) h -= 12;
        return `${h}:${(mStr ?? "00").padStart(2,"0")} ${ap}`;
      };

      // ── build matrix data ──
      // Collect all unique dates (sorted)
      const allDates = [...new Set(
        data.classes.flatMap(c => c.entries.map(e => e.exam_date))
      )].filter(Boolean).sort();

      // For each date, collect distinct time-slots across all classes (sorted) → sittings
      // dateSittings[date] = ["09:00", "14:00", ...]
      const dateSittings = {};
      for (const date of allDates) {
        const times = [...new Set(
          data.classes.flatMap(c =>
            c.entries.filter(e => e.exam_date === date).map(e => e.start_time ?? "__none__")
          )
        )].sort();
        dateSittings[date] = times; // could be ["__none__"] if no times set
      }

      // classMap[class_name][date][timeSlot] = "Subject (time)"
      const classMap = {};
      for (const cls of data.classes) {
        classMap[cls.class_name] = {};
        for (const e of cls.entries) {
          if (!e.exam_date) continue;
          if (!classMap[cls.class_name][e.exam_date])
            classMap[cls.class_name][e.exam_date] = {};
          const key = e.start_time ?? "__none__";
          const timeLabel = e.start_time ? `<br/><span class="st">${fmtTime12(e.start_time)}</span>` : "";
          const draft = e.is_published === 0 || e.is_published === "0";
          classMap[cls.class_name][e.exam_date][key] =
            `<span class="${draft ? "draft" : ""}">${e.subject_name}${timeLabel}</span>`;
        }
      }

      const classNames = data.classes.map(c => c.class_name);

      // ── header row 1: "Date ->" | Date1 (colspan=sittings) | Date2 ... ──
      const hRow1 = allDates.map(date => {
        const span = dateSittings[date].length;
        return `<th colspan="${span}" class="date-head">${fmtDateShort(date)}</th>`;
      }).join("");

      // ── header row 2: "CLASS" | Sitting-1 | Sitting-2 | ... per date ──
      const hRow2 = allDates.flatMap(date =>
        dateSittings[date].map((t, i) => {
          const label = t === "__none__"
            ? (dateSittings[date].length === 1 ? "Sitting" : `Sitting ${i + 1}`)
            : (dateSittings[date].length === 1 ? fmtTime12(t) : `Sitting ${i + 1}<br/><span class="sit-time">${fmtTime12(t)}</span>`);
          return `<th class="sit-head">${label}</th>`;
        })
      ).join("");

      // ── data rows: one per class ──
      const dataRows = classNames.map((cls, ri) => {
        const cells = allDates.flatMap(date =>
          dateSittings[date].map(t => {
            const subj = classMap[cls]?.[date]?.[t] ?? "";
            return `<td class="subj-cell">${subj}</td>`;
          })
        ).join("");
        const rowClass = ri % 2 === 0 ? "" : ' class="alt"';
        return `<tr${rowClass}><td class="class-cell">${cls}</td>${cells}</tr>`;
      }).join("");

      const branchLabel  = selectedBranch?.branch_name  ?? "All Branches";
      const sessionLabel = selectedSession?.session_name ?? "All Sessions";
      const generatedOn  = new Date().toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });

      const logoHtml = schoolInfo?.logo
        ? `<img src="${schoolInfo.logo}" style="width:60px;height:60px;object-fit:contain;"/>`
        : `<div style="width:60px;height:60px;"></div>`;
      const schoolName    = (schoolInfo?.name    ?? "").toUpperCase();
      const schoolAddress = schoolInfo?.address  ?? "";
      const schoolPhone   = schoolInfo?.phone    ?? "";

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  @page { size: A4 landscape; margin: 8mm 12mm; }
  html, body { height: 100%; margin: 0; }
  body  { font-family: Arial, sans-serif; font-size: 10px; color: #111;
          display: flex; flex-direction: column; min-height: 100%; }

  /* ── Header layout: logo left | school info center | spacer right ── */
  .doc-header  { display: flex; align-items: center; border-bottom: 2px solid #222;
                 padding-bottom: 6px; margin-bottom: 4px; }
  .logo-col    { width: 64px; flex-shrink: 0; }
  .center-col  { flex: 1; text-align: center; }
  .school-name { font-size: 16px; font-weight: bold; color: #000; letter-spacing: 1px; }
  .school-addr { font-size: 8.5px; color: #444; margin-top: 2px; }
  .school-meta { font-size: 8px; color: #666; margin-top: 1px; }

  /* ── Exam badge pill ── */
  .badge-row   { text-align: center; margin: 5px 0 8px; }
  .exam-badge  { display: inline-block; background: #000; color: #fff;
                 padding: 4px 22px; border-radius: 50px;
                 font-size: 11px; font-weight: bold; letter-spacing: 1.5px; }

  table        { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td       { border: 1px solid #bfdbfe; padding: 4px 5px; vertical-align: middle; }

  /* first column (arrow / CLASS label) */
  .arrow-cell  { width: 70px; font-size: 9px; color: #888; font-style: italic; }
  .class-label { width: 70px; background: #1e3a8a; color: #fff; font-weight: bold; font-size: 10px; }
  .class-cell  { background: #eff6ff; font-weight: bold; font-size: 10px; width: 70px; }

  /* date header */
  .date-head   { background: #1e40af; color: #fff; text-align: center;
                 font-size: 9px; font-weight: bold; }
  /* sitting sub-header */
  .sit-head    { background: #dbeafe; color: #1e3a8a; text-align: center;
                 font-size: 8px; font-weight: bold; }
  .sit-time    { font-weight: normal; font-size: 7.5px; }

  .subj-cell   { text-align: center; font-size: 9px; }
  .st          { font-size: 7.5px; color: #555; }
  .draft       { color: #94a3b8; font-style: italic; }
  tr.alt td    { background: #f8fafc; }
  tr.alt .class-cell { background: #e0e7ff; }

  .bottom    { margin-top: auto; padding-top: 16px; }
  .sig-row   { display: flex; justify-content: space-between; padding: 0 40px; }
  .sig-block { text-align: center; width: 200px; }
  .sig-line  { border-top: 1.5px solid #000; margin-bottom: 5px; }
  .sig-title { font-size: 10px; font-weight: bold; color: #111; letter-spacing: 0.5px; }
  .footer    { margin-top: 8px; font-size: 8px; color: #94a3b8; text-align: right; }
</style>
</head><body>
  <div class="doc-header">
    <div class="logo-col">${logoHtml}</div>
    <div class="center-col">
      ${schoolName ? `<div class="school-name">${schoolName}</div>` : ""}
      ${schoolAddress ? `<div class="school-addr">${schoolAddress}${schoolPhone ? " &nbsp;&bull;&nbsp; " + schoolPhone : ""}</div>` : ""}
      <div class="school-meta">Branch: ${branchLabel} &nbsp;&bull;&nbsp; Session: ${sessionLabel} &nbsp;&bull;&nbsp; ${generatedOn}</div>
    </div>
    <div class="logo-col"></div>
  </div>
  <div class="badge-row">
    <span class="exam-badge">${data.exam_name.toUpperCase()} &mdash; EXAM DATE SHEET</span>
  </div>
  <table>
    <thead>
      <tr>
        <th class="arrow-cell">Date &rarr;</th>
        ${hRow1}
      </tr>
      <tr>
        <th class="class-label">CLASS</th>
        ${hRow2}
      </tr>
    </thead>
    <tbody>
      ${dataRows}
    </tbody>
  </table>
  <div class="bottom">
    <div class="sig-row">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Examination Controller</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-title">Principal</div>
      </div>
    </div>
    <div class="footer">Generated by SSMS</div>
  </div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `${data.exam_name} Date Sheet` });
      } else {
        Alert.alert("PDF saved", uri);
      }
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to generate PDF.");
    } finally {
      setPrinting(false);
    }
  };

  const datesSet    = entries.filter(e => e.exam_date).length;
  const totalSubj   = entries.length;
  const allSet      = datesSet === totalSubj && totalSubj > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#f8fafc" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* ── Header ── */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Exam Date Sheet</Text>
        <TouchableOpacity
          style={[st.printBtn, printing && { opacity: 0.5 }]}
          onPress={handlePrint}
          disabled={printing}
        >
          {printing
            ? <ActivityIndicator size="small" color="#1e40af" />
            : <Feather name="printer" size={20} color="#1e40af" />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={st.saveBtnTxt}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Filter card — Exam / Class / Branch / Session ── */}
        <View style={st.filterCard}>
          <DropdownPicker
            icon="file-text"
            label="Exam"
            value={selectedExam?.exam_id}
            displayValue={selectedExam?.exam_name}
            placeholder="Select Exam"
            options={exams.map(e => ({ key: e.exam_id, label: e.exam_name, data: e }))}
            onSelect={opt => setSelectedExam(opt.data)}
          />
          <View style={st.filterDivider} />
          <DropdownPicker
            icon="layers"
            label="Grade / Class"
            value={selectedClass?.class_id}
            displayValue={selectedClass?.class_name}
            placeholder="Select Class"
            options={classes.map(c => ({ key: c.class_id, label: c.class_name, data: c }))}
            onSelect={opt => setSelectedClass(opt.data)}
          />
          {branches.length > 0 && (
            <>
              <View style={st.filterDivider} />
              <DropdownPicker
                icon="git-branch"
                label="Branch"
                value={selectedBranch?.branch_id ?? 0}
                displayValue={selectedBranch?.branch_name ?? "All Branches"}
                placeholder="Select Branch"
                options={[
                  { key: 0, label: "All Branches", data: null },
                  ...branches.map(b => ({ key: b.branch_id, label: b.branch_name, data: b })),
                ]}
                onSelect={opt => setSelectedBranch(opt.data)}
              />
            </>
          )}
          {sessions.length >= 1 && (
            <>
              <View style={st.filterDivider} />
              <DropdownPicker
                icon="calendar"
                label="Session"
                value={selectedSession?.session_id}
                displayValue={selectedSession?.session_name}
                placeholder="Select Session"
                options={sessions.map(s => ({ key: s.session_id, label: s.session_name, data: s }))}
                onSelect={opt => setSelectedSession(opt.data)}
              />
            </>
          )}
        </View>

        {/* ── Status bar ── */}
        {selectedExam && selectedClass && (
          <View style={st.statusBar}>
            <View style={[st.statusDot, { backgroundColor: isPublished ? "#16a34a" : "#f59e0b" }]} />
            <Text style={st.statusTxt}>
              {isPublished ? "Published — visible to students" : "Draft — not visible to students"}
            </Text>
            <Text style={st.statusCount}>
              {datesSet}/{totalSubj} set
            </Text>
          </View>
        )}

        {/* ── Subject slots ── */}
        <View style={{ padding: 12 }}>
          {loading ? (
            <ActivityIndicator size="large" color="#1e40af" style={{ marginTop: 40 }} />
          ) : entries.length === 0 ? (
            <View style={st.emptyBox}>
              <Feather name="alert-circle" size={32} color="#94a3b8" />
              <Text style={st.emptyTxt}>
                {selectedExam && selectedClass
                  ? "No subjects assigned to this class.\nGo to Setup → Class Subjects to add subjects."
                  : "Select an exam and class to start."}
              </Text>
            </View>
          ) : (
            entries.map(item => (
              <SubjectSlot key={item.subject_id} item={item} onChange={updateEntry} />
            ))
          )}
        </View>

        {/* ── Publish / Unpublish button ── */}
        {entries.length > 0 && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 32 }}>
            <TouchableOpacity
              style={[
                st.publishBtn,
                isPublished ? st.publishBtnActive : (allSet ? st.publishBtnReady : st.publishBtnDraft),
                publishing && { opacity: 0.6 },
              ]}
              onPress={handlePublish}
              disabled={publishing}
            >
              {publishing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather
                    name={isPublished ? "eye-off" : "send"}
                    size={16}
                    color="#fff"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={st.publishBtnTxt}>
                    {isPublished ? "Unpublish Date Sheet" : "Publish to Students"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            {!allSet && !isPublished && (
              <Text style={st.publishHint}>
                Save all {totalSubj} subject dates before publishing.
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 14, paddingTop: 52, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  backBtn:       { padding: 4, marginRight: 8 },
  headerTitle:   { flex: 1, fontSize: 17, fontWeight: "800", color: "#0f172a" },
  printBtn:      { padding: 6, marginRight: 8 },
  saveBtn:       { backgroundColor: "#1e40af", paddingHorizontal: 16, paddingVertical: 7, borderRadius: 10 },
  saveBtnTxt:    { color: "#fff", fontWeight: "700", fontSize: 14 },

  sectionLabel:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 },
  sectionLabelTxt:{ fontSize: 11, fontWeight: "700", color: "#64748b", letterSpacing: 0.8 },

  chipScroll:    { paddingHorizontal: 12, paddingBottom: 4 },
  chip:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#f1f5f9", marginRight: 8, borderWidth: 1, borderColor: "#e2e8f0" },
  chipActive:    { backgroundColor: "#1e40af", borderColor: "#1e40af" },
  chipTxt:       { fontSize: 13, fontWeight: "600", color: "#475569" },
  chipTxtActive: { color: "#fff" },

  filterCard:    { margin: 12, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden", shadowColor: "#0f172a", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  filterDivider: { height: 1, backgroundColor: "#f1f5f9", marginHorizontal: 14 },

  statusBar:     { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", marginHorizontal: 12, marginTop: 4, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: "#e2e8f0", gap: 8 },
  statusDot:     { width: 8, height: 8, borderRadius: 4 },
  statusTxt:     { flex: 1, fontSize: 12, color: "#475569", fontWeight: "600" },
  statusCount:   { fontSize: 12, color: "#1e40af", fontWeight: "700" },

  emptyBox:      { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyTxt:      { fontSize: 13, color: "#94a3b8", textAlign: "center", lineHeight: 20 },

  publishBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 14 },
  publishBtnReady:  { backgroundColor: "#16a34a" },
  publishBtnDraft:  { backgroundColor: "#94a3b8" },
  publishBtnActive: { backgroundColor: "#dc2626" },
  publishBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
  publishHint:   { textAlign: "center", fontSize: 11, color: "#94a3b8", marginTop: 8 },
});

const ss = StyleSheet.create({
  card:           { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#e2e8f0", borderLeftWidth: 3, borderLeftColor: "#1e40af" },
  nameRow:        { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  subjectDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: "#1e40af", marginRight: 8 },
  subjectName:    { flex: 1, fontSize: 14, fontWeight: "800", color: "#0f172a" },

  field:          { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  fieldTxt:       { flex: 1, fontSize: 13, color: "#0f172a", fontWeight: "600" },
  fieldPlaceholder:{ color: "#94a3b8", fontWeight: "400" },

  timeRow:        { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  timeLabel:      { fontSize: 12, color: "#64748b", marginRight: 5 },
  timeField:      { flex: 1, flexDirection: "row", alignItems: "center" },
  timeInput:      { flex: 1, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7, fontSize: 13, color: "#0f172a", textAlign: "center", fontWeight: "600" },
  ampmBtn:        { backgroundColor: "#e0e7ff", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 6, marginLeft: 4 },
  ampmTxt:        { fontSize: 11, fontWeight: "800", color: "#1e40af" },
  timeSep:        { fontSize: 16, color: "#94a3b8", marginHorizontal: 6 },
  venueInput:     { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, color: "#0f172a" },
});

// Dropdown styles
const dp = StyleSheet.create({
  row:            { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 13 },
  left:           { flexDirection: "row", alignItems: "center", gap: 8 },
  rowLabel:       { fontSize: 13, fontWeight: "600", color: "#475569" },
  right:          { flexDirection: "row", alignItems: "center", flex: 1, justifyContent: "flex-end" },
  rowValue:       { fontSize: 13, fontWeight: "700", color: "#0f172a", textAlign: "right", flexShrink: 1 },
  rowPlaceholder: { color: "#94a3b8", fontWeight: "400" },

  overlay:        { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 28 },
  sheet:          { backgroundColor: "#fff", borderRadius: 18, width: "100%", paddingTop: 18, paddingBottom: 10, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  sheetTitle:     { fontSize: 14, fontWeight: "800", color: "#0f172a", paddingHorizontal: 18, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  option:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 13 },
  optionActive:   { backgroundColor: "#eff6ff" },
  optionTxt:      { fontSize: 14, color: "#334155" },
  optionActiveTxt:{ color: "#1e40af", fontWeight: "700" },
});

// Calendar styles
const cal = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  sheet:      { backgroundColor: "#fff", borderRadius: 18, padding: 16, width: "100%" },
  nav:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  navBtn:     { padding: 6 },
  navTxt:     { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  row:        { flexDirection: "row" },
  dayHead:    { flex: 1, textAlign: "center", fontSize: 11, color: "#64748b", fontWeight: "600", paddingBottom: 6 },
  cell:       { flex: 1, alignItems: "center", paddingVertical: 8 },
  cellSel:    { backgroundColor: "#1e40af", borderRadius: 20 },
  cellDis:    { opacity: 0.3 },
  cellTxt:    { fontSize: 13, color: "#0f172a" },
  cellTxtSel: { color: "#fff", fontWeight: "700" },
  cellTxtDis: { color: "#94a3b8" },
  clearBtn:   { alignItems: "center", marginTop: 10, paddingVertical: 8 },
  clearTxt:   { fontSize: 13, color: "#dc2626", fontWeight: "600" },
});
