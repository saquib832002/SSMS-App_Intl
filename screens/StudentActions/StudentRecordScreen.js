/**
 * Student record – guardians, emergency contacts, medical & allergies, documents and
 * the school's own extra fields.
 *
 * Opened from a student's profile (staff) with { registrationId }, or from the parent /
 * student portal (no params: the person picks one of their children).
 * What each person can see and change comes from the server (record.can).
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal,
  RefreshControl, Linking, Platform, KeyboardAvoidingView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { AuthContext } from "../../context/AuthContext";
import { C, Card, Btn, Field, Toggle, Empty, Picker } from "../../components/ReportCardUI";
import DateTimeField from "../../components/DateTimeField";
import {
  getStudentRecord, saveGuardian, removeGuardian, saveContact, removeContact, saveMedical,
  uploadDocument, updateDocument, deleteDocument, openDocument, saveFieldValues, getMyChildren, ALERT_STYLE,
} from "../../services/StudentRecordApi";

import { fmtDate } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";
const TABS = [
  { key: "family", get label() { return _t("Family"); }, icon: "users" },
  { key: "health", get label() { return _t("Health"); }, icon: "heart" },
  { key: "docs", get label() { return _t("Documents"); }, icon: "folder" },
  { key: "more", get label() { return _t("More"); }, icon: "list" },
];

const yes = (v) => v === true || v === 1 || v === "1";
const call = (phone) => {
  const n = String(phone || "").replace(/[^\d+]/g, "");
  if (n) Linking.openURL(`tel:${n}`).catch(() => Alert.alert(_t("Call"), _t("Calling isn't available on this device.")));
};
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A date that may be empty: the picker only appears once a date is wanted (iOS always shows a date). */
function OptionalDate({ label, value, onChange, addText = "Add a date" }) {
  if (!value) {
    return (
      <>
        <Text style={s.fieldLabel}>{_tx(label)}</Text>
        <TouchableOpacity style={s.addDate} onPress={() => onChange(todayYmd())}>
          <Feather name="calendar" size={14} color={C.brand} /><Text style={s.link}> {_tx(addText)}</Text>
        </TouchableOpacity>
      </>
    );
  }
  return (
    <>
      <DateTimeField label={_tx(label)} value={value} onChange={onChange} />
      <TouchableOpacity onPress={() => onChange("")}><Text style={[s.link, { marginBottom: 8 }]}>{_t("Remove date")}</Text></TouchableOpacity>
    </>
  );
}
/**
 * Phones save photos as JPEG, HEIC/HEIF, WebP or even AVIF depending on the make and
 * settings. Turn every picked photo into a normal JPEG (max 2400 px wide) so the school
 * can always open it, and big camera photos fit the upload limit.
 */
async function photoAsJpeg(asset, fallbackName) {
  const actions = asset.width && asset.width > 2400 ? [{ resize: { width: 2400 } }] : [];
  const out = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  let size;
  try { size = (await FileSystem.getInfoAsync(out.uri)).size; } catch { size = undefined; }
  const base = String(asset.fileName || asset.name || fallbackName || `photo-${Date.now()}`).replace(/\.[A-Za-z0-9]+$/, "");
  return { uri: out.uri, name: `${base}.jpg`, type: "image/jpeg", size };
}
const isImage = (a) => /^image\//i.test(a?.mimeType || "") || /\.(jpe?g|png|heic|heif|webp|avif|gif|bmp)$/i.test(a?.name || a?.fileName || "");

const sizeLabel = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const niceDate = (d) => {
  if (!d) return "";
  return fmtDate(String(d).slice(0, 10), "medium") || String(d);
};

export default function StudentRecordScreen({ route, navigation }) {
  const { user, activeEnrollmentId, setActiveEnrollmentId, linkedStudents } = useContext(AuthContext);
  const [picking, setPicking] = useState(false);
  const params = route?.params ?? {};
  const role = (user?.ssmsUserRole ?? "").toLowerCase();
  const portal = role === "parent" || role === "student";
  const fromParams = !!(params.registrationId || params.enrollmentId);
  // portal: the child picked in the portal (header / "Select student"), like every other portal screen
  const portalChild = portal
    ? (activeEnrollmentId || (role === "student" ? (user?.enrollmentId || user?.ssmsUserName) : null)) || null
    : null;

  const [who, setWho] = useState(fromParams
    ? { registrationId: params.registrationId, enrollmentId: params.enrollmentId }
    : portalChild ? { enrollmentId: String(portalChild) } : null);
  const [children, setChildren] = useState(null);
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(params.tab || "family");
  // "More" tab answers live here so switching tabs or refreshing doesn't lose unsaved typing
  const [fieldVals, setFieldVals] = useState({});
  const fieldsDirty = useRef(false);
  useEffect(() => {
    if (fieldsDirty.current) return;
    const list = Array.isArray(rec?.fields) ? rec.fields : [];
    setFieldVals(Object.fromEntries(list.map((f) => [f.id, f.value ?? ""])));
  }, [rec?.fields]);

  // portal: follow the selected child when it changes
  useEffect(() => {
    if (fromParams || !portal || !portalChild) return;
    if (who?.enrollmentId === String(portalChild) && !who?.registrationId) return;
    fieldsDirty.current = false;
    setRec(null);
    setErr(null);
    setWho({ enrollmentId: String(portalChild) });
  }, [fromParams, portal, portalChild]);   // eslint-disable-line react-hooks/exhaustive-deps

  // portal without a selected child: pick one here
  useEffect(() => {
    if (who || !portal) return;
    let off = false;
    getMyChildren(user)
      .then((list) => {
        if (off) return;
        setChildren(list);
        if (list.length === 1) setWho({ enrollmentId: list[0].enrollment_id });
      })
      .catch((e) => { if (!off) { setChildren([]); setErr(e.message); } });
    return () => { off = true; };
  }, [who, portal, user]);

  const load = useCallback(async () => {
    if (!who) return;
    setLoading(true);
    try {
      const r = await getStudentRecord(user, who);
      if (!r || typeof r !== "object" || !r.student) throw new Error(_t("The student record could not be read. Please try again."));
      setRec(r);
      setErr(null);
      if (r?.student?.name) navigation.setOptions?.({ title: r.student.name });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, who, navigation]);
  useEffect(() => { load(); }, [load]);

  // after a save: use the registration id from now on (stable across years)
  const target = useMemo(() => (rec?.student?.registration_id ? { registrationId: rec.student.registration_id } : who), [rec, who]);

  if (!who) {
    if (!portal) return <Empty icon="user-x" text={_t("No student selected.")} />;
    if (!children) return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16 }}>
        {err ? <Card><Empty icon="alert-circle" text={_tx(err)} /></Card> : !children.length ? (
          <Card><Empty icon="users" text={_t("No children are linked to your account yet.")} /></Card>
        ) : (
          <Card title={_t("Choose a child")}>
            {children.map((c) => (
              <TouchableOpacity key={c.enrollment_id} style={s.row} onPress={() => setWho({ enrollmentId: c.enrollment_id })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{_tx(c.student_name)}</Text>
                  <Text style={s.meta}>{_tx(c.class_name)}</Text>
                </View>
                <Feather name="chevron-right" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ))}
          </Card>
        )}
      </ScrollView>
    );
  }

  if (!rec) {
    if (err) {
      return (
        <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>
          <Card><Empty icon="alert-circle" text={_tx(err)} /></Card>
          <Btn title={_t("Try again")} kind="ghost" icon="refresh-cw" onPress={load} />
        </View>
      );
    }
    return <ActivityIndicator style={{ marginTop: 40 }} color={C.brand} />;
  }

  const can = rec.can || {};
  const alerts = Array.isArray(rec.alerts) ? rec.alerts : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={s.head}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{_tx(rec.student?.name)}</Text>
            <Text style={s.meta}>{[rec.student?.class_name, rec.student?.roll_number ? `Roll ${rec.student.roll_number}` : null].filter(Boolean).join(" · ")}</Text>
          </View>
          {role === "parent" && ((Array.isArray(linkedStudents) && linkedStudents.length > 1) || (children && children.length > 1)) && (
            <TouchableOpacity style={s.switchBtn} onPress={() => {
              if (Array.isArray(linkedStudents) && linkedStudents.length > 1 && setActiveEnrollmentId) { setPicking(true); return; }
              fieldsDirty.current = false; setRec(null); setWho(null);
            }}>
              <Feather name="repeat" size={14} color={C.brand} /><Text style={s.link}>{" "}{_t("Switch")}</Text>
            </TouchableOpacity>
          )}
        </View>
        {alerts.map((a, i) => (
          <View key={i} style={[s.alert, { backgroundColor: (ALERT_STYLE[a.level] ?? ALERT_STYLE.info).bg }]}>
            <Feather name={a.kind === "pickup" ? "slash" : "alert-triangle"} size={14} color={(ALERT_STYLE[a.level] ?? ALERT_STYLE.info).fg} />
            <Text style={[s.alertTxt, { color: (ALERT_STYLE[a.level] ?? ALERT_STYLE.info).fg }]}>{_tx(a.text)}</Text>
          </View>
        ))}
        <View style={s.tabs}>
          {TABS.map((t) => (
            <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => setTab(t.key)}>
              <Feather name={t.icon} size={14} color={tab === t.key ? C.brand : C.muted} />
              <Text style={[s.tabTxt, tab === t.key && { color: C.brand }]}>{_tx(t.label)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {tab === "family" && <Family rec={rec} setRec={setRec} user={user} target={target} reload={load} />}
        {tab === "health" && <Health rec={rec} setRec={setRec} user={user} target={target} />}
        {tab === "docs" && <Documents rec={rec} setRec={setRec} user={user} target={target} reload={load} />}
        {tab === "more" && <More rec={rec} setRec={setRec} user={user} target={target} vals={fieldVals}
          setVals={(v) => { fieldsDirty.current = true; setFieldVals(v); }} onSaved={() => { fieldsDirty.current = false; }} />}
      </ScrollView>
      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <TouchableOpacity style={s.pickOverlay} activeOpacity={1} onPress={() => setPicking(false)}>
          <View style={s.pickSheet}>
            <Text style={s.sheetTitle}>{_t("Choose a child")}</Text>
            {(Array.isArray(linkedStudents) ? linkedStudents : []).map((c) => (
              <TouchableOpacity key={c.enrollment_id} style={s.row} onPress={() => { setPicking(false); setActiveEnrollmentId(c.enrollment_id); }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{_tx(c.student_name)}</Text>
                  <Text style={s.meta}>{[c.class_name, c.section_name].filter(Boolean).join(" ")}</Text>
                </View>
                {String(c.enrollment_id) === String(activeEnrollmentId) && <Feather name="check" size={18} color={C.brand} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Sheet: full-screen modal with safe-area padding ─────────────────────────
function Sheet({ visible, title, onClose, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sheetHead, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
          <Text style={s.sheetTitle}>{_tx(title)}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={22} color={C.muted} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Badge({ text, bg = "#f1f5f9", fg = "#475569" }) {
  return <View style={[s.badge, { backgroundColor: bg }]}><Text style={[s.badgeTxt, { color: fg }]}>{_tx(text)}</Text></View>;
}

// ── Family: guardians + emergency contacts ──────────────────────────────────
function Family({ rec, setRec, user, target, reload }) {
  const can = rec.can || {};
  const staff = rec.level === "staff";
  const relations = Object.entries(rec.options?.relations ?? {}).map(([value, label]) => ({ value, label }));
  const guardians = Array.isArray(rec.guardians) ? rec.guardians : [];
  const contacts = Array.isArray(rec.contacts) ? rec.contacts : [];
  const suggested = Array.isArray(rec.suggested_guardians) ? rec.suggested_guardians : [];
  const [g, setG] = useState(null);
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);

  const saveG = async () => {
    setBusy(true);
    try {
      const r = await saveGuardian(user, target, g);
      setRec({ ...rec, guardians: r.guardians ?? [], suggested_guardians: [] });
      setG(null);
    } catch (e) { Alert.alert(_t("Guardian"), _tx(e.message)); } finally { setBusy(false); }
  };
  const addSuggested = async () => {
    setBusy(true);
    try {
      let list = guardians;
      for (const sg of suggested) {
        const r = await saveGuardian(user, target, sg);
        list = r.guardians ?? list;
      }
      setRec({ ...rec, guardians: list, suggested_guardians: [] });
    } catch (e) {
      Alert.alert(_t("Guardians"), _tx(e.message));
      reload?.();   // some may have been added – show what's really saved
    } finally { setBusy(false); }
  };
  const delG = (row) => Alert.alert(_t("Remove guardian"), _t("Remove {name} from this student's record?{v}", { name: row.name, v: row.app_access ? ("\n" + _t("They will lose app access to this child.") + "") : "" }), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Remove"), style: "destructive", onPress: async () => {
      try { const r = await removeGuardian(user, target, row.id); setRec({ ...rec, guardians: r.guardians ?? [] }); setG(null); }
      catch (e) { Alert.alert(_t("Guardian"), _tx(e.message)); }
    } },
  ]);
  const saveC = async () => {
    setBusy(true);
    try { const r = await saveContact(user, target, c); setRec({ ...rec, contacts: r.contacts ?? [] }); setC(null); }
    catch (e) { Alert.alert(_t("Emergency contact"), _tx(e.message)); } finally { setBusy(false); }
  };
  const delC = (row) => Alert.alert(_t("Remove contact"), _t("Remove {name}?", { name: row.name }), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Remove"), style: "destructive", onPress: async () => {
      try { const r = await removeContact(user, target, row.id); setRec({ ...rec, contacts: r.contacts ?? [] }); setC(null); }
      catch (e) { Alert.alert(_t("Emergency contact"), _tx(e.message)); }
    } },
  ]);

  return (
    <>
      <Card title={_t("Guardians")} right={can.edit_guardians ? <TouchableOpacity onPress={() => setG({ relation: "guardian", can_pickup: true, lives_with: true, gets_notices: true })}><Text style={s.link}>{_t("+ Add")}</Text></TouchableOpacity> : null}>
        {!!suggested.length && (
          <View style={s.suggest}>
            <Text style={s.meta}>{_t("From the admission form: {v}", { v: suggested.map((x) => x.name).join(", ") })}</Text>
            <Btn title={_t("Add them as guardians")} kind="ghost" icon="user-plus" busy={busy} onPress={addSuggested} />
          </View>
        )}
        {!guardians.length && !suggested.length && <Text style={s.meta}>{_t("No guardians recorded yet.")}</Text>}
        {guardians.map((x) => (
          <TouchableOpacity key={x.id} style={s.row} disabled={!can.edit_guardians} onPress={() => setG({ ...x })}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{_tx(x.name)} <Text style={s.meta}>· {_tx(x.relation_label)}</Text></Text>
              {!!x.phone && <Text style={s.meta}>{_tx(x.phone)}{x.email ? ` · ${_tx(x.email)}` : ""}</Text>}
              <View style={s.badges}>
                {x.is_primary && <Badge text={_t("Main contact")} bg="#ede9fe" fg={C.brand} />}
                {x.app_access && <Badge text={_t("App sign-in")} bg="#dcfce7" fg="#166534" />}
                {!x.can_pickup && <Badge text={_t("Not allowed to collect")} bg="#fee2e2" fg="#991b1b" />}
                {x.lives_with === false && <Badge text={_t("Lives elsewhere")} />}
              </View>
              {staff && !!x.restriction_note && <Text style={[s.meta, { color: C.err }]}>{_tx(x.restriction_note)}</Text>}
            </View>
            {!!x.phone && (
              <TouchableOpacity onPress={() => call(x.phone)} style={s.callBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="phone" size={16} color={C.brand} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))}
      </Card>

      <Card title={_t("Emergency contacts")} right={can.edit_contacts ? <TouchableOpacity onPress={() => setC({ priority: contacts.length + 1 })}><Text style={s.link}>{_t("+ Add")}</Text></TouchableOpacity> : null}>
        {!contacts.length && <Text style={s.meta}>{_t("No emergency contacts yet.{v}", { v: can.edit_contacts ? (" " + _t("Add someone the school can call if a guardian can't be reached.") + "") : "" })}</Text>}
        {contacts.map((x, i) => (
          <TouchableOpacity key={x.id} style={s.row} disabled={!can.edit_contacts} onPress={() => setC({ ...x })}>
            <Text style={s.prio}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{_tx(x.name)}{x.relation ? <Text style={s.meta}> · {_tx(x.relation)}</Text> : null}</Text>
              <Text style={s.meta}>{_tx(x.phone)}{x.alt_phone ? ` · ${_tx(x.alt_phone)}` : ""}</Text>
              {!!x.notes && <Text style={s.meta}>{_tx(x.notes)}</Text>}
            </View>
            <TouchableOpacity onPress={() => call(x.phone)} style={s.callBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="phone" size={16} color={C.brand} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
      </Card>

      <Sheet visible={!!g} title={g?.id ? _t("Edit guardian") : _t("Add guardian")} onClose={() => setG(null)}>
        <Field label={_t("Name")} value={g?.name ?? ""} onChangeText={(v) => setG({ ...g, name: v })} />
        <Picker label={_t("Relation")} value={g?.relation} options={relations} onChange={(v) => setG({ ...g, relation: v })} />
        <Field label={_t("Mobile number")} keyboardType="phone-pad" value={g?.phone ?? ""} onChangeText={(v) => setG({ ...g, phone: v })} placeholder="+44 7700 900123" />
        <Field label={_t("E-mail")} keyboardType="email-address" autoCapitalize="none" value={g?.email ?? ""} onChangeText={(v) => setG({ ...g, email: v })} />
        <Field label={_t("Occupation")} value={g?.occupation ?? ""} onChangeText={(v) => setG({ ...g, occupation: v })} />
        <Field label={_t("Address (if different)")} value={g?.address ?? ""} onChangeText={(v) => setG({ ...g, address: v })} multiline />
        <Toggle label={_t("Main contact")} value={yes(g?.is_primary)} onChange={(v) => setG({ ...g, is_primary: v })} />
        <Toggle label={_t("Student lives with them")} value={g?.lives_with !== false} onChange={(v) => setG({ ...g, lives_with: v })} />
        <Toggle label={_t("Gets school messages")} value={g?.gets_notices !== false} onChange={(v) => setG({ ...g, gets_notices: v })} />
        <Toggle label={_t("Allowed to collect the student")} value={g?.can_pickup !== false} onChange={(v) => setG({ ...g, can_pickup: v })}
          hint={_t("Switch off if a court order or the family says this person must not collect the child. Staff see a warning; parents don't see this person.")} />
        {(g?.can_pickup === false || !!g?.restriction_note) && (
          <Field label={_t("Restriction note (staff only)")} value={g?.restriction_note ?? ""} onChangeText={(v) => setG({ ...g, restriction_note: v })} multiline
            placeholder={_t("e.g. Court order dated … – call the main contact")} />
        )}
        <Toggle label={_t("Can use the parent app for this child")} value={yes(g?.app_access)} onChange={(v) => {
          if (!can.app_access) { Alert.alert(_t("App sign-in"), _t("Only someone who can manage users can change this.")); return; }
          setG({ ...g, app_access: v });
        }} hint={_t("They sign up in the app as a parent with this mobile number and the child's enrollment ID.")} />
        <Btn title={_t("Save")} busy={busy} onPress={saveG} />
        {!!g?.id && can.delete && <Btn title={_t("Remove guardian")} kind="danger" icon="trash-2" onPress={() => delG(g)} />}
      </Sheet>

      <Sheet visible={!!c} title={c?.id ? _t("Edit emergency contact") : _t("Add emergency contact")} onClose={() => setC(null)}>
        <Field label={_t("Name")} value={c?.name ?? ""} onChangeText={(v) => setC({ ...c, name: v })} />
        <Field label={_t("Relation")} placeholder={_t("e.g. Aunt, neighbour")} value={c?.relation ?? ""} onChangeText={(v) => setC({ ...c, relation: v })} />
        <Field label={_t("Phone")} keyboardType="phone-pad" value={c?.phone ?? ""} onChangeText={(v) => setC({ ...c, phone: v })} />
        <Field label={_t("Other phone (optional)")} keyboardType="phone-pad" value={c?.alt_phone ?? ""} onChangeText={(v) => setC({ ...c, alt_phone: v })} />
        <Field label={_t("Notes (optional)")} value={c?.notes ?? ""} onChangeText={(v) => setC({ ...c, notes: v })} />
        <Field label={_t("Call order (1 = first)")} keyboardType="number-pad" value={String(c?.priority ?? "")} onChangeText={(v) => setC({ ...c, priority: v.replace(/\D/g, "") })} />
        <Btn title={_t("Save")} busy={busy} onPress={saveC} />
        {!!c?.id && (rec.level === "parent" || can.delete) && <Btn title={_t("Remove contact")} kind="danger" icon="trash-2" onPress={() => delC(c)} />}
      </Sheet>
    </>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────
const MED_FIELDS = [
  ["allergies", "Allergies", "e.g. Peanuts – carries an EpiPen"],
  ["conditions", "Medical conditions", "e.g. Asthma, diabetes"],
  ["medications", "Medicines taken at school", "Name, dose and time"],
  ["dietary", "Dietary needs", "e.g. Vegetarian, no pork, lactose free"],
  ["doctor", "Family doctor", "Name and phone"],
  ["insurance", "Health insurance", "Provider and policy number"],
  ["notes", "Other notes", ""],
];

function Health({ rec, setRec, user, target }) {
  const can = rec.can || {};
  const m = rec.medical;
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!m) return <Card><Empty icon="lock" text={_t("You don't have access to this student's health details.")} /></Card>;

  const blood = [{ value: "", label: _t("Not known") }, ...(rec.options?.blood_groups ?? []).map((b) => ({ value: b, label: b }))];
  const levels = (rec.options?.alert_levels ?? ["none", "info", "serious", "severe"]).map((l) => ({
    value: l, label: { none: "No alert", info: _t("For information"), serious: "Serious – staff must know", severe: "Severe – life-threatening" }[l] ?? l,
  }));
  const st = ALERT_STYLE[m.alert_level] ?? ALERT_STYLE.none;
  const fields = MED_FIELDS.filter(([k]) => m[k] !== undefined);
  const empty = !m.modified && !m.blood_group;

  const save = async () => {
    setBusy(true);
    try { const r = await saveMedical(user, target, edit); setRec({ ...rec, medical: r.medical }); setEdit(null); }
    catch (e) { Alert.alert(_t("Health details"), _tx(e.message)); } finally { setBusy(false); }
  };

  return (
    <>
      <Card title={_t("Medical & allergies")} right={can.edit_medical ? <TouchableOpacity onPress={() => setEdit({ ...m })}><Text style={s.link}>{empty ? _t("Add") : _t("Edit")}</Text></TouchableOpacity> : null}>
        {empty ? <Text style={s.meta}>{_t("No health details recorded.")}</Text> : (
          <>
            <View style={s.badges}>
              <Badge text={_t("Alert: {label}", { label: st.label })} bg={st.bg} fg={st.fg} />
              {!!m.blood_group && <Badge text={_t("Blood group {blood_group}", { blood_group: m.blood_group })} />}
            </View>
            {fields.map(([k, label]) => (m[k] ? (
              <View key={k} style={s.kv}>
                <Text style={s.k}>{_tx(label)}</Text>
                <Text style={s.v}>{_tx(m[k])}</Text>
              </View>
            ) : null))}
            <Text style={[s.meta, { marginTop: 8 }]}>{_t("Updated {modified}{v}", { modified: niceDate(m.modified), v: m.updated_by_role === "parent" ? (" " + _t("by a parent") + "") : "" })}</Text>
          </>
        )}
      </Card>
      <Text style={s.foot}>{_t("Health details are stored encrypted and only shown to people allowed to see them. Changes are recorded in the audit log (which details changed, not what they say).")}</Text>

      <Sheet visible={!!edit} title={_t("Medical & allergies")} onClose={() => setEdit(null)}>
        <Picker label={_t("Alert level")} value={edit?.alert_level ?? "none"} options={levels} onChange={(v) => setEdit({ ...edit, alert_level: v })} />
        <Picker label={_t("Blood group")} value={edit?.blood_group ?? ""} options={blood} onChange={(v) => setEdit({ ...edit, blood_group: v })} />
        {fields.map(([k, label, ph]) => (
          <Field key={k} label={_tx(label)} placeholder={_tx(ph)} value={edit?.[k] ?? ""} onChangeText={(v) => setEdit({ ...edit, [k]: v })} multiline
            style={{ minHeight: 64, textAlignVertical: "top" }} />
        ))}
        <Btn title={_t("Save")} busy={busy} onPress={save} />
      </Sheet>
    </>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────
function Documents({ rec, setRec, user, target }) {
  const can = rec.can || {};
  const staff = rec.level === "staff";
  const docs = Array.isArray(rec.documents) ? rec.documents : [];
  const types = Object.entries(rec.options?.doc_types ?? {})
    .filter(([v]) => staff || v !== "custody")
    .map(([value, label]) => ({ value, label }));
  const [up, setUp] = useState(null);       // upload form
  const [meta, setMeta] = useState(null);   // edit details
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(null);

  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true, multiple: false });
    if (!r.canceled && r.assets?.[0]) {
      const a = r.assets[0];
      if (isImage(a)) {
        try { const f = await photoAsJpeg(a, a.name); setUp((u) => ({ ...u, file: f })); }
        catch { Alert.alert(_t("Upload"), _t("This picture couldn't be read. Try the Photo button, or save it as a PDF.")); }
        return;
      }
      setUp((u) => ({ ...u, file: { uri: a.uri, name: a.name, type: a.mimeType || "application/pdf", size: a.size } }));
    }
  };
  const pickPhoto = async (camera) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert(_t("Permission needed"), camera ? _t("Allow camera access to photograph the document.") : _t("Allow photo access to choose a picture.")); return; }
    const opts = { mediaTypes: ["images"], quality: 0.8 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!r.canceled && r.assets?.[0]) {
      try { const f = await photoAsJpeg(r.assets[0]); setUp((u) => ({ ...u, file: f })); }
      catch { Alert.alert(_t("Upload"), _t("This picture couldn't be read. Please try another one.")); }
    }
  };
  // single-copy types (passport, birth certificate …): a new upload replaces the copy already on file
  const single = Array.isArray(rec.options?.single_types) ? rec.options.single_types : [];
  const replaces = (type) => (single.includes(type)
    ? docs.filter((d) => !d.legacy && d.doc_type === type && (staff || d.visible_to_parent))
    : []);
  const upload = async (confirmed = false) => {
    if (!up?.file) { Alert.alert(_t("Upload"), _t("Choose a file or take a photo first.")); return; }
    const max = (rec.options?.max_mb ?? 10) * 1048576;
    if (up.file.size && up.file.size > max) { Alert.alert(_t("Upload"), _t("The file is too big. The limit is {v} MB.", { v: rec.options?.max_mb ?? 10 })); return; }
    const old = replaces(up.doc_type);
    if (old.length && !confirmed) {
      const label = types.find((t) => t.value === up.doc_type)?.label ?? "document";
      Alert.alert(_t("Replace document?"), _t("There is already a {v} on file{v2}. The new upload replaces it and the old copy is deleted.", { v: label.toLowerCase(), v2: old[0].verified ? (" " + _t("(checked by the school)") + "") : "" }), [
        { text: _t("Cancel"), style: "cancel" },
        { text: _t("Replace"), style: "destructive", onPress: () => upload(true) },
      ], { cancelable: true });
      return;
    }
    setBusy(true);
    try {
      const r = await uploadDocument(user, target, up.file, {
        doc_type: up.doc_type, title: up.title, doc_number: up.doc_number, expires_on: up.expires_on,
        ...(staff ? { visible_to_parent: up.visible_to_parent !== false } : {}),
      });
      setRec({ ...rec, documents: r.documents ?? docs });
      setUp(null);
      const replaced = r.document?.replaced > 0;
      if (!staff) Alert.alert(replaced ? _t("Replaced") : _t("Uploaded"), _t("{v}Thank you. The school will check the document.", { v: replaced ? ("" + _t("The earlier copy has been replaced.") + " ") : "" }));
      else if (replaced) Alert.alert(_t("Replaced"), _t("The earlier copy has been replaced."));
    } catch (e) { Alert.alert(_t("Upload"), _tx(e.message)); } finally { setBusy(false); }
  };
  const open = async (d) => {
    setOpening(d.id);
    try { await openDocument(user, target, d); } catch (e) { Alert.alert(_t("Document"), _tx(e.message)); } finally { setOpening(null); }
  };
  const saveMeta = async (patch) => {
    setBusy(true);
    try { const r = await updateDocument(user, target, { ...meta, ...patch }); setRec({ ...rec, documents: r.documents ?? docs }); setMeta(null); }
    catch (e) { Alert.alert(_t("Document"), _tx(e.message)); } finally { setBusy(false); }
  };
  const remove = (d) => Alert.alert(_t("Delete document"), _t("Delete \"{title}\"? The file is removed for good.", { title: d.title }), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Delete"), style: "destructive", onPress: async () => {
      try { const r = await deleteDocument(user, target, d.id); setRec({ ...rec, documents: r.documents ?? [] }); setMeta(null); }
      catch (e) { Alert.alert(_t("Document"), _tx(e.message)); }
    } },
  ]);
  const actions = (d) => {
    const list = [];
    if (can.download) list.push({ text: _t("Open / share"), onPress: () => open(d) });
    if (staff && can.edit_documents && !d.legacy) list.push({ text: _t("Edit details"), onPress: () => setMeta({ ...d }) });
    if (!d.legacy && ((staff && can.delete) || (rec.level === "parent" && !d.verified && d.uploaded_by === user?.ssmsUserName))) {
      list.push({ text: _t("Delete"), style: "destructive", onPress: () => remove(d) });
    }
    if (!list.length) { Alert.alert(_tx(d.title), _t("You can't open documents. Ask the school office.")); return; }
    if (list.length === 1 && list[0].text === _t("Open / share")) { open(d); return; }
    // Android shows at most three buttons: with three actions, tapping outside cancels
    Alert.alert(_tx(d.title), _tx(d.file_name), list.length >= 3 ? list : [...list, { text: _t("Cancel"), style: "cancel" }], { cancelable: true });
  };

  return (
    <>
      <Card title={_t("Documents")} right={can.upload ? <TouchableOpacity onPress={() => setUp({ doc_type: "birth_certificate", visible_to_parent: true })}><Text style={s.link}>{_t("+ Upload")}</Text></TouchableOpacity> : null}>
        {!docs.length && <Text style={s.meta}>{_t("No documents yet.{v}", { v: can.upload ? (" " + _t("Upload a birth certificate, passport, previous report and so on.") + "") : "" })}</Text>}
        {docs.map((d) => (
          <TouchableOpacity key={String(d.id)} style={s.row} onPress={() => actions(d)}>
            <View style={s.docIcon}><Feather name={d.mime?.startsWith("image/") ? "image" : "file-text"} size={18} color={C.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{_tx(d.title)}</Text>
              <Text style={s.meta}>{_tx(d.type_label)}{d.doc_number ? ` ${_t("· No. {doc_number}", { doc_number: d.doc_number })}` : ""}{d.size_bytes ? ` · ${sizeLabel(d.size_bytes)}` : ""}</Text>
              <View style={s.badges}>
                {d.expired && <Badge text={_t("Expired {expires_on}", { expires_on: niceDate(d.expires_on) })} bg="#fee2e2" fg="#991b1b" />}
                {d.expires_soon && <Badge text={_t("Expires {expires_on}", { expires_on: niceDate(d.expires_on) })} bg="#fef3c7" fg="#92400e" />}
                {!d.expired && !d.expires_soon && !!d.expires_on && <Badge text={_t("Valid to {expires_on}", { expires_on: niceDate(d.expires_on) })} />}
                {!d.verified && <Badge text={staff ? _t("From parent – not checked") : _t("Waiting for the school")} bg="#e0e7ff" fg="#3730a3" />}
                {staff && !d.visible_to_parent && !d.legacy && <Badge text={_t("Staff only")} />}
                {d.legacy && <Badge text={_t("Admission form")} />}
              </View>
            </View>
            {opening === d.id ? <ActivityIndicator color={C.brand} /> : <Feather name="more-vertical" size={18} color="#94a3b8" />}
          </TouchableOpacity>
        ))}
      </Card>
      <Text style={s.foot}>{_t("PDF or photos, up to {v} MB each. Files are kept privately on the school's server, not on public links.", { v: rec.options?.max_mb ?? 10 })}</Text>

      <Sheet visible={!!up} title={_t("Upload a document")} onClose={() => setUp(null)}>
        <Picker label={_t("Type")} value={up?.doc_type} options={types} onChange={(v) => setUp({ ...up, doc_type: v })} />
        {!!up && replaces(up.doc_type).length > 0 && (
          <Text style={[s.meta, { color: C.warn, marginTop: -4, marginBottom: 8 }]}>{_t("This replaces the copy already on file.")}</Text>
        )}
        <Field label={_t("Title (optional)")} placeholder={_t("e.g. Passport (UK)")} value={up?.title ?? ""} onChangeText={(v) => setUp({ ...up, title: v })} />
        <Field label={_t("Document number (optional)")} value={up?.doc_number ?? ""} onChangeText={(v) => setUp({ ...up, doc_number: v })} />
        <OptionalDate label={_t("Expiry date (passports, visas)")} value={up?.expires_on ?? ""} onChange={(v) => setUp({ ...up, expires_on: v })} addText={_t("Add an expiry date")} />
        {staff && <Toggle label={_t("Parents can see it")} value={up?.visible_to_parent !== false && up?.doc_type !== "custody"} onChange={(v) => setUp({ ...up, visible_to_parent: v })}
          hint={up?.doc_type === "custody" ? _t("Custody papers are always staff-only.") : undefined} />}
        <View style={s.pickRow}>
          <Btn title={_t("File / PDF")} kind="ghost" icon="paperclip" onPress={pickFile} style={{ flex: 1 }} />
          <Btn title={_t("Camera")} kind="ghost" icon="camera" onPress={() => pickPhoto(true)} style={{ flex: 1 }} />
          <Btn title={_t("Photo")} kind="ghost" icon="image" onPress={() => pickPhoto(false)} style={{ flex: 1 }} />
        </View>
        {!!up?.file && <Text style={s.meta}>{_t("Selected: {name}{v}", { name: up.file.name, v: up.file.size ? ` (${sizeLabel(up.file.size)})` : "" })}</Text>}
        <Btn title={_t("Upload")} icon="upload" busy={busy} onPress={() => upload()} />
      </Sheet>

      <Sheet visible={!!meta} title={_t("Document details")} onClose={() => setMeta(null)}>
        <Picker label={_t("Type")} value={meta?.doc_type} options={types} onChange={(v) => setMeta({ ...meta, doc_type: v })} />
        <Field label={_t("Title")} value={meta?.title ?? ""} onChangeText={(v) => setMeta({ ...meta, title: v })} />
        <Field label={_t("Document number")} value={meta?.doc_number ?? ""} onChangeText={(v) => setMeta({ ...meta, doc_number: v })} />
        <OptionalDate label={_t("Expiry date")} value={meta?.expires_on ?? ""} onChange={(v) => setMeta({ ...meta, expires_on: v })} addText={_t("Add an expiry date")} />
        <Toggle label={_t("Parents can see it")} value={!!meta?.visible_to_parent && meta?.doc_type !== "custody"} onChange={(v) => setMeta({ ...meta, visible_to_parent: v })} />
        <Toggle label={_t("Checked by the school")} value={!!meta?.verified} onChange={(v) => setMeta({ ...meta, verified: v })}
          hint={meta?.verified_by ? _t("Checked by {verified_by} on {verified_at}", { verified_by: meta.verified_by, verified_at: niceDate(meta.verified_at) }) : undefined} />
        <Btn title={_t("Save")} busy={busy} onPress={() => saveMeta({})} />
        {can.delete && <Btn title={_t("Delete document")} kind="danger" icon="trash-2" onPress={() => remove(meta)} />}
      </Sheet>
    </>
  );
}

// ── More: the school's own fields ───────────────────────────────────────────
function More({ rec, setRec, user, target, vals, setVals, onSaved }) {
  const can = rec.can || {};
  const staff = rec.level === "staff";
  const fields = Array.isArray(rec.fields) ? rec.fields : [];
  const [busy, setBusy] = useState(false);

  const editable = (f) => can.edit_fields && (staff || f.parent_can_edit);
  const dirty = fields.some((f) => editable(f) && String(vals[f.id] ?? "") !== String(f.value ?? ""));
  const save = async () => {
    // only what changed, so an old answer that no longer fits can't block the rest
    const values = {};
    fields.forEach((f) => { if (editable(f) && String(vals[f.id] ?? "") !== String(f.value ?? "")) values[f.id] = vals[f.id] ?? ""; });
    setBusy(true);
    try {
      const r = await saveFieldValues(user, target, values);
      onSaved?.();
      setRec({ ...rec, fields: r.fields ?? fields });
      Alert.alert(_t("Saved"), _t("Details saved."));
    }
    catch (e) { Alert.alert(_t("Details"), _tx(e.message)); } finally { setBusy(false); }
  };

  if (!fields.length) {
    return <Card><Empty icon="list" text={staff ? _t("Your school hasn't added any extra student fields. An admin can add them in Setup › Student fields.") : _t("Nothing here yet.")} /></Card>;
  }
  return (
    <Card title={_t("Other details")}>
      {fields.map((f) => {
        const v = vals[f.id] ?? "";
        const label = `${f.label}${f.required && editable(f) ? " *" : ""}`;
        if (!editable(f)) {
          const shown = f.field_type === "yes_no" ? (v === "1" ? "Yes" : v === "0" ? "No" : "") : f.field_type === "date" ? niceDate(v) : v;
          return (
            <View key={f.id} style={s.kv}>
              <Text style={s.k}>{_tx(f.label)}</Text>
              <Text style={[s.v, !shown && { color: C.muted }]}>{_tx(shown) || "—"}</Text>
            </View>
          );
        }
        const set = (x) => setVals({ ...vals, [f.id]: x });
        let input;
        if (f.field_type === "select") {
          input = <Picker label={_tx(label)} value={v} options={[{ value: "", label: "—" }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]} onChange={set} />;
        } else if (f.field_type === "yes_no") {
          input = <Picker label={_tx(label)} value={v} options={[{ value: "", label: "—" }, { value: "1", label: _t("Yes") }, { value: "0", label: _t("No") }]} onChange={set} />;
        } else if (f.field_type === "date") {
          input = <OptionalDate label={_tx(label)} value={v} onChange={set} />;
        } else {
          input = (
            <Field label={_tx(label)} value={String(v)} onChangeText={set} multiline={f.field_type === "long_text"}
              keyboardType={f.field_type === "number" ? "decimal-pad" : f.field_type === "phone" ? "phone-pad" : f.field_type === "email" ? "email-address" : "default"}
              autoCapitalize={f.field_type === "email" ? "none" : "sentences"} />
          );
        }
        return (
          <View key={f.id}>
            {input}
            {!!f.help_text && <Text style={[s.meta, { marginTop: -4, marginBottom: 8 }]}>{_tx(f.help_text)}</Text>}
          </View>
        );
      })}
      {fields.some(editable) && <Btn title={_t("Save details")} busy={busy} disabled={!dirty} onPress={save} />}
    </Card>
  );
}

const s = StyleSheet.create({
  head: { backgroundColor: "#fff", paddingHorizontal: 16, paddingTop: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  title: { fontSize: 18, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  foot: { fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 12, lineHeight: 17 },
  link: { color: C.brand, fontWeight: "700", fontSize: 13 },
  switchBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.brandSoft },
  alert: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 10, padding: 10, marginTop: 8 },
  alertTxt: { flex: 1, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  tabs: { flexDirection: "row", marginTop: 10 },
  tab: { flex: 1, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: C.brand },
  tabTxt: { fontSize: 12, fontWeight: "700", color: C.muted },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9", gap: 10 },
  name: { fontSize: 14, fontWeight: "700", color: C.ink },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontWeight: "700" },
  callBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center" },
  prio: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.bg, textAlign: "center", lineHeight: 22, fontSize: 12, fontWeight: "800", color: C.muted, overflow: "hidden" },
  suggest: { backgroundColor: C.bg, borderRadius: 10, padding: 10, marginBottom: 6 },
  kv: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  k: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.3 },
  v: { fontSize: 14, color: C.ink, marginTop: 2, lineHeight: 20 },
  docIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center" },
  pickRow: { flexDirection: "row", gap: 8 },
  pickOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  pickSheet: { backgroundColor: "#fff", borderRadius: 16, padding: 18 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  addDate: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.line, borderStyle: "dashed", borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12, marginBottom: 10, backgroundColor: "#fff" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: C.ink },
});
