import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchDueFees, collectStudentFee } from "../../services/FeeServiceApi";

export default function FeeCollectionScreen({ route, navigation }) {
  const { user } = useContext(AuthContext);
  const { enrollmentId, registrationNo, studentName } = route.params || {};

  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedFees, setSelectedFees] = useState([]);
  const [lateFee, setLateFee] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [paymentMode, setPaymentMode] = useState("Cash");

  const loadFees = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const response = await fetchDueFees(enrollmentId, user);
      const dueFees = Array.isArray(response)
        ? response
        : response?.data || [];

      setFees(dueFees);
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to load due fees");
    } finally {
      setLoading(false);
    }
  }, [enrollmentId, user]);

  useEffect(() => {
    loadFees();
  }, [loadFees]);

  const toggleFeeSelection = (feeId) => {
    setSelectedFees((prev) => {
      if (prev.includes(feeId)) {
        return prev.filter((id) => id !== feeId);
      }
      return [...prev, feeId];
    });
  };

  const selectedFeeRows = useMemo(() => {
    return fees.filter((item) => selectedFees.includes(item.fee_paid_id));
  }, [fees, selectedFees]);

  const totalAmount = useMemo(() => {
    return selectedFeeRows.reduce(
      (sum, item) => sum + Number(item.balance_amount || 0),
      0
    );
  }, [selectedFeeRows]);

  const grandTotal = useMemo(() => {
    return (
      totalAmount +
      Number(lateFee || 0) -
      Number(discount || 0)
    );
  }, [totalAmount, lateFee, discount]);

  const handleCollectPayment = async () => {
    if (selectedFees.length === 0) {
      Alert.alert("Validation", "Please select at least one fee item");
      return;
    }

    try {
      setSaving(true);

      await collectStudentFee(
        {
          enrollmentId,
          feeIds: selectedFees,
          lateFee,
          discount,
          paymentMode,
          totalAmount: grandTotal,
        },
        user
      );

      Alert.alert("Success", "Fee collected successfully", [
        {
          text: "OK",
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to collect fee");
    } finally {
      setSaving(false);
    }
  };

  const renderFeeCard = ({ item }) => {
    const isSelected = selectedFees.includes(item.fee_paid_id);

    return (
      <TouchableOpacity
        style={[
          styles.feeCard,
          isSelected && styles.selectedCard,
        ]}
        onPress={() => toggleFeeSelection(item.fee_paid_id)}
      >
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.feeName}>{item.fee_item_name}</Text>
            <Text style={styles.feeMeta}>
              {item.month_no || "One Time"} • Due: {item.due_date}
            </Text>
          </View>

          <View
            style={[
              styles.checkbox,
              isSelected && styles.checkboxSelected,
            ]}
          >
            {isSelected && (
              <MaterialIcons name="check" size={16} color="#fff" />
            )}
          </View>
        </View>

        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>Balance Amount</Text>
          <Text style={styles.amountValue}>₹ {item.balance_amount}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loaderText}>Loading due fees...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={fees}
        keyExtractor={(item, index) =>
          `${item.fee_paid_id || item.fee_id}-${index}`
        }
        renderItem={renderFeeCard}
        ListHeaderComponent={
          <>
            <View style={styles.studentCard}>
              <Text style={styles.studentName}>{studentName}</Text>
              <Text style={styles.studentMeta}>
                Registration No: {registrationNo}
              </Text>
              <Text style={styles.studentMeta}>
                Enrollment ID: {enrollmentId}
              </Text>
            </View>

            <Text style={styles.sectionTitle}>Due Fee Items</Text>
          </>
        }
        ListFooterComponent={
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Payment Summary</Text>

            <TextInput
              style={styles.input}
              placeholder="Late Fee"
              keyboardType="numeric"
              value={lateFee}
              onChangeText={setLateFee}
            />

            <TextInput
              style={styles.input}
              placeholder="Discount"
              keyboardType="numeric"
              value={discount}
              onChangeText={setDiscount}
            />

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Selected Fees</Text>
              <Text style={styles.totalValue}>₹ {totalAmount}</Text>
            </View>

            <View style={styles.totalRow}>
              <Text style={styles.grandLabel}>Grand Total</Text>
              <Text style={styles.grandValue}>₹ {grandTotal}</Text>
            </View>

            <TouchableOpacity
              style={styles.collectButton}
              onPress={handleCollectPayment}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.collectButtonText}>Collect Payment</Text>
              )}
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f1f5f9",
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loaderText: {
    marginTop: 10,
    color: "#64748b",
  },
  studentCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    elevation: 4,
  },
  studentName: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
  },
  studentMeta: {
    color: "#64748b",
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  feeCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  selectedCard: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  feeName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  feeMeta: {
    color: "#64748b",
    marginTop: 4,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxSelected: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  amountRow: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  amountLabel: {
    color: "#64748b",
  },
  amountValue: {
    color: "#dc2626",
    fontWeight: "700",
  },
  summaryCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 18,
    marginTop: 10,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  totalLabel: {
    color: "#64748b",
  },
  totalValue: {
    color: "#0f172a",
    fontWeight: "700",
  },
  grandLabel: {
    fontSize: 18,
    fontWeight: "700",
  },
  grandValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#16a34a",
  },
  collectButton: {
    backgroundColor: "#16a34a",
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 20,
  },
  collectButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
});
