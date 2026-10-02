/**
 * screens/Exams/TestManageScreen.js
 * Admin: Lists all tests within a series.
 * Route params: { series }
 * Navigates to TestCreate (create/edit), TestQuestionPicker (add questions),
 * TestAnalysis (batch report), TestLeaderboard.
 */
import React, { useState, useContext, useCallback } from "react";
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getTestsBySeriesId, deleteTest, publishTest,
} from "../../services/TestSeriesServiceApi";

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE = {
  draft:     { bg: "#fef3c7", text: "#92400e" },
  published: { bg: "#dcfce7", text: "#166534" },
  closed:    { bg: "#f1f5f9", text: "#64748b" },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return (
    <View style={[badge.wrap, { backgroundColor: s.bg }]}>
      <Text style={[badge.txt, { color: s.text }]}>{status?.toUpperCase()}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  txt:  { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
});

// ─── Test card ─────────────────────────────────────────────────────────────────

function TestCard({ test, series, navigation, onRefresh, user }) {
  const [busy, setBusy] = useState(false);

  const handlePublish = async () => {
    Alert.alert(
      "Publish Test",
      `Publish "${test.title}"? Students will be able to see and attempt it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Publish",
          onPress: async () => {
            setBusy(true);
            try {
              await publishTest(user, test.id);
              onRefresh();
            } catch {
              Alert.alert("Error", "Failed to publish test");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Test",
      `Delete "${test.title}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await deleteTest(user, test.id);
              onRefresh();
            } catch {
              Alert.alert("Error", "Failed to delete test");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={card.wrap}>
      {/* Header row */}
      <View style={card.head}>
        <View style={{ flex: 1 }}>
          <Text style={card.title} numberOfLines={2}>{test.title}</Text>
          <Text style={card.meta}>
            {test.duration_minutes} min · {test.total_marks} marks · {test.question_count ?? 0} Qs
          </Text>
        </View>
        <StatusBadge status={test.status} />
      </View>

      {/* Action row */}
      <View style={card.actions}>
        {/* Edit */}
        <TouchableOpacity
          style={[card.btn, { backgroundColor: "#e0f2fe" }]}
          onPress={() => navigation.navigate("TestCreate", { series, test })}
          disabled={busy}
        >
          <Feather name="edit-2" size={14} color="#0369a1" />
          <Text style={[card.btnTxt, { color: "#0369a1" }]}>Edit</Text>
        </TouchableOpacity>

        {/* Add Questions */}
        <TouchableOpacity
          style={[card.btn, { backgroundColor: "#f3e8ff" }]}
          onPress={() => navigation.navigate("TestQuestionPicker", { series, test })}
          disabled={busy}
        >
          <Feather name="plus-circle" size={14} color="#7c3aed" />
          <Text style={[card.btnTxt, { color: "#7c3aed" }]}>Questions</Text>
        </TouchableOpacity>

        {/* Publish (only for drafts) */}
        {test.status === "draft" && (
          <TouchableOpacity
            style={[card.btn, { backgroundColor: "#dcfce7" }]}
            onPress={handlePublish}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator size="small" color="#166534" />
              : <Feather name="send" size={14} color="#166534" />}
            <Text style={[card.btnTxt, { color: "#166534" }]}>Publish</Text>
          </TouchableOpacity>
        )}

        {/* Results (published/closed only) */}
        {test.status !== "draft" && (
          <TouchableOpacity
            style={[card.btn, { backgroundColor: "#fef9c3" }]}
            onPress={() => navigation.navigate("TestAnalysis", { test })}
            disabled={busy}
          >
            <Feather name="bar-chart-2" size={14} color="#a16207" />
            <Text style={[card.btnTxt, { color: "#a16207" }]}>Results</Text>
          </TouchableOpacity>
        )}

        {/* Leaderboard */}
        {test.status !== "draft" && (
          <TouchableOpacity
            style={[card.btn, { backgroundColor: "#fce7f3" }]}
            onPress={() => navigation.navigate("TestLeaderboard", { test })}
            disabled={busy}
          >
            <Feather name="award" size={14} color="#9d174d" />
            <Text style={[card.btnTxt, { color: "#9d174d" }]}>Leaderboard</Text>
          </TouchableOpacity>
        )}

        {/* Delete */}
        <TouchableOpacity
          style={[card.btn, { backgroundColor: "#fee2e2" }]}
          onPress={handleDelete}
          disabled={busy}
        >
          <Feather name="trash-2" size={14} color="#dc2626" />
          <Text style={[card.btnTxt, { color: "#dc2626" }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  wrap: {
    backgroundColor: "#fff",
    borderRadius: 14,
    marginHorizontal: 14,
    marginBottom: 12,
    padding: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  head:    { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  title:   { fontSize: 15, fontWeight: "700", color: "#1e293b", lineHeight: 20 },
  meta:    { fontSize: 12, color: "#64748b", marginTop: 3 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  btnTxt: { fontSize: 12, fontWeight: "600" },
});

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onAdd }) {
  return (
    <View style={em.wrap}>
      <Feather name="file-text" size={48} color="#cbd5e1" />
      <Text style={em.title}>No tests yet</Text>
      <Text style={em.sub}>Tap the + button to create the first test in this series.</Text>
      <TouchableOpacity style={em.btn} onPress={onAdd}>
        <Feather name="plus" size={16} color="#fff" />
        <Text style={em.btnTxt}>Create Test</Text>
      </TouchableOpacity>
    </View>
  );
}

const em = StyleSheet.create({
  wrap:   { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  title:  { fontSize: 18, fontWeight: "700", color: "#1e293b", marginTop: 16 },
  sub:    { fontSize: 14, color: "#64748b", textAlign: "center", marginTop: 8, lineHeight: 20 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#7c3aed",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 24,
  },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
});

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function TestManageScreen({ route, navigation }) {
  const { series } = route.params;
  const { user }   = useContext(AuthContext);

  const [tests,    setTests]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await getTestsBySeriesId(user, series.id);
      setTests(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
    } catch (e) {
      Alert.alert("Error", "Failed to load tests");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [series.id, user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Header with + button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: series.title,
      headerRight: () => (
        <TouchableOpacity
          style={{ marginRight: 14 }}
          onPress={() => navigation.navigate("TestCreate", { series, test: null })}
        >
          <Feather name="plus" size={24} color="#7c3aed" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, series]);

  if (loading) {
    return (
      <View style={sc.center}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <View style={sc.root}>
      {/* Series info strip */}
      <View style={sc.strip}>
        <View style={{ flex: 1 }}>
          <Text style={sc.stripLabel}>
            {series.exam_type?.toUpperCase()} · {tests.length} test{tests.length !== 1 ? "s" : ""}
          </Text>
        </View>
        <TouchableOpacity
          style={sc.addBtn}
          onPress={() => navigation.navigate("TestCreate", { series, test: null })}
        >
          <Feather name="plus" size={16} color="#fff" />
          <Text style={sc.addBtnTxt}>New Test</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={tests}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={tests.length === 0 ? { flex: 1 } : { paddingTop: 12, paddingBottom: 30 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={["#7c3aed"]} />
        }
        ListEmptyComponent={
          <EmptyState onAdd={() => navigation.navigate("TestCreate", { series, test: null })} />
        }
        renderItem={({ item }) => (
          <TestCard
            test={item}
            series={series}
            navigation={navigation}
            onRefresh={() => load(true)}
            user={user}
          />
        )}
      />
    </View>
  );
}

const sc = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  strip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    gap: 10,
  },
  stripLabel: { fontSize: 13, color: "#64748b", fontWeight: "600" },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#7c3aed",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
  },
  addBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
