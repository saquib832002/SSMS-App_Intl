import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  memo,
} from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  Modal} from "react-native";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  createFeeItem,
  fetchFeeItems,
  updateFeeItem,
  deactivateFeeItem,
  deleteFeeItem,
} from "../../services/FeeServiceApi";

// const FEE_TYPE_OPTIONS = ["One Time", "Monthly", "Quarterly", "Yearly"];
const FEE_TYPE_OPTIONS = ["One Time", "Monthly"];
const CATEGORY_OPTIONS = ["Academic", "Transport", "Hostel", "Misc"];

const initialFormState = {
  feeName: "",
  feeCode: "",
  feeType: "",
  category: "",
  isMandatory: "Yes",
  status: "Active",
  taxPercent: "0",
  taxInclusive: "No",
};

const FeeItemForm = memo(function FeeItemForm({
  initialValues,
  editingId,
  saving,
  onSave,
  onCancel,
}) {
  const [form, setForm] = useState(initialValues);

  useEffect(() => {
    setForm(initialValues);
  }, [initialValues]);

  const handleChange = useCallback((field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const validate = useCallback(() => {
    if (!form.feeName.trim()) return "Fee item name is required";
    if (!form.feeCode.trim()) return "Fee code is required";
    if (!form.feeType) return "Fee type is required";
    if (!form.category) return "Category is required";
    return null;
  }, [form]);

  const handleSubmit = useCallback(() => {
    const error = validate();
    if (error) {
      Alert.alert("Validation", error);
      return;
    }
    const taxPct = parseFloat(form.taxPercent) || 0;
    if (taxPct < 0 || taxPct > 100) {
      Alert.alert("Validation", "Tax percent must be between 0 and 100");
      return;
    }
    onSave({
      ...form,
      tax_percent:   taxPct,
      tax_inclusive: form.taxInclusive === "Yes" ? 1 : 0,
    });
  }, [form, onSave, validate]);

  return (
    <View style={styles.formCard}>
      <Text style={styles.sectionTitle}>
        {editingId ? "Edit Fee Item" : "Add Fee Item"}
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Fee Item Name"
        value={form.feeName}
        onChangeText={(v) => handleChange("feeName", v)}
      />

      <TextInput
        style={styles.input}
        placeholder="Fee Code"
        value={form.feeCode}
        onChangeText={(v) => handleChange("feeCode", v)}
      />

                <Dropdown
            label="Select Fee Type"
            value={form.feeType}
            options={[
              { label: "Select Fee Type", value: "" },
              ...FEE_TYPE_OPTIONS.map(item => ({ label: item, value: item }))
            ]}
            onChange={(v) => handleChange("feeType", v)}
            disabled={saving}
          />

                <Dropdown
            label="Select Category"
            value={form.category}
            options={[
              { label: "Select Category", value: "" },
              ...CATEGORY_OPTIONS.map(item => ({ label: item, value: item }))
            ]}
            onChange={(v) => handleChange("category", v)}
            disabled={saving}
          />

                <Dropdown
            label="Select"
            value={form.isMandatory}
            options={[
              { label: "Mandatory", value: "Yes" },
              { label: "Optional", value: "No" }
            ]}
            onChange={(v) => handleChange("isMandatory", v)}
            disabled={saving}
          />

      <Text style={styles.fieldLabel}>Tax Rate (%)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 18 for GST 18% (0 = no tax)"
        value={form.taxPercent}
        onChangeText={(v) => handleChange("taxPercent", v)}
        keyboardType="decimal-pad"
      />

      <Dropdown
        label="Tax Type"
        value={form.taxInclusive}
        options={[
          { label: "Exclusive (tax added on top)", value: "No" },
          { label: "Inclusive (tax inside fee amount)", value: "Yes" },
        ]}
        onChange={(v) => handleChange("taxInclusive", v)}
        disabled={saving}
      />

      <TouchableOpacity
        style={[styles.primaryBtn, saving && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>
            {editingId ? "Update Fee Item" : "Save Fee Item"}
          </Text>
        )}
      </TouchableOpacity>

      {editingId ? (
        <TouchableOpacity style={styles.secondaryBtn} onPress={onCancel}>
          <Text style={styles.secondaryBtnText}>Cancel Edit</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

const FeeItemCard = memo(function FeeItemCard({
  item,
  isAdmin,
  onEdit,
  onDeactivate,
  onDelete,
}) {
  const feeName = item.fee_item_name || item.feeName;
  const feeCode = item.fee_code || item.feeCode;
  const feeType = item.fee_type || item.feeType;
  const isMandatory = item.is_mandatory || item.isMandatory;
  const status = item.status || "Active";

  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>{feeName}</Text>
          <Text style={styles.itemSubText}>Code: {feeCode}</Text>
        </View>

        <View
          style={[
            styles.badge,
            status === "Active" ? styles.activeBadge : styles.inactiveBadge,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              status === "Active" ? styles.activeText : styles.inactiveText,
            ]}
          >
            {status}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Type: {feeType}</Text>
        <Text style={styles.metaText}>Category: {item.category}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Mandatory: {isMandatory}</Text>
        {parseFloat(item.tax_percent ?? 0) > 0 && (
          <Text style={[styles.metaText, { color: "#0f4c81", fontWeight: "700" }]}>
            Tax: {item.tax_percent}%{item.tax_inclusive == 1 ? " (incl.)" : ""}
          </Text>
        )}
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onEdit(item)}
        >
          <Feather name="edit-2" size={14} color="#1e40af" />
          <Text style={[styles.actionBtnText, { color: "#1e40af" }]}>Edit</Text>
        </TouchableOpacity>

        {isAdmin ? (
          <>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onDeactivate(item)}
            >
              <Feather name="slash" size={14} color="#d97706" />
              <Text style={[styles.actionBtnText, { color: "#d97706" }]}>
                Deactivate
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onDelete(item)}
            >
              <Feather name="trash-2" size={14} color="#dc2626" />
              <Text style={[styles.actionBtnText, { color: "#dc2626" }]}>
                Delete
              </Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </View>
  );
});


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
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#1e40af" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f8fafc" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
const _ddSt = StyleSheet.create({
  trigger:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 12 },
  disabled:        { opacity: 0.45 },
  triggerTxt:      { flex: 1, fontSize: 14, color: "#0f172a", fontWeight: "500" },
  placeholder:     { color: "#94a3b8" },
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:           { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  sheetTitle:      { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:    { backgroundColor: "#eff6ff" },
  optionTxt:       { fontSize: 14, color: "#0f172a" },
  optionTxtActive: { color: "#1e40af", fontWeight: "700" },
});

export default function FeeItemScreen() {
  const { user } = useContext(AuthContext);
  const isAdmin = user?.ssmsUserRole === "admin" || user?.role === "admin";

  const [feeItems, setFeeItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formSeed, setFormSeed] = useState(initialFormState);

  const loadFeeItems = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const items = await fetchFeeItems(user);
      setFeeItems(Array.isArray(items) ? items : []);
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to load fee items");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadFeeItems();
    }
  }, [user, loadFeeItems]);

  const handleEdit = useCallback((item) => {
    setEditingId(item.fee_item_id || item.id || null);
    setFormSeed({
      feeName: item.fee_item_name || item.feeName || "",
      feeCode: item.fee_code || item.feeCode || "",
      feeType: item.fee_type || item.feeType || "",
      category: item.category || "",
      isMandatory: item.is_mandatory || item.isMandatory || "Yes",
      status: item.status || "Active",
      taxPercent: String(item.tax_percent ?? "0"),
      taxInclusive: (item.tax_inclusive == 1 || item.tax_inclusive === "Yes") ? "Yes" : "No",
    });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setFormSeed(initialFormState);
  }, []);

  const handleSave = useCallback(
    async (form) => {
      try {
        setSaving(true);

        if (editingId) {
          await updateFeeItem(user, editingId, form);
          Alert.alert("Success", "Fee item updated successfully");
        } else {
          await createFeeItem(user, form);
          Alert.alert("Success", "Fee item added successfully");
        }

        setEditingId(null);
        setFormSeed(initialFormState);
        await loadFeeItems();
      } catch (error) {
        Alert.alert("Error", error.message || "Failed to save fee item");
      } finally {
        setSaving(false);
      }
    },
    [editingId, loadFeeItems, user]
  );

  const handleDeactivate = useCallback(
    (item) => {
      if (!isAdmin) return;

      Alert.alert(
        "Deactivate Fee Item",
        `Do you want to deactivate "${item.fee_item_name || item.feeName}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Deactivate",
            style: "destructive",
            onPress: async () => {
              try {
                await deactivateFeeItem(user, item.fee_item_id || item.id);
                Alert.alert("Success", "Fee item deactivated successfully");
                await loadFeeItems();
              } catch (error) {
                Alert.alert("Error", error.message || "Failed to deactivate fee item");
              }
            },
          },
        ]
      );
    },
    [isAdmin, loadFeeItems, user]
  );

  const handleDelete = useCallback(
    (item) => {
      if (!isAdmin) return;

      Alert.alert(
        "Delete Fee Item",
        `Do you want to permanently delete "${item.fee_item_name || item.feeName}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteFeeItem(user, item.fee_item_id || item.id);
                Alert.alert("Success", "Fee item deleted successfully");
                await loadFeeItems();
              } catch (error) {
                Alert.alert("Error", error.message || "Failed to delete fee item");
              }
            },
          },
        ]
      );
    },
    [isAdmin, loadFeeItems, user]
  );

  const renderItem = useCallback(
    ({ item }) => (
      <FeeItemCard
        item={item}
        isAdmin={isAdmin}
        onEdit={handleEdit}
        onDeactivate={handleDeactivate}
        onDelete={handleDelete}
      />
    ),
    [handleDeactivate, handleDelete, handleEdit, isAdmin]
  );

  const keyExtractor = useCallback(
    (item, index) => String(item.fee_item_id ?? item.id ?? `fee-item-${index}`),
    []
  );

  const sortedFeeItems = useMemo(() => feeItems, [feeItems]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.screenTitle}>Fee Item Master</Text>
        <Text style={styles.screenSubtitle}>
          Add and manage fee items like tuition, admission, exam, transport, and more.
        </Text>

        <FeeItemForm
          initialValues={formSeed}
          editingId={editingId}
          saving={saving}
          onSave={handleSave}
          onCancel={handleCancelEdit}
        />

        <Text style={[styles.sectionTitle, { marginTop: 18 }]}>
          Existing Fee Items
        </Text>

        {loading ? (
          <View style={styles.loaderBox}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={styles.loaderText}>Loading fee items...</Text>
          </View>
        ) : (
          <FlatList
            data={sortedFeeItems}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            scrollEnabled={false}
            removeClippedSubviews
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={5}
            contentContainerStyle={{ paddingBottom: 20 }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No fee items found</Text>
            }
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  screenTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#7d5493",
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  screenSubtitle: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 20,
    marginBottom: 16,
  },
  formCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1e40af",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 6,
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
    marginBottom: 12,
  },
  dropdown: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    backgroundColor: "#fff",
    marginBottom: 12,
    overflow: "hidden",
  },
  primaryBtn: {
    backgroundColor: "#1e40af",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  secondaryBtn: {
    backgroundColor: "#e2e8f0",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryBtnText: {
    color: "#0f172a",
    fontWeight: "700",
  },
  itemCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  itemSubText: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  metaText: {
    fontSize: 13,
    color: "#475569",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  activeBadge: {
    backgroundColor: "#dcfce7",
  },
  inactiveBadge: {
    backgroundColor: "#fee2e2",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  activeText: {
    color: "#15803d",
  },
  inactiveText: {
    color: "#b91c1c",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 14,
    marginBottom: 6,
  },
  actionBtnText: {
    marginLeft: 6,
    fontWeight: "700",
  },
  loaderBox: {
    paddingVertical: 30,
    alignItems: "center",
  },
  loaderText: {
    marginTop: 10,
    color: "#64748b",
  },
  emptyText: {
    color: "#64748b",
    textAlign: "center",
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});