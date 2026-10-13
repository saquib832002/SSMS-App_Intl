/**
 * screens/NoticeBoardScreen.js
 * School Notice Board — circulars, announcements, urgent alerts.
 *
 * Roles:
 *   admin / owner / user  → full CRUD, can pin notices
 *   teacher               → create / edit / delete own notices
 *   student / parent      → read-only (filtered by target_audience)
 */
import React, {
  useContext, useState, useCallback, useEffect, useRef,
} from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Modal, TextInput, Switch,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  StatusBar, Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import {
  fetchNotices, createNotice, updateNotice, deleteNotice,
} from "../services/NoticeServiceApi";

import { fmtDate } from "../services/Locale";
import { noticesSeen, noticeStats, noticeReaders, noticeRemind } from "../services/NotifyApi";
import { _t, _tx } from "../services/i18n";
// ── Constants ─────────────────────────────────────────────────────────────────
const CATEGORIES = ["General", "Academic", "Exam", "Fee", "Event", "Administrative"];
const AUDIENCES  = ["all", "students", "parents", "teachers", "staff"];
const PRIORITIES = ["normal", "important", "urgent"];

const PRIORITY_COLOR = { urgent: "#dc2626", important: "#f59e0b", normal: "#3b82f6" };
const PRIORITY_BG    = { urgent: "#fef2f2", important: "#fffbeb", normal: "#eff6ff" };
const PRIORITY_LABEL = { urgent: "URGENT", important: "IMPORTANT", normal: "Notice" };

const CAT_ICON = {
  General:        "info",
  Academic:       "book-open",
  Exam:           "edit-3",
  Fee:            "dollar-sign",
  Event:          "calendar",
  Administrative: "briefcase",
};

const AUDIENCE_LABEL = {
  all:      "Everyone",
  students: "Students",
  parents:  "Parents",
  teachers: "Teachers",
  staff:    "Staff",
};

const fmt = (d) => {
  if (!d) return "";
  // MySQL returns "2026-08-25 12:34:56" — replace space with T so Date can parse it
  const dt = new Date(String(d).replace(" ", "T"));
  if (isNaN(dt.getTime())) return "";
  return fmtDate(dt, "medium");
};

const isExpiredSoon = (expiresAt) => {
  if (!expiresAt) return null;
  const diff = Math.ceil(
    (new Date(expiresAt + "T00:00:00") - new Date(new Date().toDateString())) / 86400000
  );
  if (diff < 0)  return { label: _t("Expired"),     color: "#94a3b8" };
  if (diff === 0) return { label: _t("Expires today"), color: "#dc2626" };
  if (diff <= 3)  return { label: _t("Expires in {diff}d", { diff }), color: "#f59e0b" };
  return null;
};

// ── NoticeCard ─────────────────────────────────────────────────────────────────
function NoticeCard({ notice, canEdit, onEdit, stats, onReaders }) {
  const [expanded, setExpanded] = useState(false);
  const pc      = PRIORITY_COLOR[notice.priority] ?? "#3b82f6";
  const pbg     = PRIORITY_BG[notice.priority]    ?? "#eff6ff";
  const expInfo = isExpiredSoon(notice.expires_at);
  const bodyStr = String(notice.body ?? "");
  const long    = bodyStr.length > 160;

  return (
    <View style={[nc.card, { borderLeftColor: pc }]}>
      {/* Top row: badges + edit */}
      <View style={nc.topRow}>
        <View style={nc.badges}>
          {notice.is_pinned == 1 && (
            <View style={nc.pinBadge}>
              <Feather name="bookmark" size={9} color="#b45309" />
              <Text style={nc.pinTxt}>{_t("PINNED")}</Text>
            </View>
          )}
          {notice.priority !== "normal" && (
            <View style={[nc.priBadge, { backgroundColor: pbg, borderColor: pc }]}>
              <Text style={[nc.priTxt, { color: pc }]}>
                {_tx(PRIORITY_LABEL[notice.priority])}
              </Text>
            </View>
          )}
          <View style={nc.catBadge}>
            <Feather name={CAT_ICON[notice.category] ?? "tag"} size={9} color="#64748b" />
            <Text style={nc.catTxt}>{_tx(notice.category)}</Text>
          </View>
          <View style={nc.audBadge}>
            <Text style={nc.audTxt}>{_tx(AUDIENCE_LABEL[notice.target_audience]) ?? _tx(notice.target_audience)}</Text>
          </View>
        </View>
        {canEdit && (
          <TouchableOpacity onPress={() => onEdit(notice)} style={nc.editBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="edit-2" size={13} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Title */}
      <Text style={[nc.title, notice.priority === "urgent" && { color: "#dc2626" }]}>
        {_tx(notice.title)}
      </Text>

      {/* Body */}
      <Text style={nc.body} numberOfLines={expanded ? undefined : 3}>
        {_tx(bodyStr)}
      </Text>
      {long && (
        <TouchableOpacity onPress={() => setExpanded(e => !e)}>
          <Text style={nc.readMore}>{expanded ? _t("Show less") : _t("Read more")}</Text>
        </TouchableOpacity>
      )}

      {/* Footer */}
      <View style={nc.footer}>
        <Feather name="user" size={10} color="#94a3b8" />
        <Text style={nc.footerTxt}>{_tx(notice.created_by) || _t("School")}</Text>
        <Text style={nc.dot}>·</Text>
        <Feather name="clock" size={10} color="#94a3b8" />
        <Text style={nc.footerTxt}>{fmt(notice.created_at)}</Text>
        {expInfo && (
          <>
            <Text style={nc.dot}>·</Text>
            <Text style={[nc.expiry, { color: expInfo.color }]}>{_tx(expInfo.label)}</Text>
          </>
        )}
      </View>

      {/* Read receipts (staff) */}
      {!!stats && stats.audience > 0 && (
        <TouchableOpacity style={nc.readRow} onPress={() => onReaders?.(notice)} accessibilityRole="button">
          <Feather name="eye" size={11} color="#2563eb" />
          <Text style={nc.readTxt}>{_t("Read by {read} of {total}", { read: stats.read, total: stats.audience })}</Text>
          <View style={nc.readBar}><View style={[nc.readFill, { width: `${Math.round(100 * stats.read / Math.max(1, stats.audience))}%` }]} /></View>
          <Feather name="chevron-right" size={12} color="#94a3b8" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── CalendarPicker (lightweight, inline) ──────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const todayStr = () => new Date().toISOString().split("T")[0];

function MiniDatePicker({ value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const now   = new Date();
  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth());

  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const firstDay    = (y, m) => new Date(y, m, 1).getDay();

  const cells = [];
  for (let i = 0; i < firstDay(yr, mo); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(yr, mo); d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const pick = (d) => {
    const ymd = `${yr}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    onChange(ymd);
    setOpen(false);
  };

  const fmt2 = (s) => {
    if (!s) return "";
    const [y, m, d] = s.split("-");
    return `${d} ${_tx(MONTHS[parseInt(m, 10) - 1])} ${y}`;
  };

  return (
    <>
      <Text style={md.label}>{_tx(label)}</Text>
      <TouchableOpacity style={md.btn} onPress={() => setOpen(true)}>
        <Feather name="calendar" size={13} color={value ? "#1e40af" : "#94a3b8"} />
        <Text style={[md.btnTxt, !value && { color: "#94a3b8" }]}>
          {value ? fmt2(value) : _t("No expiry (optional)")}
        </Text>
        {value && (
          <TouchableOpacity onPress={() => onChange("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={13} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={md.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={md.sheet}>
            <View style={md.navRow}>
              <TouchableOpacity onPress={() => { if (mo === 0) { setYr(y => y-1); setMo(11); } else setMo(m => m-1); }}>
                <Feather name="chevron-left" size={18} color="#1e40af" />
              </TouchableOpacity>
              <Text style={md.navTxt}>{_tx(MONTHS[mo])} {_tx(yr)}</Text>
              <TouchableOpacity onPress={() => { if (mo === 11) { setYr(y => y+1); setMo(0); } else setMo(m => m+1); }}>
                <Feather name="chevron-right" size={18} color="#1e40af" />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                <Text key={d} style={md.dow}>{_tx(d)}</Text>
              ))}
              {cells.map((d, i) => {
                if (!d) return <View key={`e${i}`} style={md.cell} />;
                const ymd = `${yr}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                const sel = ymd === value;
                return (
                  <TouchableOpacity key={ymd} style={[md.cell, sel && md.cellSel]} onPress={() => pick(d)}>
                    <Text style={[md.cellTxt, sel && md.cellTxtSel]}>{_tx(d)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function NoticeBoardScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const role     = (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase().trim();
  const isAdmin  = ["admin", "owner"].includes(role);
  const canWrite = ["admin", "owner", "teacher"].includes(role);
  const isReadOnly = ["student", "parent"].includes(role);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [notices,    setNotices]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState("");

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [filterPri,  setFilterPri]  = useState("");  // "" | "urgent" | "important"
  const [filterCat,  setFilterCat]  = useState("");  // "" | category

  // ── Read receipts (staff) ───────────────────────────────────────────────────
  const [stats,     setStats]     = useState({});
  const [readers,   setReaders]   = useState(null);   // { notice, data, busy }
  const openReaders = async (n) => {
    setReaders({ notice: n, data: null });
    try { const d = await noticeReaders(user, n.notice_id); setReaders({ notice: n, data: d }); }
    catch (e) { setReaders(null); Alert.alert(_t("Read by"), _tx(e.message)); }
  };
  const remind = async () => {
    if (!readers?.data) return;
    setReaders((r) => ({ ...r, busy: true }));
    try {
      const r = await noticeRemind(user, readers.notice.notice_id);
      Alert.alert(_t("Reminder sent"), _t("{n} people who have not read it got a reminder.", { n: r.reminded ?? 0 }));
    } catch (e) { Alert.alert(_t("Remind the rest"), _tx(e.message)); }
    finally { setReaders((r) => (r ? { ...r, busy: false } : r)); }
  };

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [modal,     setModal]     = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [fTitle,    setFTitle]    = useState("");
  const [fBody,     setFBody]     = useState("");
  const [fCat,      setFCat]      = useState("General");
  const [fPri,      setFPri]      = useState("normal");
  const [fAud,      setFAud]      = useState("all");
  const [fPinned,   setFPinned]   = useState(false);
  const [fExpires,  setFExpires]  = useState("");

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async (isRefresh = false) => {
    if (!user?.token) { setLoading(false); setRefreshing(false); return; }
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError("");
      const data = await fetchNotices(user, {
        limit:    50,
        category: filterCat || undefined,
        priority: filterPri || undefined,
      });
      const list = Array.isArray(data) ? data : [];
      setNotices(list);
      const ids = list.map((n) => n.notice_id).filter(Boolean);
      noticesSeen(user, ids);   // opening the board counts as reading the notices on it
      if (!isReadOnly && ids.length) noticeStats(user, ids).then(setStats).catch(() => {});
    } catch (e) {
      setError(e.message || _t("Failed to load notices"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, filterCat, filterPri, isReadOnly]);

  useEffect(() => { load(); }, [load]);

  // ── Modal helpers ────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setFTitle(""); setFBody(""); setFCat("General");
    setFPri("normal"); setFAud("all"); setFPinned(false); setFExpires("");
    setModal(true);
  };

  const openEdit = (n) => {
    setEditing(n);
    setFTitle(n.title ?? "");
    setFBody(n.body ?? "");
    setFCat(n.category ?? "General");
    setFPri(n.priority ?? "normal");
    setFAud(n.target_audience ?? "all");
    setFPinned(n.is_pinned == 1);
    setFExpires(n.expires_at ?? "");
    setModal(true);
  };

  const canEditThisNotice = (n) => {
    if (!canWrite) return false;
    // Teachers can only edit their own notices (matches backend rule)
    if (role === "teacher") return n.created_by === (user?.ssmsUserName ?? "");
    // admin / owner / user can edit any notice
    return true;
  };

  const handleSave = async () => {
    if (!fTitle.trim()) { Alert.alert(_t("Required"), _t("Title is required.")); return; }
    if (!fBody.trim())  { Alert.alert(_t("Required"), _t("Notice body is required.")); return; }
    const payload = {
      title:           fTitle.trim(),
      body:            fBody.trim(),
      category:        fCat,
      priority:        fPri,
      target_audience: fAud,
      is_pinned:       fPinned ? 1 : 0,
      expires_at:      fExpires || null,
    };
    try {
      setSaving(true);
      if (editing) await updateNotice(user, editing.notice_id, payload);
      else         await createNotice(user, payload);
      setModal(false);
      load();
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message) || _t("Failed to save notice."));
    } finally { setSaving(false); }
  };

  const handleDelete = () => {
    Alert.alert(_t("Delete Notice"), _t("Delete \"{title}\"?", { title: editing?.title }), [
      { text: _t("Cancel"), style: "cancel" },
      {
        text: _t("Delete"), style: "destructive",
        onPress: async () => {
          try {
            setSaving(true);
            await deleteNotice(user, editing.notice_id);
            setModal(false);
            load();
          } catch (e) {
            Alert.alert(_t("Error"), _tx(e.message) || _t("Failed to delete."));
          } finally { setSaving(false); }
        },
      },
    ]);
  };

  // ── Filtered notices (client-side for category/priority) ────────────────────
  const visible = notices.filter(n => {
    if (filterPri && n.priority !== filterPri) return false;
    if (filterCat && n.category !== filterCat) return false;
    return true;
  });

  const pinned  = visible.filter(n => n.is_pinned == 1);
  const regular = visible.filter(n => n.is_pinned != 1);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* ── Header ── */}
      <View style={s.header}>
        {navigation?.canGoBack?.() && (
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={20} color="#1e40af" />
          </TouchableOpacity>
        )}
        <View style={s.headerCenter}>
          <Feather name="bell" size={16} color="#1e40af" />
          <Text style={s.headerTitle}>{_t("Notice Board")}</Text>
        </View>
        {canWrite && (
          <TouchableOpacity style={s.addBtn} onPress={openAdd}>
            <Feather name="plus" size={14} color="#fff" />
            <Text style={s.addBtnTxt}>{_t("Post")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Priority filter chips ── */}
      <View style={s.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
          {[
            { key: "",          label: _t("All"),       dot: "#94a3b8" },
            { key: "urgent",    label: _t("🔴 Urgent"),    dot: "#dc2626" },
            { key: "important", label: _t("🟡 Important"), dot: "#f59e0b" },
          ].map(f => (
            <TouchableOpacity
              key={f.key}
              style={[s.chip, filterPri === f.key && s.chipActive]}
              onPress={() => setFilterPri(p => p === f.key ? "" : f.key)}
            >
              <Text style={[s.chipTxt, filterPri === f.key && s.chipTxtActive]}>{_tx(f.label)}</Text>
            </TouchableOpacity>
          ))}
          <View style={s.chipDivider} />
          {["General", "Academic", "Exam", "Fee", "Event", "Administrative"].map(c => (
            <TouchableOpacity
              key={c}
              style={[s.chip, filterCat === c && s.chipActive]}
              onPress={() => setFilterCat(p => p === c ? "" : c)}
            >
              <Feather name={CAT_ICON[c] ?? "tag"} size={10}
                color={filterCat === c ? "#fff" : "#64748b"} />
              <Text style={[s.chipTxt, filterCat === c && s.chipTxtActive]}>{_tx(c)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── List ── */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)}
            colors={["#1e40af"]} tintColor="#1e40af" />
        }
      >
        {loading ? (
          <View style={s.center}><ActivityIndicator color="#1e40af" size="large" /></View>
        ) : error ? (
          <View style={s.center}>
            <Feather name="alert-circle" size={32} color="#ef4444" />
            <Text style={[s.emptyTxt, { color: "#ef4444" }]}>{_tx(error)}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => load()}>
              <Text style={s.retryTxt}>{_t("Retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : visible.length === 0 ? (
          <View style={s.center}>
            <Feather name="bell-off" size={40} color="#cbd5e1" />
            <Text style={s.emptyTxt}>{_t("No notices yet")}</Text>
            {canWrite && (
              <TouchableOpacity style={s.retryBtn} onPress={openAdd}>
                <Text style={s.retryTxt}>{_t("Post a notice")}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {/* Pinned section */}
            {pinned.length > 0 && (
              <>
                <View style={s.sectionHeader}>
                  <Feather name="bookmark" size={12} color="#b45309" />
                  <Text style={s.sectionHeaderTxt}>{_t("Pinned")}</Text>
                </View>
                {pinned.map(n => (
                  <NoticeCard key={n.notice_id} notice={n} stats={stats?.[n.notice_id]} onReaders={openReaders}
                    canEdit={canEditThisNotice(n)} onEdit={openEdit} />
                ))}
              </>
            )}

            {/* Regular section */}
            {regular.length > 0 && (
              <>
                {pinned.length > 0 && (
                  <View style={s.sectionHeader}>
                    <Feather name="list" size={12} color="#64748b" />
                    <Text style={[s.sectionHeaderTxt, { color: "#64748b" }]}>{_t("All Notices")}</Text>
                  </View>
                )}
                {regular.map(n => (
                  <NoticeCard key={n.notice_id} notice={n} stats={stats?.[n.notice_id]} onReaders={openReaders}
                    canEdit={canEditThisNotice(n)} onEdit={openEdit} />
                ))}
              </>
            )}
          </>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* ── Create / Edit Modal ── */}
      <Modal
        visible={modal}
        transparent
        animationType="slide"
        onRequestClose={() => !saving && setModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={m.overlay}>
            <View style={m.sheet}>

              <View style={m.head}>
                <Text style={m.headTitle}>{editing ? _t("Edit Notice") : _t("New Notice")}</Text>
                <TouchableOpacity style={m.closeBtn} onPress={() => setModal(false)} disabled={saving}>
                  <Feather name="x" size={15} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                {/* Title */}
                <Text style={m.label}>{_t("Title")}{" "}<Text style={{ color: "#ef4444" }}>*</Text></Text>
                <TextInput
                  style={m.input}
                  value={fTitle}
                  onChangeText={setFTitle}
                  placeholder={_t("Notice title…")}
                  placeholderTextColor="#94a3b8"
                  editable={!saving}
                />

                {/* Body */}
                <Text style={m.label}>{_t("Notice Body")}{" "}<Text style={{ color: "#ef4444" }}>*</Text></Text>
                <TextInput
                  style={[m.input, m.textarea]}
                  value={fBody}
                  onChangeText={setFBody}
                  multiline
                  placeholder={_t("Write the full notice here…")}
                  placeholderTextColor="#94a3b8"
                  editable={!saving}
                />

                {/* Priority */}
                <Text style={m.label}>{_t("Priority")}</Text>
                <View style={m.toggleRow}>
                  {PRIORITIES.map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        m.toggleBtn,
                        fPri === p && { backgroundColor: PRIORITY_BG[p], borderColor: PRIORITY_COLOR[p] },
                      ]}
                      onPress={() => setFPri(p)}
                    >
                      <Text style={[
                        m.toggleTxt,
                        fPri === p && { color: PRIORITY_COLOR[p], fontWeight: "800" },
                      ]}>
                        {p === "normal" ? _t("Normal") : p === "important" ? _t("Important") : _t("Urgent")}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Category */}
                <Text style={m.label}>{_t("Category")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {CATEGORIES.map(c => (
                      <TouchableOpacity
                        key={c}
                        style={[m.chip, fCat === c && m.chipActive]}
                        onPress={() => setFCat(c)}
                      >
                        <Feather name={CAT_ICON[c] ?? "tag"} size={10}
                          color={fCat === c ? "#fff" : "#64748b"} />
                        <Text style={[m.chipTxt, fCat === c && m.chipTxtActive]}>{_tx(c)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                {/* Audience */}
                <Text style={m.label}>{_t("Visible To")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {AUDIENCES.map(a => (
                      <TouchableOpacity
                        key={a}
                        style={[m.chip, fAud === a && m.chipActive]}
                        onPress={() => setFAud(a)}
                      >
                        <Text style={[m.chipTxt, fAud === a && m.chipTxtActive]}>
                          {_tx(AUDIENCE_LABEL[a])}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                {/* Expiry date */}
                <MiniDatePicker
                  label={_t("Expiry Date (optional)")}
                  value={fExpires}
                  onChange={setFExpires}
                />

                {/* Pin toggle — admin/owner only */}
                {isAdmin && (
                  <View style={m.switchRow}>
                    <View>
                      <Text style={m.label}>{_t("📌 Pin this notice")}</Text>
                      <Text style={{ fontSize: 11, color: "#94a3b8", marginTop: -10 }}>{_t("Pinned notices appear at the top")}</Text>
                    </View>
                    <Switch
                      value={fPinned}
                      onValueChange={setFPinned}
                      trackColor={{ false: "#e2e8f0", true: "#fde68a" }}
                      thumbColor={fPinned ? "#b45309" : "#94a3b8"}
                      disabled={saving}
                    />
                  </View>
                )}

              </ScrollView>

              {/* Footer */}
              <View style={m.foot}>
                {editing && (
                  <TouchableOpacity style={m.delBtn} onPress={handleDelete} disabled={saving}>
                    <Feather name="trash-2" size={14} color="#dc2626" />
                    <Text style={m.delTxt}>{_t("Delete")}</Text>
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={m.cancelBtn} onPress={() => setModal(false)} disabled={saving}>
                  <Text style={m.cancelTxt}>{_t("Cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[m.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Feather name="check" size={14} color="#fff" /><Text style={m.saveTxt}>{_t("Post")}</Text></>
                  }
                </TouchableOpacity>
              </View>

            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Who has read a notice ── */}
      <Modal visible={!!readers} transparent animationType="fade" onRequestClose={() => setReaders(null)}>
        <TouchableOpacity style={rd.overlay} activeOpacity={1} onPress={() => setReaders(null)}>
          <TouchableOpacity activeOpacity={1} style={rd.sheet}>
            <Text style={rd.title} numberOfLines={2}>{_tx(readers?.notice?.title)}</Text>
            {!readers?.data ? <ActivityIndicator color="#2563eb" style={{ marginVertical: 24 }} /> : (
              <>
                <Text style={rd.sub}>{_t("Read by {read} of {total}", { read: readers.data.read.length, total: readers.data.read.length + readers.data.unread.length })}</Text>
                <ScrollView style={{ maxHeight: 340 }}>
                  {readers.data.unread.length > 0 && <Text style={rd.group}>{_t("Not read yet")} ({readers.data.unread.length})</Text>}
                  {readers.data.unread.map((u) => (
                    <View key={"u" + u.username} style={rd.line}><Feather name="circle" size={11} color="#94a3b8" /><Text style={rd.name}>{_tx(u.name)}</Text><Text style={rd.role}>{_tx(u.role)}</Text></View>
                  ))}
                  {readers.data.read.length > 0 && <Text style={rd.group}>{_t("Already read")} ({readers.data.read.length})</Text>}
                  {readers.data.read.map((u) => (
                    <View key={"r" + u.username} style={rd.line}><Feather name="check-circle" size={11} color="#15803d" /><Text style={rd.name}>{_tx(u.name)}</Text><Text style={rd.role}>{fmt(u.read_at)}</Text></View>
                  ))}
                </ScrollView>
                <View style={rd.btns}>
                  <TouchableOpacity style={rd.close} onPress={() => setReaders(null)}><Text style={rd.closeTxt}>{_t("Close")}</Text></TouchableOpacity>
                  {readers.data.unread.length > 0 && (
                    <TouchableOpacity style={[rd.remind, readers.busy && { opacity: 0.6 }]} disabled={!!readers.busy} onPress={remind}>
                      {readers.busy ? <ActivityIndicator color="#fff" size="small" /> : <><Feather name="send" size={13} color="#fff" /><Text style={rd.remindTxt}>{_t("Remind the rest")}</Text></>}
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const rd = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", paddingHorizontal: 18 },
  sheet:     { backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  title:     { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  sub:       { fontSize: 12, color: "#64748b", marginTop: 2, marginBottom: 8 },
  group:     { fontSize: 11, fontWeight: "800", color: "#64748b", textTransform: "uppercase", marginTop: 10, marginBottom: 4 },
  line:      { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  name:      { flex: 1, fontSize: 13, color: "#0f172a" },
  role:      { fontSize: 11, color: "#94a3b8" },
  btns:      { flexDirection: "row", gap: 10, marginTop: 14 },
  close:     { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center" },
  closeTxt:  { fontWeight: "700", color: "#475569" },
  remind:    { flex: 1.4, flexDirection: "row", gap: 6, paddingVertical: 11, borderRadius: 10, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center" },
  remindTxt: { fontWeight: "800", color: "#fff" },
});

// ── Notice Card styles ────────────────────────────────────────────────────────
const nc = StyleSheet.create({
  readRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  readTxt:   { fontSize: 11, fontWeight: "700", color: "#2563eb" },
  readBar:   { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#e2e8f0", overflow: "hidden" },
  readFill:  { height: 4, backgroundColor: "#2563eb" },
  card:     { backgroundColor: "#fff", borderRadius: 14, marginHorizontal: 14, marginBottom: 10, borderLeftWidth: 4, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, shadowColor: "#0f172a", shadowOpacity: 0.03, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  topRow:   { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 },
  badges:   { flexDirection: "row", flexWrap: "wrap", gap: 4, flex: 1 },
  editBtn:  { width: 26, height: 26, borderRadius: 6, backgroundColor: "#f8fafc", alignItems: "center", justifyContent: "center" },

  pinBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#fef9c3", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 },
  pinTxt:   { fontSize: 9, fontWeight: "800", color: "#b45309" },

  priBadge: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1 },
  priTxt:   { fontSize: 9, fontWeight: "800" },

  catBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#f1f5f9", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 },
  catTxt:   { fontSize: 9, fontWeight: "600", color: "#64748b" },

  audBadge: { backgroundColor: "#eff6ff", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 },
  audTxt:   { fontSize: 9, fontWeight: "600", color: "#1e40af" },

  title:    { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 4, lineHeight: 19 },
  body:     { fontSize: 13, color: "#374151", lineHeight: 19, marginBottom: 4 },
  readMore: { fontSize: 11, fontWeight: "700", color: "#2563eb", marginBottom: 6 },

  footer:    { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  footerTxt: { fontSize: 10, color: "#94a3b8" },
  dot:       { fontSize: 10, color: "#cbd5e1" },
  expiry:    { fontSize: 10, fontWeight: "700" },
});

// ── Mini date picker styles ───────────────────────────────────────────────────
const W = 40;
const md = StyleSheet.create({
  label:   { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6 },
  btn:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 14 },
  btnTxt:  { flex: 1, fontSize: 13, color: "#0f172a", fontWeight: "500" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  sheet:   { backgroundColor: "#fff", borderRadius: 18, padding: 16, width: "100%" },
  navRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  navTxt:  { fontSize: 15, fontWeight: "800", color: "#0b1f4b" },
  dow:     { width: W, textAlign: "center", fontSize: 10, fontWeight: "700", color: "#94a3b8", marginBottom: 4 },
  cell:    { width: W, height: W, alignItems: "center", justifyContent: "center" },
  cellSel: { backgroundColor: "#1e40af", borderRadius: W / 2 },
  cellTxt: { fontSize: 13, color: "#0f172a", fontWeight: "500" },
  cellTxtSel: { color: "#fff", fontWeight: "800" },
});

// ── Screen styles ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#f8fafc" },

  header:       { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  backBtn:      { width: 34, height: 34, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center", marginRight: 8 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  headerTitle:  { fontSize: 17, fontWeight: "800", color: "#0b1f4b" },
  addBtn:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#1e40af", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9 },
  addBtnTxt:    { fontSize: 12, fontWeight: "700", color: "#fff" },

  filterRow:    { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  filterScroll: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  chip:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  chipActive:   { backgroundColor: "#1e40af", borderColor: "#1e40af" },
  chipTxt:      { fontSize: 11, fontWeight: "600", color: "#475569" },
  chipTxtActive:{ color: "#fff", fontWeight: "700" },
  chipDivider:  { width: 1, height: 22, backgroundColor: "#e2e8f0", marginHorizontal: 2, alignSelf: "center" },

  scroll:       { flex: 1 },
  scrollContent:{ paddingTop: 12 },

  sectionHeader:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, marginBottom: 6, marginTop: 4 },
  sectionHeaderTxt: { fontSize: 11, fontWeight: "800", color: "#b45309", textTransform: "uppercase", letterSpacing: 0.5 },

  center:   { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10 },
  emptyTxt: { fontSize: 14, color: "#94a3b8", fontWeight: "600", textAlign: "center" },
  retryBtn: { marginTop: 4, paddingHorizontal: 20, paddingVertical: 9, borderRadius: 10, backgroundColor: "#eff6ff" },
  retryTxt: { fontSize: 13, fontWeight: "700", color: "#1e40af" },
});

// ── Modal styles ──────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "95%", paddingBottom: Platform.OS === "ios" ? 34 : 20 },
  head:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  headTitle:{ fontSize: 16, fontWeight: "800", color: "#0f172a" },
  closeBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },

  label:    { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input:    { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: "#0f172a", marginBottom: 14 },
  textarea: { height: 100, textAlignVertical: "top" },

  toggleRow:    { flexDirection: "row", gap: 8, marginBottom: 14 },
  toggleBtn:    { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: "#e2e8f0", alignItems: "center", backgroundColor: "#f8fafc" },
  toggleTxt:    { fontSize: 12, fontWeight: "600", color: "#64748b" },

  chip:         { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  chipActive:   { backgroundColor: "#1e40af", borderColor: "#1e40af" },
  chipTxt:      { fontSize: 11, fontWeight: "600", color: "#64748b" },
  chipTxtActive:{ color: "#fff", fontWeight: "700" },

  switchRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 },

  foot:       { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  delBtn:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" },
  delTxt:     { color: "#dc2626", fontWeight: "700", fontSize: 12 },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9, backgroundColor: "#f1f5f9" },
  cancelTxt:  { color: "#475569", fontWeight: "700", fontSize: 13 },
  saveBtn:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 9, backgroundColor: "#1e40af" },
  saveTxt:    { color: "#fff", fontWeight: "700", fontSize: 13 },
});
