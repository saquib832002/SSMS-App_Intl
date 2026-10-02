/**
 * screens/MyFeeScreen.js
 *
 * Student / Parent portal — read-only view of fee due and payment history.
 * Reuses the existing fetchStudentFeeData API; no payment actions shown.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import { fetchStudentFeeData } from '../../services/FeeServiceApi';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = (v) => isNaN(parseFloat(v)) ? '0.00' : parseFloat(v).toFixed(2);
const fmtCurr = (v) => `₹ ${fmt(v)}`;
const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, label, color, bg, count }) {
  return (
    <View style={[sh.wrap, { backgroundColor: bg }]}>
      <View style={[sh.iconWrap, { backgroundColor: color + '22' }]}>
        <MaterialIcons name={icon} size={18} color={color} />
      </View>
      <Text style={[sh.label, { color }]}>{label}</Text>
      {count != null && (
        <View style={[sh.badge, { backgroundColor: color }]}>
          <Text style={sh.badgeTxt}>{count}</Text>
        </View>
      )}
    </View>
  );
}
const sh = StyleSheet.create({
  wrap:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, marginBottom: 2 },
  iconWrap:{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label:   { flex: 1, fontSize: 14, fontWeight: '800' },
  badge:   { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  badgeTxt:{ fontSize: 11, fontWeight: '900', color: '#fff' },
});

// Month name from month_no (1-12)
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthName = (n) => MONTHS[(parseInt(n, 10) - 1)] ?? `M${n}`;

// ── Fee due row ───────────────────────────────────────────────────────────────
function FeeRow({ item }) {
  const base     = parseFloat(item.fee_amount      ?? 0);
  const discPct  = parseFloat(item.discount_percent ?? 0);
  const rawDisc  = parseFloat(item.discount_amount  ?? 0);
  // If discount_amount is 0 but discount_percent is set, compute from base
  const discount = rawDisc > 0 ? rawDisc : (discPct > 0 ? base * discPct / 100 : 0);
  const taxPct   = parseFloat(item.tax_percent     ?? 0);
  const rawTax   = parseFloat(item.tax_amount      ?? 0);
  const tax      = rawTax > 0 ? rawTax : (taxPct > 0 ? (base - discount) * taxPct / 100 : 0);
  const balance  = parseFloat(item.balance_due     ?? item.net_fee_amount ?? base);

  const hasDiscount = discount > 0 || discPct > 0;
  const hasTax      = tax > 0 || taxPct > 0;

  return (
    <View style={fr.row}>
      {/* Left: name + meta */}
      <View style={{ flex: 1, marginRight: 10 }}>
        <Text style={fr.name}>{item.fee_item_name ?? 'Fee'}</Text>

        {/* Month + Session */}
        <View style={fr.metaRow}>
          {item.month_no ? (
            <View style={fr.tag}>
              <Text style={fr.tagTxt}>{item.month_no}</Text>
            </View>
          ) : null}
          {item.session_name ? (
            <Text style={fr.metaTxt}>{item.session_name}</Text>
          ) : null}
          {item.due_date ? (
            <Text style={fr.metaTxt}>Due: {fmtDate(item.due_date)}</Text>
          ) : null}
        </View>

        {/* Breakdown: base → discount → tax */}
        <View style={fr.breakdown}>
          <Text style={fr.breakdownTxt}>Base: {fmtCurr(base)}</Text>
          {hasDiscount && (
            <Text style={fr.discountTxt}>
              − Discount{discPct > 0 ? ` (${discPct}%)` : ''}: {fmtCurr(discount)}
            </Text>
          )}
          {hasTax && (
            <Text style={fr.taxTxt}>
              + Tax{taxPct > 0 ? ` (${taxPct}%)` : ''}: {fmtCurr(tax)}
            </Text>
          )}
        </View>
      </View>

      {/* Right: balance due */}
      <View style={fr.amountCol}>
        <Text style={fr.balanceLabel}>Balance</Text>
        <Text style={fr.balanceAmount}>{fmtCurr(balance)}</Text>
      </View>
    </View>
  );
}
const fr = StyleSheet.create({
  row:           { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', alignItems: 'flex-start' },
  name:          { fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  metaRow:       { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4 },
  tag:           { backgroundColor: '#eff6ff', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  tagTxt:        { fontSize: 10, fontWeight: '700', color: '#1e40af' },
  metaTxt:       { fontSize: 10, color: '#94a3b8', fontWeight: '500' },
  breakdown:     { gap: 1 },
  breakdownTxt:  { fontSize: 11, color: '#64748b' },
  discountTxt:   { fontSize: 11, color: '#15803d', fontWeight: '600' },
  taxTxt:        { fontSize: 11, color: '#b45309', fontWeight: '600' },
  amountCol:     { alignItems: 'flex-end', minWidth: 72 },
  balanceLabel:  { fontSize: 9, color: '#94a3b8', fontWeight: '600', marginBottom: 2 },
  balanceAmount: { fontSize: 15, fontWeight: '900', color: '#dc2626' },
});

// ── Payment history row ───────────────────────────────────────────────────────
function PaymentRow({ item, idx }) {
  // Backend returns receipt objects with total_paid (grouped by receipt_number)
  const paid = parseFloat(item.total_paid ?? item.paid_amount ?? item.amount_paid ?? 0);
  const title = item.receipt_number
    ? `Receipt #${item.receipt_number}`
    : (item.fee_item_name ?? item.fee_name ?? 'Payment');
  const payMode = item.payment_method ?? item.payment_mode ?? null;
  const itemCount = Array.isArray(item.items) ? item.items.length : null;
  return (
    <View style={[pr.row, idx % 2 === 1 && pr.rowAlt]}>
      <View style={pr.iconWrap}>
        <MaterialIcons name="check-circle" size={18} color="#15803d" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={pr.name}>{title}</Text>
        <Text style={pr.date}>{fmtDate(item.fee_paid_date ?? item.paid_date ?? item.payment_date ?? item.created)}</Text>
        {payMode ? <Text style={pr.mode}>{payMode}{itemCount ? ` · ${itemCount} item${itemCount > 1 ? 's' : ''}` : ''}</Text> : null}
      </View>
      <Text style={pr.amount}>{fmtCurr(paid)}</Text>
    </View>
  );
}
const pr = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowAlt:  { backgroundColor: '#fafafa' },
  iconWrap:{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center' },
  name:    { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  date:    { fontSize: 11, color: '#64748b', marginTop: 1 },
  mode:    { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  amount:  { fontSize: 14, fontWeight: '800', color: '#15803d' },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function MyFeeScreen({ navigation }) {
  const { user, activeEnrollmentId } = useContext(AuthContext);
  // For parents viewing a child's portal, use the selected child's enrollment ID.
  // For students, fall back to their own enrollmentId then ssmsUserName.
  const enrollmentId  = activeEnrollmentId ?? user?.enrollmentId ?? user?.ssmsUserName ?? "";
  // useMemo prevents a new object on every render — without it effectiveUser changes
  // every render, rebuilds the useCallback, and triggers an infinite fetch loop.
  const effectiveUser = useMemo(
    () => activeEnrollmentId ? { ...user, enrollmentId: activeEnrollmentId } : user,
    [user, activeEnrollmentId]
  );

  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!user || !enrollmentId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchStudentFeeData(enrollmentId, {}, effectiveUser);
      setData(res);
    } catch (e) {
      setError(e.message ?? 'Failed to load fee data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enrollmentId, effectiveUser, user]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  // ── Derived totals ─────────────────────────────────────────────────────────
  const dueItems  = data?.due  ?? [];
  const paidItems = data?.paid ?? [];

  const totalDue  = dueItems.reduce((sum, i) =>
    sum + parseFloat(i.balance_due ?? i.net_fee_amount ?? i.fee_amount ?? 0), 0);
  const totalPaid = paidItems.reduce((sum, i) =>
    sum + parseFloat(i.total_paid ?? i.paid_amount ?? i.amount_paid ?? 0), 0);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color="#1e40af" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>My Fee</Text>
          <Text style={s.headerSub}>Due & payment history</Text>
        </View>
        <TouchableOpacity onPress={() => load()} style={s.refreshBtn}>
          <Feather name="refresh-cw" size={16} color="#1e40af" />
        </TouchableOpacity>
      </View>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={s.centred}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={s.loadingTxt}>Loading fee details…</Text>
        </View>
      ) : error ? (
        <View style={s.centred}>
          <MaterialIcons name="error-outline" size={48} color="#fca5a5" />
          <Text style={s.errorTitle}>Could not load data</Text>
          <Text style={s.errorSub}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => load()}>
            <Text style={s.retryTxt}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
              colors={['#1e40af']} tintColor="#1e40af" />
          }
        >
          {/* ── Summary banner ────────────────────────────────────────── */}
          <View style={s.banner}>
            <View style={s.bannerSide}>
              <Text style={s.bannerSubLabel}>Total Due</Text>
              <Text style={[s.bannerAmount, { color: totalDue > 0 ? '#dc2626' : '#15803d' }]}>
                {fmtCurr(totalDue)}
              </Text>
            </View>
            <View style={s.bannerDivider} />
            <View style={s.bannerSide}>
              <Text style={s.bannerSubLabel}>Total Paid</Text>
              <Text style={[s.bannerAmount, { color: '#15803d' }]}>
                {fmtCurr(totalPaid)}
              </Text>
            </View>
          </View>

          {/* ── Due fees ──────────────────────────────────────────────── */}
          <View style={s.card}>
            <SectionHeader
              icon="receipt-long" label="Fee Due"
              color="#dc2626" bg="#fff5f5"
              count={dueItems.length || null}
            />
            {dueItems.length === 0 ? (
              <View style={s.emptyBox}>
                <MaterialIcons name="check-circle" size={36} color="#86efac" />
                <Text style={s.emptyTxt}>No outstanding fees — you're all clear!</Text>
              </View>
            ) : (
              <>
                {dueItems.map((item, i) => (
                  <FeeRow key={i} item={item} />
                ))}
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Due</Text>
                  <Text style={[s.totalAmount, { color: '#dc2626' }]}>{fmtCurr(totalDue)}</Text>
                </View>
              </>
            )}
          </View>

          {/* ── Payment history ───────────────────────────────────────── */}
          <View style={s.card}>
            <SectionHeader
              icon="history" label="Payment History"
              color="#15803d" bg="#f0fdf4"
              count={paidItems.length || null}
            />
            {paidItems.length === 0 ? (
              <View style={s.emptyBox}>
                <MaterialIcons name="hourglass-empty" size={36} color="#cbd5e1" />
                <Text style={s.emptyTxt}>No payment records found yet.</Text>
              </View>
            ) : (
              <>
                {paidItems.map((item, i) => (
                  <PaymentRow key={i} item={item} idx={i} />
                ))}
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Paid</Text>
                  <Text style={[s.totalAmount, { color: '#15803d' }]}>{fmtCurr(totalPaid)}</Text>
                </View>
              </>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
    shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  backBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  headerSub:   { fontSize: 11, color: '#64748b', marginTop: 1 },

  scroll: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 20 },

  // Loading / error
  centred:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingTxt: { marginTop: 14, color: '#64748b', fontSize: 14 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#374151', marginTop: 12 },
  errorSub:   { fontSize: 13, color: '#94a3b8', marginTop: 6, textAlign: 'center' },
  retryBtn:   { marginTop: 18, backgroundColor: '#1e40af', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt:   { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Banner
  banner: {
    flexDirection: 'row', backgroundColor: '#1e40af', borderRadius: 16,
    padding: 18, marginBottom: 14, alignItems: 'center',
  },
  bannerSide:      { flex: 1, alignItems: 'center' },
  bannerDivider:   { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 12 },
  bannerSubLabel:  { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '600', marginBottom: 4 },
  bannerAmount:    { fontSize: 22, fontWeight: '900' },

  // Cards
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#e2e8f0',
    shadowColor: '#0f172a', shadowOpacity: 0.04,
    shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },

  // Total row
  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 4, borderTopWidth: 1.5, borderTopColor: '#e2e8f0' },
  totalLabel: { fontSize: 13, fontWeight: '800', color: '#374151' },
  totalAmount:{ fontSize: 16, fontWeight: '900' },

  // Empty state
  emptyBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyTxt: { fontSize: 13, color: '#94a3b8', textAlign: 'center', fontWeight: '500' },
});
