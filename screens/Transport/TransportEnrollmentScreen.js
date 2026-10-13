/**
 * screens/Transport/TransportEnrollmentScreen.js
 *
 * Opened from EnrolledStudentsScreen → Action Menu → "Transport Enrollment"
 * Route params: { student }
 *   student.enrollmentId, student.sessionId, student.firstName, student.lastName,
 *   student.className, student.classId, student.branchId
 */
import React, {
  useState, useEffect, useContext, useCallback, useMemo, useRef,
} from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, ActivityIndicator, Modal, FlatList, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { AuthContext } from "../../context/AuthContext";
import { fetchSessions } from "../../services/SetupServiceApi";
import { fetchBranches, fetchClasses } from "../../services/StudentServiceApi";
import {
  fetchRoutes, fetchStops,
  enrollStudentTransport, removeTransportEnrollment,
  fetchStudentTransportEnrollment,
} from "../../services/TransportServiceApi";

import { fmtMoney } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";
// ── Small helpers ─────────────────────────────────────────────────────────────
const Badge = ({ label, color = "#2563eb" }) => (
  <View style={[s.badge, { backgroundColor: color + "18", borderColor: color + "40" }]}>
    <Text style={[s.badgeTxt, { color }]}>{_tx(label)}</Text>
  </View>
);

const Row = ({ label, value }) => (
  <View style={s.detailRow}>
    <Text style={s.detailLabel}>{_tx(label)}</Text>
    <Text style={s.detailValue}>{_tx(value) || "—"}</Text>
  </View>
);

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const sel = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[s.ddBtn, disabled && { opacity: 0.5 }]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.75}>
        <Text style={[s.ddBtnTxt, !sel?.value && { color: "#94a3b8" }]} numberOfLines={1}>
          {_tx(sel?.label) ?? _tx(label)}
        </Text>
        <Feather name="chevron-down" size={14} color="#64748b" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.ddOverlay} onPress={() => setOpen(false)}>
          <View style={s.ddSheet}>
            <Text style={s.ddTitle}>{_tx(label)}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[s.ddOpt, String(o.value) === String(value) && s.ddOptActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}>
                  <Text style={[s.ddOptTxt, String(o.value) === String(value) && s.ddOptTxtActive]}>
                    {_tx(o.label)}
                  </Text>
                  {String(o.value) === String(value) && (
                    <Feather name="check" size={14} color="#2563eb" />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function TransportEnrollmentScreen({ route: navRoute, navigation }) {
  const { student } = navRoute.params ?? {};
  const { user }    = useContext(AuthContext);

  // ── State ────────────────────────────────────────────────────────────────
  const [sessions,     setSessions]     = useState([]);
  const [branches,     setBranches]     = useState([]);
  const [classes,      setClasses]      = useState([]);
  const [routes,       setRoutes]       = useState([]);
  const [stops,        setStops]        = useState([]);
  const [existing,     setExisting]     = useState(null);  // current enrollment if any
  const [loading,      setLoading]      = useState(true);
  const [loadingStops, setLoadingStops] = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [removing,     setRemoving]     = useState(false);

  // ── Form ─────────────────────────────────────────────────────────────────
  const [sessionId,      setSessionId]      = useState(String(student?.sessionId ?? ""));
  const [branchId,       setBranchId]       = useState(String(student?.branchId  ?? ""));
  const [classId,        setClassId]        = useState(String(student?.classId   ?? ""));
  const [routeId,        setRouteId]        = useState("");
  const [stopId,         setStopId]         = useState("");
  const [pickupStopId,   setPickupStopId]   = useState("");
  const [dropoffStopId,  setDropoffStopId]  = useState("");
  const [transportType,  setTransportType]  = useState("both");

  // Ref holds stop IDs from initial load so the routeId effect can restore
  // them instead of wiping them (avoids the race between setRouteId and setExisting)
  const pendingStops = useRef(null); // { stopId, pickupStopId, dropoffStopId }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchSessions(user),
        fetchBranches(user),
        fetchClasses(user),
        fetchRoutes(user),
        fetchStudentTransportEnrollment(user, student?.enrollmentId),
      ]);

      const [sessR, brR, clR, rtsR, enrR] = results;

      const sess = sessR.status === "fulfilled" ? (Array.isArray(sessR.value) ? sessR.value : sessR.value?.data ?? []) : [];
      const br   = brR.status   === "fulfilled" ? (Array.isArray(brR.value)   ? brR.value   : brR.value?.data   ?? []) : [];
      const cl   = clR.status   === "fulfilled" ? (Array.isArray(clR.value)   ? clR.value   : clR.value?.data   ?? []) : [];
      const rts  = rtsR.status  === "fulfilled" && Array.isArray(rtsR.value) ? rtsR.value : [];
      const enr  = enrR.status  === "fulfilled" ? enrR.value : null;

      //console.log("[TransportEnrollment] sessions:", sessR.status, sess.length);
     // console.log("[TransportEnrollment] branches:", brR.status, br.length, brR.status === "rejected" ? brR.reason?.message : "");
      //console.log("[TransportEnrollment] classes:",  clR.status, cl.length, clR.status === "rejected" ? clR.reason?.message : "");
      //console.log("[TransportEnrollment] routes:",   rtsR.status, rts.length);

      setSessions(Array.isArray(sess) ? sess : []);
      setBranches(Array.isArray(br) ? br : []);
      setClasses(Array.isArray(cl) ? cl : []);
      setRoutes(rts);

      // One alert (server message, e.g. NO_PERMISSION) instead of silently empty lists
      const failMsg = results.map(r => (r.status === "rejected" ? r.reason?.message : r.value?.status === false ? r.value?.message : null)).find(Boolean);
      if (failMsg) Alert.alert(_t("Error"), _tx(failMsg));

     // console.log("[TransportEnrollment] enr:", JSON.stringify(enr));
      if (enr) {
        // Store stop IDs in ref BEFORE setting routeId
        // so the routeId useEffect can restore them instead of wiping them
        pendingStops.current = {
          stopId:        String(enr.stop_id          ?? ""),
          pickupStopId:  String(enr.pickup_stop_id   ?? ""),
          dropoffStopId: String(enr.dropoff_stop_id  ?? ""),
        };
        setExisting(enr);
        setSessionId(String(enr.session_id  ?? student?.sessionId ?? ""));
        setBranchId(String(enr.branch_id    ?? student?.branchId  ?? ""));
        setClassId(String(enr.class_id      ?? student?.classId   ?? ""));
        setTransportType(enr.transport_type ?? "both");
        setRouteId(String(enr.route_id      ?? "")); // triggers useEffect below
      }
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e?.message) || _t("Failed to load transport data."));
    } finally {
      setLoading(false);
    }
  };

  // ── Load stops when route changes ─────────────────────────────────────────
  useEffect(() => {
    if (!routeId) {
      setStops([]); setStopId(""); setPickupStopId(""); setDropoffStopId("");
      return;
    }
    setLoadingStops(true);
    fetchStops(user, routeId)
      .then(st => {
        //console.log("[TransportEnrollment] stops loaded:", st.length, "pendingStops:", JSON.stringify(pendingStops.current));
        setStops(Array.isArray(st) ? st : []);
        if (pendingStops.current) {
          // Restore stop IDs from initial load — do NOT wipe them
          setStopId(pendingStops.current.stopId);
          setPickupStopId(pendingStops.current.pickupStopId);
          setDropoffStopId(pendingStops.current.dropoffStopId);
          pendingStops.current = null; // consumed
        } else {
          // User manually changed route — reset stop selects
          setStopId(""); setPickupStopId(""); setDropoffStopId("");
        }
      })
      .catch(e => Alert.alert(_t("Error loading stops"), _tx(e?.message) || _t("Failed to load stops.")))
      .finally(() => setLoadingStops(false));
  }, [routeId]);

  // ── Derived options ───────────────────────────────────────────────────────
  const sessionOpts = useMemo(() => [
    { label: _t("Select session"), value: "" },
    ...sessions.map(s => ({ label: s.session_name ?? s.session_year ?? String(s.session_id), value: String(s.session_id) })),
  ], [sessions]);

  const branchOpts = useMemo(() => [
    { label: _t("Select branch"), value: "" },
    ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
  ], [branches]);

  const classOpts = useMemo(() => [
    { label: _t("Select class"), value: "" },
    ...classes.map(c => ({ label: c.class_name, value: String(c.class_id) })),
  ], [classes]);

  const routeOpts = useMemo(() => [
    { label: _t("Select route"), value: "" },
    ...routes.map(r => ({
      label: r.route_name + (r.monthly_fare > 0 ? `  ·  ${fmtMoney(r.monthly_fare)}/mo` : ""),
      value: String(r.route_id),
    })),
  ], [routes]);

  const stopOpts = useMemo(() => [
    { label: _t("Select stop"), value: "" },
    ...stops.map(s => ({ label: `${s.stop_order ?? ""} ${s.stop_name}${s.pickup_time ? "  🕐 " + s.pickup_time : ""}`, value: String(s.stop_id) })),
  ], [stops]);

  const typeOpts = [
    { label: _t("Both (Pickup & Drop-off)"), value: "both" },
    { label: _t("Pickup only"),              value: "pickup" },
    { label: _t("Drop-off only"),            value: "dropoff" },
  ];

  // ── Map region ────────────────────────────────────────────────────────────
  const stopsWithCoords = useMemo(() =>
    stops.filter(s => s.latitude && s.longitude), [stops]);

  const mapRegion = useMemo(() => {
    if (!stopsWithCoords.length) return null;
    const lats = stopsWithCoords.map(s => parseFloat(s.latitude));
    const lngs = stopsWithCoords.map(s => parseFloat(s.longitude));
    return {
      latitude:      (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude:     (Math.min(...lngs) + Math.max(...lngs)) / 2,
      latitudeDelta:  Math.max(Math.max(...lats) - Math.min(...lats), 0.05) * 1.5,
      longitudeDelta: Math.max(Math.max(...lngs) - Math.min(...lngs), 0.05) * 1.5,
    };
  }, [stopsWithCoords]);

  const selectedStop    = stops.find(s => String(s.stop_id) === String(stopId));
  const selectedRoute   = routes.find(r => String(r.route_id) === String(routeId));

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!routeId)   { Alert.alert(_t("Required"), _t("Please select a route."));   return; }
    if (!stopId)    { Alert.alert(_t("Required"), _t("Please select a stop."));    return; }
    if (!sessionId) { Alert.alert(_t("Required"), _t("Please select a session.")); return; }

    setSaving(true);
    try {
      await enrollStudentTransport(user, {
        enrollment_id:   student.enrollmentId,
        route_id:        routeId,
        stop_id:         stopId,
        pickup_stop_id:  pickupStopId  || null,
        dropoff_stop_id: dropoffStopId || null,
        session_id:      sessionId,
        class_id:        classId  || null,
        branch_id:       branchId || null,
        transport_type:  transportType,
        monthly_fare:    selectedRoute?.monthly_fare ?? 0,
      });
      Alert.alert(_t("✓ Saved"), _t("Transport enrollment saved successfully."), [
        { text: _t("OK"), onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message));
    } finally {
      setSaving(false);
    }
  };

  // ── Remove ────────────────────────────────────────────────────────────────
  const handleRemove = () => {
    Alert.alert(
      _t("Remove Enrollment"),
      _t("Remove transport enrollment for {firstName} {lastName}?", { firstName: student?.firstName, lastName: student?.lastName }),
      [
        { text: _t("Cancel"), style: "cancel" },
        { text: _t("Remove"), style: "destructive", onPress: async () => {
          setRemoving(true);
          try {
            await removeTransportEnrollment(user, existing.transport_enrollment_id);
            Alert.alert(_t("Removed"), _t("Transport enrollment removed."), [
              { text: _t("OK"), onPress: () => navigation.goBack() },
            ]);
          } catch (e) {
            Alert.alert(_t("Error"), _tx(e.message));
          } finally {
            setRemoving(false);
          }
        }},
      ]
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.loadWrap}>
          <ActivityIndicator color="#0f766e" size="large" />
          <Text style={s.loadTxt}>{_t("Loading transport data…")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        {/* ── Student card ── */}
        <View style={s.studentCard}>
          <View style={s.studentAvatar}>
            <Feather name="user" size={22} color="#0f766e" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.studentName}>
              {_tx(student?.firstName)} {_tx(student?.lastName)}
            </Text>
            <Text style={s.studentMeta}>
              {_tx(student?.className) ?? ""}
              {student?.enrollmentId ? `  ·  #${_tx(student.enrollmentId)}` : ""}
            </Text>
          </View>
          {existing && <Badge label={_t("Enrolled")} color="#0f766e" />}
        </View>

        {/* ── Current enrollment summary (if exists) ── */}
        {existing && (
          <View style={s.card}>
            <View style={s.cardHeaderRow}>
              <Text style={s.sectionTitle}>{_t("CURRENT ENROLLMENT")}</Text>
              <TouchableOpacity
                style={s.removeBtn}
                onPress={handleRemove}
                disabled={removing}>
                {removing
                  ? <ActivityIndicator size="small" color="#dc2626" />
                  : <><Feather name="trash-2" size={13} color="#dc2626" />
                     <Text style={s.removeBtnTxt}>{_t("Remove")}</Text></>}
              </TouchableOpacity>
            </View>
            <Row label={_t("Route")}       value={existing.route_name} />
            <Row label={_t("Stop")}        value={existing.stop_name} />
            <Row label={_t("Type")}        value={existing.transport_type} />
            <Row label={_t("Monthly Fare")} value={existing.monthly_fare > 0 ? fmtMoney(existing.monthly_fare) : "—"} />
          </View>
        )}

        {/* ── Form card ── */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>
            {existing ? _t("UPDATE ENROLLMENT") : _t("NEW ENROLLMENT")}
          </Text>

          {/* Session */}
          <Text style={s.fieldLabel}>{_t("Academic Session *")}</Text>
          <Dropdown
            label={_t("Select session")}
            value={sessionId}
            options={sessionOpts}
            onChange={setSessionId}
          />

          {/* Branch */}
          <Text style={[s.fieldLabel, { marginTop: 14 }]}>{_t("Branch {v}", { v: branches.length === 0 ? _t("(no branches loaded)") : `(${branches.length})` })}</Text>
          <Dropdown
            label={_t("Select branch")}
            value={branchId}
            options={branchOpts}
            onChange={setBranchId}
          />

          {/* Class */}
          <Text style={[s.fieldLabel, { marginTop: 14 }]}>{_t("Class {v}", { v: classes.length === 0 ? _t("(no classes loaded)") : `(${classes.length})` })}</Text>
          <Dropdown
            label={_t("Select class")}
            value={classId}
            options={classOpts}
            onChange={setClassId}
          />

          {/* Route */}
          <Text style={[s.fieldLabel, { marginTop: 14 }]}>{_t("Route *")}</Text>
          <Dropdown
            label={_t("Select route")}
            value={routeId}
            options={routeOpts}
            onChange={setRouteId}
          />

          {/* Route info badge */}
          {selectedRoute && (
            <View style={s.routeInfo}>
              <Feather name="map-pin" size={12} color="#0f766e" />
              <Text style={s.routeInfoTxt}>
                {[selectedRoute.start_point, selectedRoute.end_point].filter(Boolean).join(" → ")}
                {selectedRoute.distance_km ? `  ${_t("·  {distance_km} km", { distance_km: selectedRoute.distance_km })}` : ""}
                {selectedRoute.monthly_fare > 0 ? `  ${_t("·  {monthly_fare}/mo", { monthly_fare: fmtMoney(selectedRoute.monthly_fare) })}` : ""}
              </Text>
            </View>
          )}

          {/* Stop (primary) */}
          <Text style={[s.fieldLabel, { marginTop: 14 }]}>{_t("Primary Stop *")}{" "}{loadingStops && <ActivityIndicator size="small" color="#0f766e" />}
          </Text>
          <Dropdown
            label={routeId ? _t("Select stop") : _t("Select route first")}
            value={stopId}
            options={stopOpts}
            onChange={setStopId}
            disabled={!routeId || loadingStops}
          />

          {/* Transport type */}
          <Text style={[s.fieldLabel, { marginTop: 14 }]}>{_t("Transport Type")}</Text>
          <View style={s.typeRow}>
            {typeOpts.map(t => (
              <TouchableOpacity
                key={t.value}
                style={[s.typeBtn, transportType === t.value && s.typeBtnActive]}
                onPress={() => setTransportType(t.value)}
                activeOpacity={0.75}>
                <Text style={[s.typeBtnTxt, transportType === t.value && s.typeBtnTxtActive]}>
                  {_tx(t.label)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Pickup stop (optional) */}
          {(transportType === "both" || transportType === "pickup") && (
            <>
              <Text style={[s.fieldLabel, { marginTop: 14 }]}>{_t("Pickup Stop")}</Text>
              <Text style={s.fieldHint}>{_t("Where the student is picked up in the morning")}</Text>
              <Dropdown
                label={_t("Same as primary stop")}
                value={pickupStopId}
                options={stopOpts}
                onChange={setPickupStopId}
                disabled={!routeId || loadingStops}
              />
            </>
          )}

          {/* Drop-off stop (optional) */}
          {(transportType === "both" || transportType === "dropoff") && (
            <>
              <Text style={[s.fieldLabel, { marginTop: 14 }]}>{_t("Drop-off Stop")}</Text>
              <Text style={s.fieldHint}>{_t("Where the student is dropped off in the afternoon")}</Text>
              <Dropdown
                label={_t("Same as primary stop")}
                value={dropoffStopId}
                options={stopOpts}
                onChange={setDropoffStopId}
                disabled={!routeId || loadingStops}
              />
            </>
          )}
        </View>

        {/* ── Map ── */}
        {mapRegion && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>{_t("ROUTE MAP")}</Text>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={s.map}
              region={mapRegion}
              scrollEnabled={false}
              zoomEnabled={false}>
              {stopsWithCoords.map((st, idx) => {
                const isSelected =
                  String(st.stop_id) === String(stopId) ||
                  String(st.stop_id) === String(pickupStopId) ||
                  String(st.stop_id) === String(dropoffStopId);
                return (
                  <Marker
                    key={st.stop_id}
                    coordinate={{ latitude: parseFloat(st.latitude), longitude: parseFloat(st.longitude) }}
                    title={_tx(st.stop_name)}
                    description={st.pickup_time ? `🕐 ${_tx(st.pickup_time)}` : undefined}
                    pinColor={
                      isSelected ? "#f59e0b"
                      : idx === 0 ? "#22c55e"
                      : idx === stopsWithCoords.length - 1 ? "#ef4444"
                      : "#2563eb"
                    }
                  />
                );
              })}
              {stopsWithCoords.length > 1 && (
                <Polyline
                  coordinates={stopsWithCoords.map(st => ({
                    latitude: parseFloat(st.latitude),
                    longitude: parseFloat(st.longitude),
                  }))}
                  strokeColor="#0f766e"
                  strokeWidth={3}
                  lineDashPattern={[1]}
                />
              )}
            </MapView>
            <View style={s.mapLegend}>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: "#22c55e" }]} /><Text style={s.legendTxt}>{_t("Start")}</Text></View>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: "#2563eb" }]} /><Text style={s.legendTxt}>{_t("Stop")}</Text></View>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: "#f59e0b" }]} /><Text style={s.legendTxt}>{_t("Selected")}</Text></View>
              <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: "#ef4444" }]} /><Text style={s.legendTxt}>{_t("End")}</Text></View>
            </View>
          </View>
        )}

        {/* ── Save button ── */}
        <TouchableOpacity
          style={[s.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}>
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <Feather name="check-circle" size={18} color="#fff" />
                <Text style={s.saveBtnTxt}>
                  {existing ? _t("Update Enrollment") : _t("Enroll in Transport")}
                </Text>
              </>}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#f0fdfa" },
  loadWrap:       { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadTxt:        { fontSize: 13, color: "#64748b" },

  // Student card
  studentCard:    { flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
                    borderRadius: 14, padding: 14, marginBottom: 14, gap: 12,
                    borderWidth: 1, borderColor: "#99f6e4", elevation: 1 },
  studentAvatar:  { width: 44, height: 44, borderRadius: 22, backgroundColor: "#ccfbf1",
                    alignItems: "center", justifyContent: "center" },
  studentName:    { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  studentMeta:    { fontSize: 12, color: "#64748b", marginTop: 2 },

  // Cards
  card:           { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                    marginBottom: 14, borderWidth: 1, borderColor: "#e2e8f0", elevation: 1 },
  cardHeaderRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle:   { fontSize: 10, fontWeight: "800", color: "#94a3b8",
                    textTransform: "uppercase", letterSpacing: 1 },

  // Detail rows
  detailRow:      { flexDirection: "row", justifyContent: "space-between",
                    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  detailLabel:    { fontSize: 13, color: "#64748b", fontWeight: "600" },
  detailValue:    { fontSize: 13, color: "#0f172a", fontWeight: "700" },

  // Fields
  fieldLabel:     { fontSize: 11, fontWeight: "700", color: "#475569",
                    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  fieldHint:      { fontSize: 11, color: "#94a3b8", marginBottom: 6, marginTop: -4 },

  // Dropdown button
  ddBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0",
                    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  ddBtnTxt:       { fontSize: 13, color: "#0f172a", fontWeight: "600", flex: 1 },

  // Dropdown modal
  ddOverlay:      { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  ddSheet:        { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                    padding: 20, maxHeight: "70%" },
  ddTitle:        { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 12 },
  ddOpt:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingVertical: 13, paddingHorizontal: 4 },
  ddOptActive:    { backgroundColor: "#f0fdfa", borderRadius: 8, paddingHorizontal: 8 },
  ddOptTxt:       { fontSize: 13, color: "#0f172a" },
  ddOptTxtActive: { color: "#0f766e", fontWeight: "700" },

  // Transport type selector
  typeRow:        { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeBtn:        { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
                    backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0" },
  typeBtnActive:  { backgroundColor: "#f0fdfa", borderColor: "#0f766e" },
  typeBtnTxt:     { fontSize: 12, color: "#64748b", fontWeight: "600" },
  typeBtnTxtActive:{ color: "#0f766e", fontWeight: "800" },

  // Route info
  routeInfo:      { flexDirection: "row", alignItems: "center", gap: 6,
                    backgroundColor: "#f0fdfa", borderRadius: 8, padding: 8,
                    marginTop: 6, borderWidth: 1, borderColor: "#99f6e4" },
  routeInfoTxt:   { fontSize: 11, color: "#0f766e", fontWeight: "600", flex: 1 },

  // Map
  map:            { height: 200, borderRadius: 10, marginTop: 10, overflow: "hidden" },
  mapLegend:      { flexDirection: "row", gap: 14, marginTop: 10, justifyContent: "center" },
  legendItem:     { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:      { width: 10, height: 10, borderRadius: 5 },
  legendTxt:      { fontSize: 11, color: "#64748b" },

  // Buttons
  saveBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center",
                    gap: 10, backgroundColor: "#0f766e", borderRadius: 14,
                    paddingVertical: 15, marginTop: 4 },
  saveBtnTxt:     { color: "#fff", fontSize: 15, fontWeight: "800" },
  removeBtn:      { flexDirection: "row", alignItems: "center", gap: 5,
                    paddingHorizontal: 10, paddingVertical: 5,
                    backgroundColor: "#fef2f2", borderRadius: 8,
                    borderWidth: 1, borderColor: "#fecaca" },
  removeBtnTxt:   { fontSize: 12, color: "#dc2626", fontWeight: "700" },

  // Badge
  badge:          { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt:       { fontSize: 11, fontWeight: "700" },
});