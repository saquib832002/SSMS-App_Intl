/**
 * screens/Transport/TransportScreen.js
 * Enterprise transport management — Routes, Stops (with map), Vehicles,
 * Drivers, Assignments and Student Enrollments.
 */
import React, {
  useState, useContext, useEffect, useCallback, useRef, useMemo,
} from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Modal, Pressable,
  KeyboardAvoidingView, Platform, Linking,
  PanResponder, Animated, RefreshControl,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, MaterialIcons } from "@expo/vector-icons";
// Maps: the app's own OpenStreetMap view (BusMap). react-native-maps with Google needs a Google Maps API key in
// app.config.js – without one the app closes as soon as a map is shown.
import BusMap from "../../components/BusMap";
import { useNavigation } from "@react-navigation/native";
import { AuthContext } from "../../context/AuthContext";
import { fetchSessions } from "../../services/SetupServiceApi";
import {
  fetchRoutes, createRoute, updateRoute, deleteRoute,
  fetchStops, createStop, updateStop, deleteStop, reorderStops,
  fetchVehicles, createVehicle, updateVehicle, deleteVehicle,
  fetchDrivers, createDriver, updateDriver, deleteDriver,
  fetchAssignments, saveAssignment, deleteAssignment,
  fetchTransportEnrollments, enrollStudentTransport,
  removeTransportEnrollment, fetchTransportSummary,
} from "../../services/TransportServiceApi";

import { fmtMoney } from "../../services/Locale";
import * as Location from "expo-location";
import { _t, _tx } from "../../services/i18n";
// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview",     get label() { return _t("Overview"); },     icon: "bar-chart-2" },
    { id: "enrollments",  get label() { return _t("Students"); },     icon: "users" },

  { id: "routes",       get label() { return _t("Routes"); },       icon: "map" },
  { id: "vehicles",     get label() { return _t("Vehicles"); },     icon: "truck" },
  { id: "drivers",      get label() { return _t("Drivers"); },      icon: "user" },
  { id: "assignments",  get label() { return _t("Assign"); },       icon: "link" },
];

// ── Small helpers ─────────────────────────────────────────────────────────────
const Badge = ({ label, color = "#2563eb" }) => (
  <View style={[sc.badge, { backgroundColor: color + "18", borderColor: color + "40" }]}>
    <Text style={[sc.badgeTxt, { color }]}>{_tx(label)}</Text>
  </View>
);

const StatCard = ({ icon, label, value, color }) => (
  <View style={[sc.statCard, { borderTopColor: color }]}>
    <View style={[sc.statIconWrap, { backgroundColor: color + "18" }]}>
      <Feather name={icon} size={16} color={color} />
    </View>
    <Text style={sc.statVal}>{_tx(value)}</Text>
    <Text style={sc.statLbl}>{_tx(label)}</Text>
  </View>
);

const EmptyState = ({ icon, title, sub, onAdd, addLabel }) => (
  <View style={sc.empty}>
    <Feather name={icon} size={40} color="#cbd5e1" />
    <Text style={sc.emptyTitle}>{_tx(title)}</Text>
    <Text style={sc.emptySub}>{_tx(sub)}</Text>
    {onAdd && (
      <TouchableOpacity style={sc.emptyBtn} onPress={onAdd} activeOpacity={0.8}>
        <Feather name="plus" size={14} color="#fff" />
        <Text style={sc.emptyBtnTxt}>{_tx(addLabel)}</Text>
      </TouchableOpacity>
    )}
  </View>
);

// ── Generic field modal ───────────────────────────────────────────────────────
function FieldModal({ visible, title, fields, onSave, onClose, saving }) {
  const [form, setForm]             = useState({});
  const [pickerKey, setPickerKey]   = useState(null);  // which datepicker field is open
  const [pickerDate, setPickerDate] = useState(new Date());

  useEffect(() => {
    if (visible) {
      const init = {};
      fields.forEach(f => { init[f.key] = f.initial ?? ""; });
      setForm(init);
      setPickerKey(null);
    }
  }, [visible]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const openPicker = (key, currentVal) => {
    const d = currentVal ? new Date(currentVal) : new Date();
    setPickerDate(isNaN(d.getTime()) ? new Date() : d);
    setPickerKey(key);
  };

  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={sc.modalOverlay} onPress={onClose}>
          <Pressable style={[sc.modalSheet, { display: "flex", flexDirection: "column" }]} onPress={() => {}}>
            <View style={sc.modalHandle} />
            <Text style={sc.modalTitle}>{_tx(title)}</Text>
            <ScrollView
              style={{ flex: 1, flexGrow: 1 }}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled">
              {fields.map(f => (
                <View key={f.key} style={{ marginBottom: 14 }}>
                  <Text style={sc.fieldLabel}>{_tx(f.label)}{f.required ? " *" : ""}</Text>

                  {f.datepicker ? (
                    /* ── Date picker field ── */
                    <>
                      <TouchableOpacity
                        style={[sc.fieldInput, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                        onPress={() => openPicker(f.key, form[f.key])}
                        activeOpacity={0.75}>
                        <Text style={{ fontSize: 13, color: form[f.key] ? "#0f172a" : "#94a3b8" }}>
                          {_tx(form[f.key]) || _t("Tap to select date")}
                        </Text>
                        <Feather name="calendar" size={15} color="#2563eb" />
                      </TouchableOpacity>

                      {/* Android — native date picker dialog */}
                      {pickerKey === f.key && Platform.OS === "android" && (
                        <DateTimePicker
                          value={pickerDate}
                          mode="date"
                          display="default"
                          minimumDate={new Date()}
                          onChange={(_, selected) => {
                            setPickerKey(null);
                            if (selected) { set(f.key, fmt(selected)); }
                          }}
                        />
                      )}
                    </>
                  ) : (
                    /* ── Regular text input ── */
                    <TextInput
                      style={[sc.fieldInput, f.multiline && { height: 70, textAlignVertical: "top" }]}
                      value={String(form[f.key] ?? "")}
                      onChangeText={v => set(f.key, v)}
                      placeholder={_tx(f.placeholder) ?? ""}
                      placeholderTextColor="#94a3b8"
                      keyboardType={f.numeric ? "numeric" : "default"}
                      multiline={!!f.multiline}
                    />
                  )}
                </View>
              ))}

              {/* iOS — inline spinner shown below fields */}
              {pickerKey && Platform.OS === "ios" && (
                <View style={sc.iosPickerWrap}>
                  <View style={sc.iosPickerHeader}>
                    <Text style={sc.iosPickerLabel}>
                      {_tx(fields.find(f => f.key === pickerKey)?.label)}
                    </Text>
                    <TouchableOpacity onPress={() => setPickerKey(null)}>
                      <Text style={{ color: "#2563eb", fontWeight: "700", fontSize: 14 }}>{_t("Done")}</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={pickerDate}
                    mode="date"
                    display="spinner"
                    minimumDate={new Date()}
                    onChange={(_, selected) => {
                      if (selected) {
                        setPickerDate(selected);
                        set(pickerKey, fmt(selected));
                      }
                    }}
                    style={{ height: 180 }}
                  />
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[sc.saveBtn, { marginTop: 12 }, saving && { opacity: 0.6 }]}
              onPress={() => onSave(form)} disabled={saving} activeOpacity={0.85}>
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="check" size={16} color="#fff" /><Text style={sc.saveBtnTxt}>{_t("Save")}</Text></>}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ summary, routes, vehicles, drivers, loading, onRefresh }) {
  const navigation     = useNavigation();
  const activeRoutes   = routes.filter(r  => r.status   === "active").length;
  const activeVehicles = vehicles.filter(v => v.status  === "active").length;
  const activeDrivers  = drivers.filter(d  => d.status  === "active").length;
  const enrolled       = summary?.total_enrolled ?? 0;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 14 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} colors={["#2563eb"]} tintColor="#2563eb" />}>
      <View style={sc.statGrid}>
        <StatCard icon="map"      label={_t("Routes")}   value={activeRoutes}   color="#2563eb" />
        <StatCard icon="truck"    label={_t("Vehicles")} value={activeVehicles} color="#0891b2" />
        <StatCard icon="user"     label={_t("Drivers")}  value={activeDrivers}  color="#7c3aed" />
        <StatCard icon="users"    label={_t("Enrolled")} value={enrolled}       color="#15803d" />
      </View>

      <View style={[sc.card, { flexDirection: "row", gap: 10 }]}>
        <TouchableOpacity style={sc.liveBtn} onPress={() => navigation.navigate("BusFleet")} activeOpacity={0.8}>
          <Feather name="navigation" size={16} color="#fff" />
          <Text style={sc.liveBtnTxt}>{_t("Live buses")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[sc.liveBtn, { backgroundColor: "#ede9fe" }]} onPress={() => navigation.navigate("DriverTrip")} activeOpacity={0.8}>
          <Feather name="truck" size={16} color="#5b21b6" />
          <Text style={[sc.liveBtnTxt, { color: "#5b21b6" }]}>{_t("Drive a trip")}</Text>
        </TouchableOpacity>
      </View>

      {routes.length > 0 && (
        <View style={sc.card}>
          <View style={sc.cardHeader}>
            <View style={[sc.cardHeaderIcon, { backgroundColor: "#dbeafe" }]}>
              <Feather name="map" size={14} color="#2563eb" />
            </View>
            <Text style={sc.cardTitle}>{_t("Active Routes")}</Text>
          </View>
          {routes.filter(r => r.status === "active").map(r => (
            <View key={r.route_id} style={sc.listRow}>
              <View style={[sc.routeDot, { backgroundColor: "#2563eb" }]} />
              <View style={{ flex: 1 }}>
                <Text style={sc.listRowName}>{_tx(r.route_name)}</Text>
                <Text style={sc.listRowSub}>
                  {_tx(r.start_point) || "—"} → {_tx(r.end_point) || "—"}
                  {r.distance_km ? `  ${_t("·  {distance_km} km", { distance_km: r.distance_km })}` : ""}
                </Text>
              </View>
              {r.monthly_fare > 0 && (
                <Text style={sc.fareBadge}>{_t("{monthly_fare}/mo", { monthly_fare: fmtMoney(r.monthly_fare) })}</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ── Routes tab ────────────────────────────────────────────────────────────────
function RoutesTab({ routes, loading, onRefresh, onAdd, onEdit, onDelete, onViewStops }) {
  if (loading && !routes.length) return <ActivityIndicator color="#2563eb" style={{ marginTop: 40 }} />;
  return (
    <View style={{ flex: 1 }}>
      <View style={sc.tabHeader}>
        <Text style={sc.tabHeaderTxt}>{_t("{length} routes", { length: routes.length })}</Text>
        {onAdd && (
          <TouchableOpacity style={sc.addBtn} onPress={onAdd} activeOpacity={0.8}>
            <Feather name="plus" size={14} color="#fff" />
            <Text style={sc.addBtnTxt}>{_t("Add Route")}</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={routes}
        keyExtractor={r => String(r.route_id)}
        contentContainerStyle={{ padding: 12 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} colors={["#2563eb"]} tintColor="#2563eb" />}
        ListEmptyComponent={<EmptyState icon="map" title={_t("No routes yet")} sub={_t("Add your first transport route")} onAdd={onAdd} addLabel={_t("Add Route")} />}
        renderItem={({ item: r }) => (
          <View style={sc.itemCard}>
            <View style={sc.itemCardLeft}>
              <View style={[sc.itemIcon, { backgroundColor: "#eff6ff" }]}>
                <Feather name="map" size={16} color="#2563eb" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={sc.itemName}>{_tx(r.route_name)}
                  {r.route_code ? <Text style={sc.itemCode}>  #{_tx(r.route_code)}</Text> : null}
                </Text>
                <Text style={sc.itemSub}>
                  {[r.start_point, r.end_point].filter(Boolean).join(" → ") || _t("No points set")}
                </Text>
                <View style={sc.itemTags}>
                  {r.distance_km && <Badge label={_t("{distance_km} km", { distance_km: r.distance_km })} color="#0891b2" />}
                  {r.monthly_fare > 0 && <Badge label={_t("{monthly_fare}/mo", { monthly_fare: fmtMoney(r.monthly_fare) })} color="#15803d" />}
                  <Badge label={_tx(r.status)} color={r.status === "active" ? "#15803d" : "#64748b"} />
                </View>
              </View>
            </View>
            <View style={sc.itemActions}>
              <TouchableOpacity style={sc.iconBtn} onPress={() => onViewStops(r)}>
                <Feather name="map-pin" size={15} color="#2563eb" />
              </TouchableOpacity>
              {onEdit && (
                <TouchableOpacity style={sc.iconBtn} onPress={() => onEdit(r)}>
                  <Feather name="edit-2" size={15} color="#64748b" />
                </TouchableOpacity>
              )}
              {onDelete && (
                <TouchableOpacity style={sc.iconBtn} onPress={() => onDelete(r)}>
                  <Feather name="trash-2" size={15} color="#dc2626" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />
    </View>
  );
}

// ── Stops modal — Add · Edit · Delete · Drag-to-reorder ─────────────────────
// Drag uses a single PanResponder on the whole list with refs
// so it never has stale-closure issues across re-renders.
function StopsModal({ visible, route, user, onClose }) {
  const ITEM_H = 68; // row height used for hit-test maths

  // ── State ─────────────────────────────────────────────────────────────────
  const [stops,       setStops]      = useState([]);
  const [loading,     setLoading]    = useState(false);
  const [formOpen,    setFormOpen]   = useState(false);
  const [editStop,    setEditStop]   = useState(null);
  const [savingStop,  setSavingStop] = useState(false);
  const [savingOrder, setSavOrd]     = useState(false);
  const [orderDirty,  setOrdDirty]  = useState(false);
  const [dragIdx,     setDragIdx]   = useState(null); // row being dragged
  const [overIdx,     setOverIdx]   = useState(null); // row being hovered over
  const [form, setForm] = useState({
    stop_name:"", pickup_time:"", dropoff_time:"", latitude:"", longitude:"",
  });

  // ── Refs (never go stale in PanResponder callbacks) ───────────────────────
  const stopsRef    = useRef([]);  // always current copy of stops
  const dragIdxRef  = useRef(null);
  const startYRef   = useRef(0);
  const translateY  = useRef(new Animated.Value(0)).current;
  const [mapCenter, setMapCenter] = useState(null);   // where to look when the route has no stop on the map yet

  // keep ref in sync
  useEffect(() => { stopsRef.current = stops; }, [stops]);

  useEffect(() => {
    if (visible && route) loadStops();
    else resetState();
  }, [visible, route]);

  const resetState = () => {
    setStops([]); setFormOpen(false); setEditStop(null);
    setOrdDirty(false); setDragIdx(null); setOverIdx(null);
  };

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadStops = async () => {
    setLoading(true);
    try {
      const list = await fetchStops(user, route.route_id);
      const safeList = Array.isArray(list) ? list : [];
      setStops(safeList);
      stopsRef.current = safeList;
      setOrdDirty(false);
    }
    catch (e) { Alert.alert(_t("Error"), _tx(e?.message) || _t("Failed to load stops.")); }
    finally { setLoading(false); }
  };

  // ── Map helpers ───────────────────────────────────────────────────────────
  const stopsWithCoords = useMemo(() =>
    stops.filter(s => s.latitude && s.longitude), [stops]);

  const mapRegion = useMemo(() => {
    if (!stopsWithCoords.length) return null;
    const lats = stopsWithCoords.map(s => parseFloat(s.latitude));
    const lngs = stopsWithCoords.map(s => parseFloat(s.longitude));
    return {
      latitude:      (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude:     (Math.min(...lngs) + Math.max(...lngs)) / 2,
      latitudeDelta:  Math.max(Math.max(...lats) - Math.min(...lats), 0.05) * 1.4,
      longitudeDelta: Math.max(Math.max(...lngs) - Math.min(...lngs), 0.05) * 1.4,
    };
  }, [stopsWithCoords]);

  // ── Single PanResponder on the whole list container ───────────────────────
  // We track which row the finger is over via pageY, not per-row responders.
  const listRef = useRef(null);
  const listTop = useRef(0); // absolute Y of list top on screen

  const pan = useRef(PanResponder.create({
    // Only capture if touch starts on a drag-handle (tagged via dragIdxRef)
    onStartShouldSetPanResponder:        () => dragIdxRef.current !== null,
    onStartShouldSetPanResponderCapture: () => dragIdxRef.current !== null,
    onMoveShouldSetPanResponder:         () => dragIdxRef.current !== null,
    onMoveShouldSetPanResponderCapture:  () => dragIdxRef.current !== null,

    onPanResponderGrant: (e) => {
      startYRef.current = e.nativeEvent.pageY;
      translateY.setValue(0);
      setDragIdx(dragIdxRef.current);
      setOverIdx(dragIdxRef.current);
    },

    onPanResponderMove: (e, gs) => {
      translateY.setValue(gs.dy);
      // Compute which row the finger is over
      const relY   = e.nativeEvent.pageY - listTop.current;
      const newOver = Math.max(0, Math.min(
        stopsRef.current.length - 1,
        Math.floor(relY / ITEM_H)
      ));
      setOverIdx(newOver);
    },

    onPanResponderRelease: (e, gs) => {
      const from = dragIdxRef.current;
      const relY  = e.nativeEvent.pageY - listTop.current;
      const to    = Math.max(0, Math.min(
        stopsRef.current.length - 1,
        Math.floor(relY / ITEM_H)
      ));

      // Reset drag visuals immediately
      translateY.setValue(0);
      dragIdxRef.current = null;
      setDragIdx(null);
      setOverIdx(null);

      if (from !== null && from !== to) {
        setStops(prev => {
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          stopsRef.current = next;
          return next;
        });
        setOrdDirty(true);
      }
    },

    onPanResponderTerminate: () => {
      translateY.setValue(0);
      dragIdxRef.current = null;
      setDragIdx(null);
      setOverIdx(null);
    },
  })).current;

  // ── Form helpers ──────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditStop(null);
    setForm({ stop_name:"", pickup_time:"", dropoff_time:"", latitude:"", longitude:"" });
    setFormOpen(true);
  };
  const openEdit = (s) => {
    setEditStop(s);
    setForm({
      stop_name:    s.stop_name    ?? "",
      pickup_time:  s.pickup_time  ?? "",
      dropoff_time: s.dropoff_time ?? "",
      latitude:  s.latitude  ? String(parseFloat(s.latitude).toFixed(6))  : "",
      longitude: s.longitude ? String(parseFloat(s.longitude).toFixed(6)) : "",
    });
    setFormOpen(true);
  };
  const cancelForm = () => { setFormOpen(false); setEditStop(null); };

  const handleSaveStop = async () => {
    if (!form.stop_name.trim()) { Alert.alert(_t("Required"), _t("Stop name is required")); return; }
    setSavingStop(true);
    try {
      const payload = {
        route_id:     route.route_id,
        stop_name:    form.stop_name.trim(),
        pickup_time:  form.pickup_time  || null,
        dropoff_time: form.dropoff_time || null,
        latitude:  form.latitude  ? parseFloat(form.latitude)  : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
      };
      if (editStop) {
        await updateStop(user, editStop.stop_id, payload);
      } else {
        payload.stop_order = stopsRef.current.length + 1;
        await createStop(user, payload);
      }
      cancelForm();
      await loadStops();
    } catch (e) { Alert.alert(_t("Error"), _tx(e.message)); }
    finally { setSavingStop(false); }
  };

  const handleDeleteStop = (s) => {
    Alert.alert(_t("Delete Stop"), _t("Remove \"{stop_name}\"?", { stop_name: s.stop_name }), [
      { text: _t("Cancel"), style: "cancel" },
      { text: _t("Delete"), style: "destructive", onPress: async () => {
        try { await deleteStop(user, s.stop_id); await loadStops(); }
        catch (e) { Alert.alert(_t("Error"), _tx(e.message)); }
      }},
    ]);
  };

  const handleSaveOrder = async () => {
    setSavOrd(true);
    try {
      await reorderStops(user, route.route_id, stops.map(s => s.stop_id));
      setOrdDirty(false);
      Alert.alert(_t("✓ Saved"), _t("Stop order updated."));
      await loadStops();
    } catch (e) { Alert.alert(_t("Error"), _tx(e.message)); }
    finally { setSavOrd(false); }
  };

  // stand at the stop and take the phone's position (works without the map)
  const [locating, setLocating] = useState(false);
  const useMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { Alert.alert(_t("Location"), _t("Allow location for this app to use your position.")); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm(f => ({ ...f, latitude: String(p.coords.latitude.toFixed(6)), longitude: String(p.coords.longitude.toFixed(6)) }));
      if (p.coords.accuracy && p.coords.accuracy > 50) Alert.alert(_t("Location"), _t("The position is only accurate to about {n} m. Step outside or wait a moment and try again for a better one.", { n: Math.round(p.coords.accuracy) }));
    } catch (e) { Alert.alert(_t("Location"), _tx(e.message)); } finally { setLocating(false); }
  };

  const pickOnMap = (lat, lng) => {
    if (!formOpen) return;
    setForm(p => ({ ...p, latitude: String(lat.toFixed(6)), longitude: String(lng.toFixed(6)) }));
  };

  // no stop on the map yet: start the map at the phone's last known position (no prompt; "Use my location" asks)
  useEffect(() => {
    if (!formOpen || stopsWithCoords.length || mapCenter) return;
    let alive = true;
    (async () => {
      try {
        if ((await Location.getForegroundPermissionsAsync()).status !== "granted") return;
        const p = await Location.getLastKnownPositionAsync();
        if (alive && p?.coords) setMapCenter({ lat: p.coords.latitude, lng: p.coords.longitude, zoom: 14 });
      } catch { /* no position: the map shows the world, the user can tap or use "Use my location" */ }
    })();
    return () => { alive = false; };
  }, [formOpen, stopsWithCoords.length, mapCenter]);

  const mapStops = useMemo(() => stopsWithCoords.map((st, idx) => ({
    id: st.stop_id, name: _tx(st.stop_name), lat: parseFloat(st.latitude), lng: parseFloat(st.longitude),
    color: idx === 0 ? "#22c55e" : idx === stopsWithCoords.length - 1 ? "#ef4444" : "#2563eb",
  })).filter(st => Number.isFinite(st.lat) && Number.isFinite(st.lng)), [stopsWithCoords]);
  const formLat = parseFloat(form.latitude);
  const formLng = parseFloat(form.longitude);
  const formPin = formOpen && Number.isFinite(formLat) && Number.isFinite(formLng) && Math.abs(formLat) <= 90 && Math.abs(formLng) <= 180
    ? { lat: formLat, lng: formLng } : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f8fafc" }} edges={["top"]}>

        {/* Header */}
        <View style={sc.stopModalHeader}>
          <TouchableOpacity onPress={onClose} style={sc.backBtn}>
            <Feather name="arrow-left" size={20} color="#0f172a" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={sc.stopModalTitle}>{_tx(route?.route_name)}</Text>
            <Text style={sc.stopModalSub}>{_t("{length} stop{pl}{v}", { length: stops.length, pl: stops.length !== 1 ? "s" : "", v: stops.length > 1 ? ("  " + _t("·  hold ☰ and drag to reorder") + "") : "" })}</Text>
          </View>
          {!formOpen && (
            <TouchableOpacity style={sc.addBtn} onPress={openAdd} activeOpacity={0.8}>
              <Feather name="plus" size={14} color="#fff" />
              <Text style={sc.addBtnTxt}>{_t("Add Stop")}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Map — always shown when form is open so user can tap to pick coords */}
        {(mapRegion || formOpen) ? (
          <BusMap
            stops={mapStops}
            pin={formPin}
            center={mapCenter}
            onPick={formOpen ? pickOnMap : null}
            height={formOpen ? 220 : 240}
            style={[{ borderRadius: 0 }, formOpen && { borderBottomWidth: 2, borderBottomColor: "#2563eb" }]}
          />
        ) : (
          <View style={sc.mapPlaceholder}>
            <Feather name="map" size={32} color="#cbd5e1" />
            <Text style={sc.mapPlaceholderTxt}>{_t("Add stops with GPS coordinates to see map")}</Text>
          </View>
        )}

        {/* Tap-to-set hint shown only when form is open */}
        {formOpen && (
          <View style={sc.mapHint}>
            <Feather name="crosshair" size={12} color="#2563eb" />
            <Text style={sc.mapHintTxt}>
              {form.latitude && form.longitude
                ? _t("📍 {v}, {v2}  ·  tap map to change", { v: parseFloat(form.latitude).toFixed(5), v2: parseFloat(form.longitude).toFixed(5) })
                : _t("Tap anywhere on the map above to set location")}
            </Text>
          </View>
        )}

        {/* Add / Edit form */}
        {formOpen && (
          <View style={sc.addStopForm}>
            <Text style={sc.cardTitle}>
              {editStop ? `✏  ${_tx(editStop.stop_name)}` : _t("✚  NEW STOP")}
            </Text>
            <View style={sc.addStopRow}>
              <TextInput
                style={[sc.fieldInput, { flex: 1, marginRight: 8 }]}
                placeholder={_t("Stop name *")}
                placeholderTextColor="#94a3b8"
                value={form.stop_name}
                onChangeText={v => setForm(p => ({ ...p, stop_name: v }))}
              />
              <TextInput
                style={[sc.fieldInput, { width: 76 }]}
                placeholder="07:30"
                placeholderTextColor="#94a3b8"
                value={form.pickup_time}
                onChangeText={v => setForm(p => ({ ...p, pickup_time: v }))}
              />
            </View>
            <View style={sc.addStopRow}>
              <TextInput
                style={[sc.fieldInput, { flex: 1, marginRight: 8 }]}
                placeholder={_t("Latitude (tap map ↑)")}
                placeholderTextColor="#94a3b8"
                value={form.latitude}
                onChangeText={v => setForm(p => ({ ...p, latitude: v }))}
                keyboardType="numeric"
              />
              <TextInput
                style={[sc.fieldInput, { flex: 1 }]}
                placeholder={_t("Longitude")}
                placeholderTextColor="#94a3b8"
                value={form.longitude}
                onChangeText={v => setForm(p => ({ ...p, longitude: v }))}
                keyboardType="numeric"
              />
            </View>
            <View style={sc.addStopRow}>
              <TouchableOpacity style={[sc.saveBtn, { flex: 1, marginRight: 8, backgroundColor: "#0891b2", flexDirection: "row", gap: 6, justifyContent: "center" }]} onPress={useMyLocation} disabled={locating}>
                {locating ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="crosshair" size={14} color="#fff" />}
                <Text style={sc.saveBtnTxt}>{_t("Use my location")}</Text>
              </TouchableOpacity>
              <TextInput
                style={[sc.fieldInput, { width: 110 }]}
                placeholder={_t("Drop 15:30")}
                placeholderTextColor="#94a3b8"
                value={form.dropoff_time}
                onChangeText={v => setForm(p => ({ ...p, dropoff_time: v }))}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity style={[sc.saveBtn, { flex: 1 }]} onPress={handleSaveStop} disabled={savingStop}>
                {savingStop
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={sc.saveBtnTxt}>{editStop ? _t("Update Stop") : _t("Save Stop")}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[sc.saveBtn, { flex: 1, backgroundColor: "#64748b" }]} onPress={cancelForm}>
                <Text style={sc.saveBtnTxt}>{_t("Cancel")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Save-order banner */}
        {orderDirty && !formOpen && (
          <View style={sc.orderBanner}>
            <Feather name="alert-circle" size={14} color="#92400e" />
            <Text style={sc.orderBannerTxt}>{_t("Order changed — tap Save to apply")}</Text>
            <TouchableOpacity style={sc.orderSaveBtn} onPress={handleSaveOrder} disabled={savingOrder}>
              {savingOrder
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={sc.orderSaveBtnTxt}>{_t("Save Order")}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Stops list ── */}
        {loading ? (
          <ActivityIndicator color="#2563eb" style={{ marginTop: 20 }} />
        ) : stops.length === 0 ? (
          <Text style={[sc.emptyTxt, { margin: 20 }]}>{_t("No stops yet. Tap \"Add Stop\" to begin.")}</Text>
        ) : (
          /* Outer view captures PanResponder and records its Y offset */
          <View
            ref={listRef}
            onLayout={() => {
              listRef.current?.measure((x, y, w, h, px, py) => {
                listTop.current = py;
              });
            }}
            style={{ flex: 1 }}
            {...pan.panHandlers}>
            <ScrollView
              scrollEnabled={dragIdx === null}
              contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}>
              {stops.map((s, index) => {
                const isDragging = dragIdx === index;
                const isOver     = overIdx === index && dragIdx !== null && dragIdx !== index;
                return (
                  <View key={String(s.stop_id)} style={{ marginBottom: 6, height: ITEM_H - 6 }}>
                    <Animated.View style={[
                      sc.stopRow,
                      { height: ITEM_H - 10 },
                      isDragging && {
                        backgroundColor: "#eff6ff",
                        borderColor: "#2563eb",
                        elevation: 12,
                        shadowColor: "#2563eb",
                        shadowOpacity: 0.3,
                        shadowRadius: 8,
                        transform: [{ translateY: translateY }],
                        zIndex: 999,
                      },
                      isOver && {
                        borderColor: "#2563eb",
                        borderStyle: "dashed",
                        backgroundColor: "#f0f9ff",
                      },
                    ]}>

                      {/* Drag handle — press sets dragIdxRef so PanResponder activates */}
                      <TouchableOpacity
                        style={sc.dragHandle}
                        onPressIn={() => { dragIdxRef.current = index; }}
                        onPressOut={() => {
                          // only clear if not currently dragging
                          if (dragIdx === null) dragIdxRef.current = null;
                        }}
                        activeOpacity={0.6}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                        <Feather name="menu" size={20} color={isDragging ? "#2563eb" : "#94a3b8"} />
                      </TouchableOpacity>

                      {/* Sequence badge */}
                      <View style={[sc.stopNum, {
                        backgroundColor:
                          index === 0              ? "#22c55e" :
                          index === stops.length - 1 ? "#ef4444" : "#2563eb",
                      }]}>
                        <Text style={sc.stopNumTxt}>{index + 1}</Text>
                      </View>

                      {/* Stop details */}
                      <View style={{ flex: 1 }}>
                        <Text style={sc.stopName} numberOfLines={1}>{_tx(s.stop_name)}</Text>
                        <Text style={sc.stopMeta} numberOfLines={1}>
                          {s.pickup_time ? `🕐 ${_tx(s.pickup_time)}` : ""}
                          {s.latitude && s.longitude
                            ? `  📍 ${parseFloat(s.latitude).toFixed(4)}, ${parseFloat(s.longitude).toFixed(4)}`
                            : ("  " + _t("No GPS") + "")}
                        </Text>
                      </View>

                      {/* Edit */}
                      <TouchableOpacity onPress={() => openEdit(s)} style={[sc.iconBtn, { marginRight: 4 }]}>
                        <Feather name="edit-2" size={14} color="#2563eb" />
                      </TouchableOpacity>

                      {/* Delete */}
                      <TouchableOpacity onPress={() => handleDeleteStop(s)} style={sc.iconBtn}>
                        <Feather name="trash-2" size={14} color="#dc2626" />
                      </TouchableOpacity>
                    </Animated.View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

      </SafeAreaView>
    </Modal>
  );
}

// ── Generic list tab (Vehicles / Drivers) ─────────────────────────────────────
function ListTab({ items, loading, config, onAdd, onEdit, onDelete, onRefresh }) {
  if (loading && !items.length) return <ActivityIndicator color="#2563eb" style={{ marginTop: 40 }} />;
  return (
    <View style={{ flex: 1 }}>
      <View style={sc.tabHeader}>
        <Text style={sc.tabHeaderTxt}>{_tx(items.length)} {_tx(config.plural)}</Text>
        {onAdd && (
          <TouchableOpacity style={sc.addBtn} onPress={onAdd} activeOpacity={0.8}>
            <Feather name="plus" size={14} color="#fff" />
            <Text style={sc.addBtnTxt}>{_t("Add {singular}", { singular: config.singular })}</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={items}
        keyExtractor={it => String(it[config.idKey])}
        contentContainerStyle={{ padding: 12 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} colors={["#2563eb"]} tintColor="#2563eb" />}
        ListEmptyComponent={<EmptyState icon={config.icon} title={_t("No {plural} yet", { plural: config.plural })} sub={_tx(config.emptySub)} onAdd={onAdd} addLabel={_t("Add {singular}", { singular: config.singular })} />}
        renderItem={({ item }) => (
          <View style={sc.itemCard}>
            <View style={sc.itemCardLeft}>
              <View style={[sc.itemIcon, { backgroundColor: config.tint }]}>
                <Feather name={config.icon} size={16} color={config.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={sc.itemName}>{_tx(item[config.nameKey])}</Text>
                <Text style={sc.itemSub}>{config.subLine(item)}</Text>
                <View style={sc.itemTags}>
                  <Badge label={_tx(item.status) ?? "active"} color={item.status === "active" ? "#15803d" : "#64748b"} />
                  {config.extraBadge?.(item)}
                </View>
              </View>
            </View>
            <View style={sc.itemActions}>
              {onEdit && (
                <TouchableOpacity style={sc.iconBtn} onPress={() => onEdit(item)}>
                  <Feather name="edit-2" size={15} color="#64748b" />
                </TouchableOpacity>
              )}
              {onDelete && (
                <TouchableOpacity style={sc.iconBtn} onPress={() => onDelete(item)}>
                  <Feather name="trash-2" size={15} color="#dc2626" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />
    </View>
  );
}

// ── Assignments tab ───────────────────────────────────────────────────────────
function AssignmentsTab({ assignments, routes, vehicles, drivers, sessions, selSession, loading, onSave, onDelete, onRefresh }) {
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editAssign, setEditAssign] = useState(null);
  const [form, setForm] = useState({ route_id: "", vehicle_id: "", driver_id: "" });
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditAssign(null);
    setForm({ route_id: "", vehicle_id: "", driver_id: "" });
    setModalOpen(true);
  };
  const openEdit = (a) => {
    setEditAssign(a);
    setForm({ route_id: String(a.route_id), vehicle_id: String(a.vehicle_id), driver_id: String(a.driver_id) });
    setModalOpen(true);
  };

  const DDInline = ({ label, value, options, onChange }) => {
    const [open, setOpen] = useState(false);
    const sel = options.find(o => String(o.value) === String(value));
    return (
      <>
        <TouchableOpacity style={sc.fieldInput} onPress={() => setOpen(true)}>
          <Text style={{ color: sel?.value ? "#0f172a" : "#94a3b8", fontSize: 13 }}>
            {_tx(sel?.label) ?? _tx(label)}
          </Text>
        </TouchableOpacity>
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={sc.modalOverlay} onPress={() => setOpen(false)}>
            <View style={[sc.modalSheet, { maxHeight: "50%", flex: 0 }]}>
              <Text style={sc.modalTitle}>{_tx(label)}</Text>
              <FlatList
                data={options}
                keyExtractor={(o, i) => String(o.value) + i}
                renderItem={({ item: o }) => (
                  <TouchableOpacity style={sc.ddOpt} onPress={() => { onChange(o.value); setOpen(false); }}>
                    <Text style={[sc.ddOptTxt, String(o.value) === String(value) && { color: "#2563eb", fontWeight: "700" }]}>{_tx(o.label)}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </Pressable>
        </Modal>
      </>
    );
  };

  const handleSave = async () => {
    if (!form.route_id || !form.vehicle_id || !form.driver_id) {
      Alert.alert(_t("Required"), _t("Please select route, vehicle and driver.")); return;
    }
    setSaving(true);
    try {
      await onSave({
        ...form,
        session_id:    selSession,
        assignment_id: editAssign?.assignment_id ?? null,
      });
      setModalOpen(false);
      setEditAssign(null);
      setForm({ route_id: "", vehicle_id: "", driver_id: "" });
    } catch (e) { Alert.alert(_t("Error"), _tx(e.message)); }
    finally { setSaving(false); }
  };

  if (loading) return <ActivityIndicator color="#2563eb" style={{ marginTop: 40 }} />;
  return (
    <View style={{ flex: 1 }}>
      <View style={sc.tabHeader}>
        <Text style={sc.tabHeaderTxt}>{_t("{length} assignments", { length: assignments.length })}</Text>
        <TouchableOpacity style={sc.addBtn} onPress={openNew} activeOpacity={0.8}>
          <Feather name="plus" size={14} color="#fff" />
          <Text style={sc.addBtnTxt}>{_t("Assign")}</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={assignments}
        keyExtractor={a => String(a.assignment_id)}
        contentContainerStyle={{ padding: 12 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} colors={["#2563eb"]} tintColor="#2563eb" />}
        ListEmptyComponent={<EmptyState icon="link" title={_t("No assignments")} sub={_t("Assign vehicles and drivers to routes")} onAdd={openNew} addLabel={_t("Create Assignment")} />}
        renderItem={({ item: a }) => (
          <View style={sc.itemCard}>
            <View style={sc.itemCardLeft}>
              <View style={[sc.itemIcon, { backgroundColor: "#f5f3ff" }]}>
                <Feather name="link" size={16} color="#7c3aed" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={sc.itemName}>{_tx(a.route_name) ?? _t("Route #{route_id}", { route_id: a.route_id })}</Text>
                <Text style={sc.itemSub}>🚌 {_tx(a.vehicle_number) ?? _tx(a.vehicle_id)}  ·  👤 {_tx(a.driver_name) ?? _tx(a.driver_id)}</Text>
              </View>
            </View>
            <View style={sc.itemActions}>
              <TouchableOpacity style={sc.iconBtn} onPress={() => openEdit(a)}>
                <Feather name="edit-2" size={15} color="#64748b" />
              </TouchableOpacity>
              <TouchableOpacity style={sc.iconBtn} onPress={() => onDelete(a)}>
                <Feather name="trash-2" size={15} color="#dc2626" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={sc.modalOverlay} onPress={() => setModalOpen(false)}>
            <Pressable style={[sc.modalSheet, { flexDirection: "column" }]} onPress={() => {}}>
              <View style={sc.modalHandle} />
              <Text style={sc.modalTitle}>{editAssign ? _t("Edit Assignment") : _t("New Assignment")}</Text>
              <ScrollView
                style={{ flex: 1, flexGrow: 1 }}
                contentContainerStyle={{ paddingBottom: 8 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled">
                <Text style={sc.fieldLabel}>{_t("Route *")}</Text>
                <DDInline label={_t("Select Route")} value={form.route_id}
                  options={[{ label: _t("Select Route"), value: "" }, ...routes.map(r => ({ label: r.route_name, value: String(r.route_id) }))]}
                  onChange={v => setForm(p => ({ ...p, route_id: v }))} />
                <Text style={[sc.fieldLabel, { marginTop: 12 }]}>{_t("Vehicle *")}</Text>
                <DDInline label={_t("Select Vehicle")} value={form.vehicle_id}
                  options={[{ label: _t("Select Vehicle"), value: "" }, ...vehicles.map(v => ({ label: `${v.vehicle_number} — ${v.vehicle_name ?? ""}`, value: String(v.vehicle_id) }))]}
                  onChange={v => setForm(p => ({ ...p, vehicle_id: v }))} />
                <Text style={[sc.fieldLabel, { marginTop: 12 }]}>{_t("Driver *")}</Text>
                <DDInline label={_t("Select Driver")} value={form.driver_id}
                  options={[{ label: _t("Select Driver"), value: "" }, ...drivers.map(d => ({ label: d.driver_name, value: String(d.driver_id) }))]}
                  onChange={v => setForm(p => ({ ...p, driver_id: v }))} />
              </ScrollView>
              <TouchableOpacity style={[sc.saveBtn, { marginTop: 12 }, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={sc.saveBtnTxt}>{editAssign ? _t("Update Assignment") : _t("Save Assignment")}</Text>}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Enrollments tab ───────────────────────────────────────────────────────────
function EnrollmentsTab({ enrollments, routes, loading, onRefresh, navigation, isAdminOrOwner }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() =>
    enrollments.filter(e =>
      !search.trim() ||
      e.student_name?.toLowerCase().includes(search.toLowerCase()) ||
      e.route_name?.toLowerCase().includes(search.toLowerCase())
    ), [enrollments, search]);

  return (
    <View style={{ flex: 1 }}>
      {/* Search + count + refresh */}
      <View style={sc.tabHeader}>
        <View style={[sc.fieldInput, { flex: 1, flexDirection: "row", alignItems: "center",
          paddingVertical: 0, marginBottom: 0, paddingLeft: 10 }]}>
          <Feather name="search" size={13} color="#94a3b8" />
          <TextInput
            style={{ flex: 1, paddingVertical: 10, paddingLeft: 6, fontSize: 13, color: "#0f172a" }}
            placeholder={_t("Search student or route…")}
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} style={{ padding: 6 }}>
              <Feather name="x" size={13} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={[sc.tabHeaderTxt, { marginLeft: 8 }]}>{_tx(filtered.length)}</Text>
        <TouchableOpacity
          onPress={onRefresh}
          style={[sc.iconBtn, { marginLeft: 6 }]}
          disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color="#2563eb" />
            : <Feather name="refresh-cw" size={14} color="#2563eb" />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#2563eb" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(e, i) => String(e.transport_enrollment_id ?? i)}
          contentContainerStyle={{ padding: 12 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} colors={["#2563eb"]} tintColor="#2563eb" />}
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title={enrollments.length === 0 ? _t("No students enrolled") : _t("No results")}
              sub={enrollments.length === 0
                ? _t("Go to School tab → tap a student → Transport Enrollment")
                : _t("No match for \"{search}\"", { search })}
            />
          }
          renderItem={({ item: e }) => (
            <Pressable
              style={[sc.itemCard, { alignItems: "center" }]}
              android_ripple={{ color: "#e2e8f0" }}
              onPress={() => navigation.navigate("TransportEnrollment", {
                student: {
                  enrollmentId: e.enrollment_id,
                  sessionId:    e.session_id,
                  firstName:    (e.student_name ?? "").split(" ")[0],
                  lastName:     (e.student_name ?? "").split(" ").slice(1).join(" "),
                  className:    e.class_name ?? "",
                  classId:      e.class_id   ?? null,
                  branchId:     e.branch_id  ?? null,
                },
              })}>
              <View style={sc.itemCardLeft}>
                <View style={sc.studentAvatar}>
                  <Text style={sc.studentAvatarTxt}>
                    {(e.student_name?.[0] ?? "S").toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={sc.itemName}>
                    {_tx(e.student_name) ?? _t("Enrollment #{enrollment_id}", { enrollment_id: e.enrollment_id })}
                  </Text>
                  <Text style={sc.itemSub}>
                    🚌 {_tx(e.route_name) ?? _t("Route #{route_id}", { route_id: e.route_id })}
                    {"  ·  "}📍 {_tx(e.stop_name) ?? _t("Stop #{stop_id}", { stop_id: e.stop_id })}
                  </Text>
                  <View style={sc.itemTags}>
                    <Badge label={_tx(e.transport_type) ?? "both"} color="#0891b2" />
                    {parseFloat(e.monthly_fare ?? 0) > 0 && (
                      <Badge label={_t("{monthly_fare}/mo", { monthly_fare: fmtMoney(e.monthly_fare) })} color="#15803d" />
                    )}
                  </View>
                </View>
              </View>
              {/* Right side — Pay button + chevron */}
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                onStartShouldSetResponder={() => true}>
                <TouchableOpacity
                  style={sc.payBtn}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate("StudentFeeTransport", {
                    enrollmentId:   e.enrollment_id,
                    registrationId: e.registration_id ?? null,
                    studentsName:   e.student_name ?? "",
                    sessionId:      e.session_id,
                    classId:        e.class_id   ?? null,
                    branchId:       e.branch_id  ?? null,
                    ssmsClientCode: e.ssms_client_code ?? null,
                    feeCategory:    "Transport",
                  })}>
                  <Feather name="credit-card" size={12} color="#fff" />
                  <Text style={sc.payBtnTxt}>{_t("Pay")}</Text>
                </TouchableOpacity>
                <Feather name="chevron-right" size={16} color="#94a3b8" />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ══════════════════════════════════════════════════════════════════════════════
export default function TransportScreen() {
  const { user }      = useContext(AuthContext);
  const navigation    = useNavigation();
  const isAdminOrOwner = ["admin","owner"].includes(
    (user?.ssmsUserRole ?? user?.role ?? "").toLowerCase()
  );
  const [activeTab, setActiveTab]   = useState("overview");
  const [sessions,  setSessions]    = useState([]);
  const [selSession, setSelSession] = useState("");
  const [routes,    setRoutes]      = useState([]);
  const [vehicles,  setVehicles]    = useState([]);
  const [drivers,   setDrivers]     = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [summary,   setSummary]     = useState({});
  const [loading,   setLoading]     = useState(false);
  const [stopsRoute, setStopsRoute] = useState(null);   // route whose stops modal is open
  const [editItem,   setEditItem]   = useState(null);
  const [modalType,  setModalType]  = useState(null);   // 'route'|'vehicle'|'driver'
  const [saving,     setSaving]     = useState(false);

  // ── Load sessions — pick the current active session only ──────────────────
  useEffect(() => {
    fetchSessions(user)
      .then(d => {
        const list = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
        // getSessions answers 403 {status:false,message} without throwing — tell the user once
        if (d?.status === false && d?.message) Alert.alert(_t("Error"), _tx(d.message));
        // Prefer is_current=Y + active=Yes; fall back to first in list
        const current = list.find(
          s => (s.is_current ?? '').toUpperCase() === 'Y' && (s.active ?? '').toLowerCase() === 'yes'
        ) ?? list.find(
          s => (s.is_current ?? '').toUpperCase() === 'Y'
        ) ?? list[0];
        setSessions(current ? [current] : list.slice(0, 1));
        if (current) setSelSession(String(current.session_id));
      }).catch((err) => Alert.alert(_t("Error"), _tx(err?.message) || _t("Failed to load sessions.")));
  }, []);

  // ── Load all data when session changes ─────────────────────────────────────
  useEffect(() => {
    if (!selSession) return;
    loadAll();
  }, [selSession]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // allSettled: one forbidden call (403) must not blank every tab
      const results = await Promise.allSettled([
        fetchRoutes(user),
        fetchVehicles(user),
        fetchDrivers(user),
        fetchAssignments(user, selSession),
        fetchTransportEnrollments(user, { sessionId: selSession }),
        fetchTransportSummary(user, selSession),
      ]);
      const [r, v, d, a, e] = results.slice(0, 5).map(x => (x.status === "fulfilled" && Array.isArray(x.value) ? x.value : []));
      const s = results[5].status === "fulfilled" && results[5].value && typeof results[5].value === "object" ? results[5].value : {};
      setRoutes(r); setVehicles(v); setDrivers(d);
      setAssignments(a); setEnrollments(e); setSummary(s);
      const failed = results.find(x => x.status === "rejected");
      if (failed) Alert.alert(_t("Error loading transport data"), _tx(failed.reason?.message) || _t("Some transport data could not be loaded."));
    } catch (e) { Alert.alert(_t("Error loading transport data"), _tx(e?.message) || _t("Failed to load transport data.")); }
    finally { setLoading(false); }
  }, [user, selSession]);

  // ── Generic CRUD handlers ──────────────────────────────────────────────────
  const openAdd  = (type)       => { setEditItem(null);  setModalType(type); };
  const openEdit = (type, item) => { setEditItem(item);  setModalType(type); };
  const closeModal = ()         => { setModalType(null); setEditItem(null);  };

  const handleSave = async (type, form) => {
    setSaving(true);
    try {
      const payload = { ...form };
      if (type === "route") {
        editItem
          ? await updateRoute(user, editItem.route_id, payload)
          : await createRoute(user, payload);
      } else if (type === "vehicle") {
        editItem
          ? await updateVehicle(user, editItem.vehicle_id, payload)
          : await createVehicle(user, payload);
      } else if (type === "driver") {
        editItem
          ? await updateDriver(user, editItem.driver_id, payload)
          : await createDriver(user, payload);
      }
      closeModal();
      await loadAll();
    } catch (e) { Alert.alert(_t("Error"), _tx(e.message)); }
    finally { setSaving(false); }
  };

  const handleDelete = (type, item) => {
    const names = { route: item.route_name, vehicle: item.vehicle_number, driver: item.driver_name };
    Alert.alert(_t("Delete {type}", { type }), _t("Remove \"{v}\"?", { v: names[type] }), [
      { text: _t("Cancel"), style: "cancel" },
      { text: _t("Delete"), style: "destructive", onPress: async () => {
        try {
          if (type === "route")   await deleteRoute(user, item.route_id);
          if (type === "vehicle") await deleteVehicle(user, item.vehicle_id);
          if (type === "driver")  await deleteDriver(user, item.driver_id);
          await loadAll();
        } catch (e) { Alert.alert(_t("Error"), _tx(e.message)); }
      }},
    ]);
  };

  const handleDeleteAssignment = (a) => {
    Alert.alert(_t("Remove Assignment"), _t("Remove this route assignment?"), [
      { text: _t("Cancel"), style: "cancel" },
      { text: _t("Remove"), style: "destructive", onPress: async () => {
        try { await deleteAssignment(user, a.assignment_id); await loadAll(); }
        catch (e) { Alert.alert(_t("Error"), _tx(e.message)); }
      }},
    ]);
  };

  // ── Modal field configs ────────────────────────────────────────────────────
  const MODAL_FIELDS = {
    route: [
      { key: "route_name",   label: _t("Route Name"),    required: true,  placeholder: _t("e.g. North Route"),    initial: editItem?.route_name   ?? "" },
      { key: "route_code",   label: _t("Route Code"),    placeholder: _t("e.g. RT01"),                             initial: editItem?.route_code   ?? "" },
      { key: "start_point",  label: _t("Start Point"),   placeholder: _t("e.g. School Gate"),                      initial: editItem?.start_point  ?? "" },
      { key: "end_point",    label: _t("End Point"),     placeholder: _t("e.g. Central Bus Stand"),                 initial: editItem?.end_point    ?? "" },
      { key: "distance_km",  label: _t("Distance (km)"), placeholder: _t("e.g. 12.5"),  numeric: true,             initial: editItem?.distance_km  ?? "" },
      { key: "monthly_fare", label: _t("Monthly Fare"),  placeholder: _t("e.g. 800"),   numeric: true,             initial: editItem?.monthly_fare ?? "" },
    ],
    vehicle: [
      { key: "vehicle_number", label: _t("Vehicle Number"), required: true,  placeholder: _t("e.g. BR01AB1234"), initial: editItem?.vehicle_number ?? "" },
      { key: "vehicle_name",   label: _t("Vehicle Name"),   placeholder: _t("e.g. Bus 01"),                       initial: editItem?.vehicle_name   ?? "" },
      { key: "capacity",       label: _t("Capacity"),       placeholder: _t("e.g. 40"),  numeric: true,           initial: editItem?.capacity       ?? "" },
      { key: "model",          label: _t("Model"),          placeholder: _t("e.g. Tata Starbus"),                 initial: editItem?.model          ?? "" },
    ],
    driver: [
      { key: "driver_name",    label: _t("Driver Name"),    required: true,  placeholder: _t("Full name"),        initial: editItem?.driver_name    ?? "" },
      { key: "mobile_number",  label: _t("Mobile Number"),  placeholder: _t("e.g. 9876543210"), numeric: true,    initial: editItem?.mobile_number  ?? "" },
      { key: "license_number", label: _t("License Number"), placeholder: _t("e.g. BR0120100012345"),              initial: editItem?.license_number ?? "" },
      { key: "license_expiry", label: _t("License Expiry"), datepicker: true,                                 initial: editItem?.license_expiry ?? "" },
    ],
  };

  const sessionLabel = sessions.find(s => String(s.session_id) === String(selSession))?.session_name ?? "Session";

  return (
    <SafeAreaView style={sc.safe} edges={["bottom"]}>

      {/* ── Transport header band ── */}
      <View style={sc.screenHeader}>
        <View style={sc.screenHeaderIcon}>
          <Feather name="truck" size={18} color="#0891b2" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sc.screenHeaderTitle}>{_t("Transport")}</Text>
          <Text style={sc.screenHeaderSub}>{_t("Routes · Vehicles · Drivers · Students")}</Text>
        </View>
        {/* Current session label */}
        {sessions[0] && (
          <View style={sc.sessionPill}>
            <Feather name="calendar" size={11} color="rgba(255,255,255,0.85)" />
            <Text style={sc.sessionPillTxt}>
              {_tx(sessions[0].session_name) ?? _tx(sessions[0].session_year) ?? _t("Current")}
            </Text>
          </View>
        )}
      </View>

      {/* ── Tab bar ── */}
      <View style={sc.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8, gap: 6 }}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[sc.tabItem, activeTab === t.id && sc.tabItemActive]}
              onPress={() => setActiveTab(t.id)}>
              <Feather name={t.icon} size={13} color={activeTab === t.id ? "#fff" : "#64748b"} />
              <Text style={[sc.tabLabel, activeTab === t.id && sc.tabLabelActive]}>{_tx(t.label)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Tab content */}
      {activeTab === "overview"
        ? <OverviewTab summary={_tx(summary)} routes={routes} vehicles={vehicles} drivers={drivers} loading={loading} onRefresh={loadAll} />
        : activeTab === "routes"
          ? <RoutesTab
              routes={routes} loading={loading}
              onRefresh={loadAll}
              onAdd={isAdminOrOwner ? () => openAdd("route") : null}
              onEdit={isAdminOrOwner ? r => openEdit("route", r) : null}
              onDelete={isAdminOrOwner ? r => handleDelete("route", r) : null}
              onViewStops={r => setStopsRoute(r)} />
          : activeTab === "vehicles"
          ? <ListTab
              items={vehicles} loading={loading}
              onRefresh={loadAll}
              config={{
                plural: "vehicles", singular: "Vehicle", idKey: "vehicle_id",
                nameKey: "vehicle_number", icon: "truck",
                tint: "#ecfeff", accent: "#0891b2",
                subLine: v => `${v.vehicle_name ?? ""}${v.capacity ? "  ·  Cap " + v.capacity : ""}`,
                emptySub: "Add school buses and vans",
              }}
              onAdd={isAdminOrOwner ? () => openAdd("vehicle") : null}
              onEdit={isAdminOrOwner ? v => openEdit("vehicle", v) : null}
              onDelete={isAdminOrOwner ? v => handleDelete("vehicle", v) : null} />
          : activeTab === "drivers"
          ? <ListTab
              items={drivers} loading={loading}
              onRefresh={loadAll}
              config={{
                plural: "drivers", singular: "Driver", idKey: "driver_id",
                nameKey: "driver_name", icon: "user",
                tint: "#faf5ff", accent: "#7c3aed",
                subLine: d => `${d.mobile_number ?? ""}${d.license_number ? "  ·  Lic " + d.license_number : ""}`,
                emptySub: "Add bus drivers",
                extraBadge: d => d.license_expiry
                  ? <Badge label={_t("Exp {license_expiry}", { license_expiry: d.license_expiry })} color={new Date(d.license_expiry) < new Date() ? "#dc2626" : "#64748b"} />
                  : null,
              }}
              onAdd={isAdminOrOwner ? () => openAdd("driver") : null}
              onEdit={isAdminOrOwner ? d => openEdit("driver", d) : null}
              onDelete={isAdminOrOwner ? d => handleDelete("driver", d) : null} />
          : activeTab === "assignments"
          ? <AssignmentsTab
              assignments={assignments} routes={routes}
              vehicles={vehicles} drivers={drivers}
              sessions={sessions} selSession={selSession}
              loading={loading}
              onRefresh={loadAll}
              onSave={payload => saveAssignment(user, payload).then(loadAll)}
              onDelete={handleDeleteAssignment} />
          : <EnrollmentsTab
              enrollments={enrollments}
              routes={routes}
              loading={loading}
              onRefresh={loadAll}
              navigation={navigation}
              isAdminOrOwner={isAdminOrOwner} />
      }

      {/* Stops map modal */}
      <StopsModal
        visible={!!stopsRoute}
        route={stopsRoute}
        user={user}
        onClose={() => setStopsRoute(null)} />

      {/* Add/Edit modals */}
      {["route", "vehicle", "driver"].map(type => (
        <FieldModal
          key={type}
          visible={modalType === type}
          title={editItem ? _t("Edit {type}", { type }) : _t("Add {type}", { type })}
          fields={(MODAL_FIELDS[type] ?? []).map(f => ({ ...f, initial: editItem ? (editItem[f.key] ?? "") : "" }))}
          onSave={form => handleSave(type, form)}
          onClose={closeModal}
          saving={saving} />
      ))}
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  liveBtn: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#5b21b6", borderRadius: 10, paddingVertical: 12 },
  liveBtnTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  safe:             { flex: 1, backgroundColor: "#f1f5f9" },

  // Transport header band
  screenHeader:     { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: "#0891b2" },
  screenHeaderIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  screenHeaderTitle:{ fontSize: 15, fontWeight: "800", color: "#fff", letterSpacing: -0.2 },
  screenHeaderSub:  { fontSize: 11, color: "rgba(255,255,255,0.80)", marginTop: 1 },

  // Session label (non-interactive, current session only)
  sessionPill:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.22)" },
  sessionPillTxt:   { fontSize: 11, color: "#fff", fontWeight: "700" },

  // Tab bar — pill style
  tabBar:           { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tabItem:          { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#f1f5f9" },
  tabItemActive:    { backgroundColor: "#0891b2" },
  tabLabel:         { fontSize: 12, fontWeight: "600", color: "#64748b" },
  tabLabelActive:   { color: "#fff", fontWeight: "700" },

  // Stats — single row
  statGrid:         { flexDirection: "row", gap: 8, marginBottom: 14 },
  statCard:         { flex: 1, backgroundColor: "#fff", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: "center", gap: 4, borderTopWidth: 3, borderWidth: 1, borderColor: "#e2e8f0", elevation: 2, shadowColor: "#0f172a", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  statIconWrap:     { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  statVal:          { fontSize: 18, fontWeight: "900", color: "#0f172a" },
  statLbl:          { fontSize: 9, color: "#64748b", fontWeight: "700", textTransform: "uppercase", textAlign: "center" },

  // Card
  card:             { backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#e2e8f0", elevation: 2, shadowColor: "#0f172a", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  cardHeader:       { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  cardHeaderIcon:   { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  cardTitle:        { fontSize: 13, fontWeight: "800", color: "#0f172a", letterSpacing: -0.1 },

  // List row (overview)
  listRow:          { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9", gap: 10 },
  routeDot:         { width: 10, height: 10, borderRadius: 5 },
  listRowName:      { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  listRowSub:       { fontSize: 11, color: "#64748b", marginTop: 1 },
  fareBadge:        { fontSize: 11, fontWeight: "700", color: "#15803d" },

  // Tab header
  tabHeader:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  tabHeaderTxt:     { fontSize: 12, fontWeight: "600", color: "#64748b" },

  // Item card
  itemCard:         { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#e2e8f0", elevation: 2, shadowColor: "#0f172a", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  itemCardLeft:     { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  itemIcon:         { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  itemName:         { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  itemCode:         { fontSize: 11, color: "#94a3b8", fontWeight: "400" },
  itemSub:          { fontSize: 11, color: "#64748b", marginTop: 2 },
  itemTags:         { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  itemActions:      { flexDirection: "row", gap: 4 },

  // Buttons
  addBtn:           { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#0891b2", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  addBtnTxt:        { color: "#fff", fontSize: 12, fontWeight: "700" },
  iconBtn:          { width: 34, height: 34, borderRadius: 10, backgroundColor: "#f8fafc", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#e2e8f0" },
  saveBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0891b2", borderRadius: 12, paddingVertical: 13 },
  saveBtnTxt:       { color: "#fff", fontSize: 14, fontWeight: "800" },

  // Badge
  badge:            { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt:         { fontSize: 10, fontWeight: "700" },

  // Modal
  modalOverlay:     { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  modalSheet:       { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%", flex: 1, flexShrink: 1 },
  modalHandle:      { width: 40, height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  modalTitle:       { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 16 },

  // Fields
  fieldLabel:       { fontSize: 11, fontWeight: "700", color: "#475569", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 },
  fieldInput:       { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13, color: "#0f172a", marginBottom: 4 },

  // Empty state
  empty:            { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle:       { fontSize: 15, fontWeight: "700", color: "#94a3b8" },
  emptySub:         { fontSize: 12, color: "#cbd5e1", textAlign: "center" },
  emptyBtn:         { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2563eb", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
  emptyBtnTxt:      { color: "#fff", fontSize: 13, fontWeight: "700" },
  emptyTxt:         { fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 20 },

  // Map
  map:              { height: 240, borderRadius: 0 },
  mapPlaceholder:   { height: 120, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9", gap: 8 },
  mapPlaceholderTxt:{ fontSize: 12, color: "#94a3b8", textAlign: "center", paddingHorizontal: 20 },
  mapHint:          { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#eff6ff", paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#bfdbfe" },
  mapHintTxt:       { fontSize: 11, color: "#2563eb", fontWeight: "600", flex: 1 },

  // Stops modal
  stopModalHeader:  { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  backBtn:          { width: 36, height: 36, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  stopModalTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  stopModalSub:     { fontSize: 11, color: "#64748b" },
  addStopForm:      { backgroundColor: "#fff", padding: 14, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  addStopRow:       { flexDirection: "row", gap: 8, marginBottom: 8 },
  stopRow:          { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#e2e8f0", gap: 8 },
  dragHandle:       { paddingHorizontal: 8, paddingVertical: 10, justifyContent: "center", alignItems: "center" },
  orderBanner:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef3c7", paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#fde68a", borderBottomWidth: 1, borderBottomColor: "#fde68a" },
  orderBannerTxt:   { flex: 1, fontSize: 12, fontWeight: "600", color: "#92400e" },
  orderSaveBtn:     { backgroundColor: "#d97706", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  orderSaveBtnTxt:  { color: "#fff", fontSize: 12, fontWeight: "800" },
  stopNum:          { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stopNumTxt:       { color: "#fff", fontSize: 12, fontWeight: "800" },
  stopName:         { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  stopMeta:         { fontSize: 11, color: "#64748b", marginTop: 1 },

  // Student avatar
  studentAvatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center" },
  studentAvatarTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },
  payBtn:           { backgroundColor: "#0f766e", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  payBtnTxt:        { color: "#fff", fontSize: 11, fontWeight: "800" },
  // Pay button
  payBtn:           { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#0f766e", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  payBtnTxt:        { color: "#fff", fontSize: 11, fontWeight: "800" },

  // Date picker
  iosPickerWrap:    { backgroundColor: "#f8fafc", borderRadius: 12, marginTop: 8, overflow: "hidden", borderWidth: 1, borderColor: "#e2e8f0" },
  iosPickerHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  iosPickerLabel:   { fontSize: 13, fontWeight: "700", color: "#0f172a" },

  // Dropdown in assignment modal
  ddOpt:            { paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  ddOptTxt:         { fontSize: 13, color: "#0f172a" },
});