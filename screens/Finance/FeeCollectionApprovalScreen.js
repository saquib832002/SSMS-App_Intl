/**
 * FeeCollectionApprovalScreen.js
 *
 * Admin / Owner screen to:
 *   1. View all pending fee receipts collected by staff (admin_review = Pending / Under Review)
 *   2. Approve individual receipts or all at once
 *   3. On approval → update ssms_fee_paid_details (admin_review = Complete, admin_user, admin_review_date)
 *                  → insert income entry into ssms_balancesheet
 *
 * Navigate to this screen via:
 *   navigation.navigate('FeeCollectionApproval')
 *
 * Routes to add in config/routes.php:
 *   $builder->get('/FeeApi/getPendingCollections',  ['controller'=>'FeeApi','action'=>'getPendingCollections']);
 *   $builder->post('/FeeApi/approveCollections',    ['controller'=>'FeeApi','action'=>'approveCollections']);
 */

import React, {
  useCallback, useContext, useMemo, useState,
} from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import { BASE_URL } from "../../Environment/EnvironmentConfig";

// ─── API ──────────────────────────────────────────────────────────────────────
//const BASE_URL = 'http://192.168.4.90/ssms5/';

const buildHeaders = (user) => ({
  'Content-Type': 'application/json',
  Accept:          'application/json',
  ssmsUserName:    user?.ssmsUserName   ?? '',
  ssmsUserRole:    user?.ssmsUserRole   ?? user?.role ?? '',
  ssmsClientCode:  user?.ssmsClientCode ?? '',
  Authorization:   user?.token ? `Bearer ${user.token}` : '',
});

const fetchPendingCollections = async (user, filters = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== ''))
  ).toString();
  //console.log("Fetching pending collections with filters:", filters, "and user:", user.token);
  const res  = await fetch(`${BASE_URL}/FeeApi/getPendingCollections`, {
    method: 'GET', headers: buildHeaders(user),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};



const approveCollections = async (user, receiptNumbers) => {
  const res  = await fetch(`${BASE_URL}/FeeApi/approveCollections`, {
    method:  'POST',
    headers: buildHeaders(user),
    body:    JSON.stringify({ receipt_numbers: receiptNumbers }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt     = (v) => (isNaN(parseFloat(v)) ? '0.00' : parseFloat(v).toFixed(2));
const fmtCurr = (v, sym = '₹') => `${sym} ${fmt(v)}`;
const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  primary:  '#0f4c81',
  bg:       '#f0f4f8',
  surface:  '#ffffff',
  border:   '#e2e8f0',
  muted:    '#64748b',
  text:     '#0c1a2e',
  textSoft: '#475569',
  success:  '#15803d',
  error:    '#b91c1c',
  warning:  '#b45309',
  amber:    '#e8a020',
};

const METHOD_ICON = {
  Cash: 'payments', Card: 'credit-card', PhonePe: 'smartphone',
  'Google Pay': 'account-balance-wallet', Paytm: 'qr-code',
  'Bank Transfer': 'account-balance', Cheque: 'description',
};
const METHOD_COLOR = {
  Cash: '#15803d', Card: '#0f4c81', PhonePe: '#5f259f',
  'Google Pay': '#1a73e8', Paytm: '#00b9f5',
  'Bank Transfer': '#b45309', Cheque: '#475569',
};

// ─────────────────────────────────────────────────────────────────────────────
export default function FeeCollectionApprovalScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  // Only owners can approve — derived from the same role sent in headers
  const isOwner = useMemo(() =>
    ['owner'].includes((user?.ssmsUserRole ?? user?.role ?? '').toLowerCase().trim()),
  [user]);

  const [receipts,      setReceipts]      = useState([]);
  const [summary,       setSummary]       = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [hasLoaded,     setHasLoaded]     = useState(false);
  const [approving,     setApproving]     = useState(false);  // "Approve All" spinner
  const [currency,      setCurrency]      = useState('');
  const currSym = currency?.trim() || '₹';
  const [approvingId,   setApprovingId]   = useState(null);   // single receipt spinner
  const [selectedIds,   setSelectedIds]   = useState(new Set());
  const [searchQ,       setSearchQ]       = useState('');

  // Receipt detail modal
  const [detailModal,   setDetailModal]   = useState(false);
  const [detailRecord,  setDetailRecord]  = useState(null);

  // ── Load pending receipts ─────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const res = await fetchPendingCollections(user);
      setReceipts(res.receipts ?? []);
      setSummary(res.summary  ?? null);
      setCurrency(res.currency ?? '');
      setHasLoaded(true);
      setSelectedIds(new Set());
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Failed to load pending collections.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Load on mount
  React.useEffect(() => { loadData(); }, [loadData]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!searchQ.trim()) return receipts;
    const q = searchQ.toLowerCase();
    return receipts.filter(r =>
      r.receipt_number?.toLowerCase().includes(q) ||
      r.student_name?.toLowerCase().includes(q)   ||
      r.collected_by?.toLowerCase().includes(q)   ||
      r.payment_method?.toLowerCase().includes(q)
    );
  }, [receipts, searchQ]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = useCallback((receiptNo) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(receiptNo) ? next.delete(receiptNo) : next.add(receiptNo);
      return next;
    });
  }, []);

  const selectAll   = useCallback(() => setSelectedIds(new Set(filtered.map(r => r.receipt_number))), [filtered]);
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);
  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.receipt_number));

  const selectedTotal = useMemo(() =>
    receipts.filter(r => selectedIds.has(r.receipt_number))
      .reduce((s, r) => s + parseFloat(r.total_collected ?? 0), 0),
  [receipts, selectedIds]);

  // ── Approve ───────────────────────────────────────────────────────────────
  const doApprove = useCallback(async (receiptNumbers, single = false) => {
    if (!receiptNumbers.length) return;
    const label = single ? `receipt ${receiptNumbers[0]}` : `${receiptNumbers.length} receipt(s)`;
    Alert.alert(
      'Confirm Approval',
      `Approve ${label} and post ` +
      `${fmtCurr(receipts.filter(r => receiptNumbers.includes(r.receipt_number))
        .reduce((s, r) => s + parseFloat(r.total_collected ?? 0), 0))} to balance sheet?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: async () => {
            try {
              single ? setApprovingId(receiptNumbers[0]) : setApproving(true);
              const res = await approveCollections(user, receiptNumbers);
              Alert.alert('Approved ✓', res.message ?? `${receiptNumbers.length} receipt(s) approved and posted to balance sheet.`);
              await loadData();
            } catch (e) {
              Alert.alert('Error', e.message ?? 'Approval failed.');
            } finally {
              setApproving(false);
              setApprovingId(null);
            }
          },
        },
      ]
    );
  }, [receipts, user, loadData]);

  const approveSelected = useCallback(() => doApprove([...selectedIds]), [doApprove, selectedIds]);
  const approveOne      = useCallback((r)  => doApprove([r.receipt_number], true), [doApprove]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={st.safeArea} edges={['top']}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      {/* <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => navigation?.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={C.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>Fee Collection Approval</Text>
          <Text style={st.headerSub}>Review and approve pending receipts</Text>
        </View>
        <TouchableOpacity style={st.refreshBtn} onPress={loadData} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={C.primary} />
            : <MaterialIcons name="refresh" size={22} color={C.primary} />}
        </TouchableOpacity>
      </View> */}

      <FlatList
        data={filtered}
        keyExtractor={r => r.receipt_number}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={st.listContent}

        ListHeaderComponent={
          <View>
            {/* Summary banner */}
            {hasLoaded && summary && (
              <View style={st.summaryBanner}>
                <SumCell icon="receipt-long"  label="Pending"    value={String(summary.pending_count)} />
                <View style={st.sumDiv} />
                <SumCell icon="pending-actions" label="Amount"   value={fmtCurr(summary.total_pending_amount, currSym)} color="#fca5a5" />
                <View style={st.sumDiv} />
                <SumCell icon="check-circle"  label="Approved"   value={String(summary.approved_today ?? 0)} color="#4ade80" />
                <View style={st.sumDiv} />
                <SumCell icon="account-balance" label="Posted"   value={fmtCurr(summary.approved_amount_today ?? 0, currSym)} color="#4ade80" />
              </View>
            )}

            {/* Search + Select All */}
            {hasLoaded && (
              <View>
                <View style={st.searchRow}>
                  <View style={st.searchBox}>
                    <MaterialIcons name="search" size={18} color={C.muted} style={{ marginLeft: 10 }} />
                    <TextInput
                      style={st.searchInput}
                      placeholder="Search receipt, student, collector…"
                      placeholderTextColor={C.muted}
                      value={searchQ}
                      onChangeText={setSearchQ}
                      autoCorrect={false}
                    />
                    {searchQ.length > 0 && (
                      <TouchableOpacity onPress={() => setSearchQ('')} style={{ paddingRight: 10 }}>
                        <MaterialIcons name="cancel" size={18} color={C.muted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Selection toolbar */}
                {/* Selection + bulk approve toolbar — owner only */}
                {isOwner && (
                <View style={st.selectionBar}>
                  <TouchableOpacity style={st.selAllBtn} onPress={allSelected ? deselectAll : selectAll}>
                    <MaterialIcons
                      name={allSelected ? 'check-box' : 'check-box-outline-blank'}
                      size={20} color={C.primary} />
                    <Text style={st.selAllText}>
                      {allSelected ? 'Deselect All' : `Select All (${filtered.length})`}
                    </Text>
                  </TouchableOpacity>

                  {selectedIds.size > 0 && (
                    <TouchableOpacity
                      style={[st.approveSelectedBtn, approving && { opacity: 0.65 }]}
                      onPress={approveSelected}
                      disabled={approving}
                    >
                      {approving
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <MaterialIcons name="done-all" size={17} color="#fff" />}
                      <Text style={st.approveSelectedText}>
                        {approving
                          ? 'Approving…'
                          : `Approve ${selectedIds.size} · ${fmtCurr(selectedTotal, currSym)}`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                )}
              </View>
            )}

            {/* Non-owner read-only notice */}
            {!isOwner && hasLoaded && (
              <View style={st.readOnlyBanner}>
                <MaterialIcons name="lock" size={16} color={C.warning} />
                <Text style={st.readOnlyText}>
                  View only — you are not allowed to approve.
                </Text>
              </View>
            )}

            {/* Empty state */}
            {!loading && hasLoaded && filtered.length === 0 && (
              <View style={st.emptyState}>
                <MaterialIcons name="task-alt" size={56} color="#cbd5e1" />
                <Text style={st.emptyTitle}>All clear!</Text>
                <Text style={st.emptySub}>No pending receipts to approve.</Text>
              </View>
            )}

            {loading && !hasLoaded && (
              <View style={st.emptyState}>
                <ActivityIndicator size="large" color={C.primary} />
                <Text style={st.emptySub}>Loading pending collections…</Text>
              </View>
            )}
          </View>
        }

        renderItem={({ item: r }) => {
          const isSelected  = selectedIds.has(r.receipt_number);
          const isApproving = approvingId === r.receipt_number;
          const ic = METHOD_ICON[r.payment_method]  ?? 'payments';
          const co = METHOD_COLOR[r.payment_method] ?? C.primary;

          return (
            <TouchableOpacity
              style={[st.card, isSelected && st.cardSelected]}
              onPress={() => { setDetailRecord(r); setDetailModal(true); }}
              activeOpacity={0.85}
            >
              {/* Selection tick — owner only */}
              {isOwner && (
              <TouchableOpacity
                style={st.checkWrap}
                onPress={() => toggleSelect(r.receipt_number)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons
                  name={isSelected ? 'check-box' : 'check-box-outline-blank'}
                  size={22} color={isSelected ? C.primary : '#cbd5e1'} />
              </TouchableOpacity>
              )}

              <View style={st.cardBody}>
                {/* Row 1: receipt number + method badge + amount */}
                <View style={st.cardTop}>
                  <View style={st.receiptBadge}>
                    <MaterialIcons name="receipt" size={13} color={C.primary} />
                    <Text style={st.receiptNo}>{r.receipt_number}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <View style={[st.methodBadge, { backgroundColor: co + '18', borderColor: co + '40' }]}>
                    <MaterialIcons name={ic} size={11} color={co} />
                    <Text style={[st.methodText, { color: co }]}>{r.payment_method || 'Cash'}</Text>
                  </View>
                </View>

                {/* Row 2: student name */}
                <Text style={st.studentName} numberOfLines={1}>{r.student_name || '—'}</Text>
                <Text style={st.collectedBy}>
                  <Text style={{ color: C.muted }}>Collected by: </Text>
                  {r.collected_by || '—'}
                  {'  ·  '}{fmtDate(r.payment_date)}
                </Text>

                {/* Row 3: financial strip */}
                <View style={st.finStrip}>
                  <FinCell label="Fee Paid"  value={fmtCurr(r.total_paid, currSym)}       color={C.primary} />
                  <View style={st.finDiv} />
                  {parseFloat(r.total_late_fee ?? 0) > 0 && (
                    <>
                      <FinCell label="Late Fee" value={fmtCurr(r.total_late_fee, currSym)} color={C.warning} />
                      <View style={st.finDiv} />
                    </>
                  )}
                  <FinCell label="Collected" value={fmtCurr(r.total_collected, currSym)}   color={C.success} />
                  <View style={st.finDiv} />
                  <FinCell label="Balance"   value={fmtCurr(r.total_balance, currSym)}
                    color={parseFloat(r.total_balance ?? 0) > 0 ? C.error : C.success} />
                </View>

                {/* Approve button — owner only */}
                {isOwner && (
                <TouchableOpacity
                  style={[st.approveBtn, isApproving && { opacity: 0.65 }]}
                  onPress={() => approveOne(r)}
                  disabled={isApproving}
                >
                  {isApproving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <MaterialIcons name="check-circle" size={16} color="#fff" />}
                  <Text style={st.approveBtnText}>
                    {isApproving ? 'Approving…' : `Approve & Post  ${fmtCurr(r.total_collected, currSym)}`}
                  </Text>
                </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* ── Receipt detail modal ─────────────────────────────────────────── */}
      <ReceiptDetailModal
        visible={detailModal}
        record={detailRecord}
        onClose={() => setDetailModal(false)}
        onApprove={() => { setDetailModal(false); approveOne(detailRecord); }}
        isOwner={isOwner}
      />
    </SafeAreaView>
  );
}

// ─── Receipt Detail Modal ─────────────────────────────────────────────────────
function ReceiptDetailModal({ visible, record: r, onClose, onApprove, isOwner }) {
  if (!r) return null;
  const ic = METHOD_ICON[r.payment_method]  ?? 'payments';
  const co = METHOD_COLOR[r.payment_method] ?? C.primary;

  return (
    <Modal visible={visible} transparent animationType="slide"
      onRequestClose={onClose}>
      <View style={st.modalOverlay}>
        <TouchableOpacity style={st.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={st.modalSheet}>

          {/* Header */}
          <View style={st.modalHeader}>
            <View style={st.modalIconWrap}>
              <MaterialIcons name="receipt-long" size={22} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.modalTitle}>Receipt #{r.receipt_number}</Text>
              <Text style={st.modalSub}>{fmtDate(r.payment_date)}</Text>
            </View>
            <TouchableOpacity style={st.modalCloseBtn} onPress={onClose}>
              <MaterialIcons name="close" size={20} color={C.muted} />
            </TouchableOpacity>
          </View>

          {/* Amounts */}
          <View style={st.modalAmtRow}>
            <AmtBox label="Fee Paid"   value={fmtCurr(r.total_paid, currSym)}       color={C.primary} />
            {parseFloat(r.total_late_fee ?? 0) > 0 && (
              <AmtBox label="Late Fee" value={fmtCurr(r.total_late_fee, currSym)}   color={C.warning} />
            )}
            <AmtBox label="Collected"  value={fmtCurr(r.total_collected, currSym)}  color={C.success} />
            <AmtBox label="Balance"    value={fmtCurr(r.total_balance, currSym)}
              color={parseFloat(r.total_balance ?? 0) > 0 ? C.error : C.success} />
          </View>

          {/* Details */}
          <View style={st.modalDetails}>
            <DetailRow label="Student"       value={r.student_name      || '—'} />
            <DetailRow label="Enrollment #"  value={r.enrollment_id     || '—'} />
            <DetailRow label="Collected By"  value={r.collected_by      || '—'} />
            <DetailRow label="Payment Date"  value={fmtDate(r.payment_date)} />
            <DetailRow label="Payment Method" value={r.payment_method   || 'Cash'} icon={ic} iconColor={co} />
            <DetailRow label="Class"         value={r.class_name        || String(r.class_id   ?? '—')} />
            <DetailRow label="Session"       value={r.session_name      || String(r.session_id ?? '—')} />
            <DetailRow label="Branch"        value={r.branch_name       || String(r.branch_id  ?? '—')} />
          </View>

          {/* Fee items */}
          {(r.items ?? []).length > 0 && (
            <View style={st.modalItems}>
              <Text style={st.modalItemsTitle}>Fee Items</Text>
              {r.items.map((item, idx) => (
                <View key={idx} style={[st.modalItemRow,
                  idx === r.items.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.modalItemName}>{item.fee_item_name}</Text>
                    {item.month_no && <Text style={st.modalItemMeta}>Month: {item.month_no}</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.success }}>
                      Paid {fmtCurr(item.paid_amount, currSym)}
                    </Text>
                    {parseFloat(item.late_fee ?? 0) > 0 && (
                      <Text style={{ fontSize: 11, color: C.warning }}>Late {fmtCurr(item.late_fee, currSym)}</Text>
                    )}
                    <View style={[st.balPill, {
                      backgroundColor: parseFloat(item.balance_amount ?? 0) > 0 ? '#fef3c7' : '#dcfce7'
                    }]}>
                      <Text style={[st.balPillText, {
                        color: parseFloat(item.balance_amount ?? 0) > 0 ? C.warning : C.success
                      }]}>
                        {parseFloat(item.balance_amount ?? 0) > 0
                          ? `Bal ${fmtCurr(item.balance_amount, currSym)}` : '✓ Cleared'}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Approve button */}
          <View style={st.modalFooter}>
            <TouchableOpacity style={st.modalCancelBtn} onPress={onClose}>
              <Text style={st.modalCancelText}>Close</Text>
            </TouchableOpacity>
            {isOwner && (
            <TouchableOpacity style={st.modalApproveBtn} onPress={onApprove}>
              <MaterialIcons name="check-circle" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={st.modalApproveText}>Approve & Post to Balance Sheet</Text>
            </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function SumCell({ icon, label, value, color }) {
  return (
    <View style={st.sumCell}>
      <MaterialIcons name={icon} size={15} color={color ?? 'rgba(255,255,255,0.85)'} />
      <Text style={[st.sumValue, color && { color }]}>{value}</Text>
      <Text style={st.sumLabel}>{label}</Text>
    </View>
  );
}

function FinCell({ label, value, color }) {
  return (
    <View style={st.finCell}>
      <Text style={st.finLabel}>{label}</Text>
      <Text style={[st.finValue, { color }]}>{value}</Text>
    </View>
  );
}

function AmtBox({ label, value, color }) {
  return (
    <View style={st.amtBox}>
      <Text style={st.amtLabel}>{label}</Text>
      <Text style={[st.amtValue, { color }]}>{value}</Text>
    </View>
  );
}

function DetailRow({ label, value, icon, iconColor }) {
  return (
    <View style={st.detailRow}>
      <Text style={st.detailLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {icon && <MaterialIcons name={icon} size={13} color={iconColor ?? C.muted} />}
        <Text style={st.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },

  header:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, paddingTop: Platform.OS === 'ios' ? 4 : 14, paddingBottom: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12, elevation: 3, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  backBtn:     { width: 38, height: 38, borderRadius: 12, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 19, fontWeight: '900', color: C.text, letterSpacing: -0.3 },
  headerSub:   { fontSize: 12, color: C.muted, marginTop: 2 },
  refreshBtn:  { width: 38, height: 38, borderRadius: 12, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },

  listContent: { paddingBottom: 40 },

  summaryBanner: { flexDirection: 'row', backgroundColor: C.primary, marginHorizontal: 16, marginTop: 14, marginBottom: 4, borderRadius: 18, padding: 14, elevation: 4, shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  sumCell:       { flex: 1, alignItems: 'center', gap: 3 },
  sumDiv:        { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },
  sumValue:      { fontSize: 12, fontWeight: '900', color: '#fff' },
  sumLabel:      { fontSize: 8, color: 'rgba(255,255,255,0.7)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  searchRow:   { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  searchBox:   { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 13, borderWidth: 1.5, borderColor: C.border, minHeight: 46 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, paddingVertical: 10, paddingHorizontal: 8 },

  selectionBar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  selAllBtn:         { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selAllText:        { fontSize: 13, fontWeight: '700', color: C.primary },
  approveSelectedBtn:{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.success, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14 },
  approveSelectedText:{ fontSize: 13, fontWeight: '800', color: '#fff' },

  readOnlyBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12, marginHorizontal: 16, marginTop: 10, padding: 12 },
  readOnlyText:   { fontSize: 13, color: C.warning, fontWeight: '600', flex: 1 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: C.textSoft },
  emptySub:   { fontSize: 13, color: C.muted, textAlign: 'center', paddingHorizontal: 40 },

  // Receipt card
  card:         { flexDirection: 'row', backgroundColor: C.surface, marginHorizontal: 16, marginTop: 10, borderRadius: 18, borderWidth: 1.5, borderColor: C.border, overflow: 'hidden', elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  cardSelected: { borderColor: C.primary, backgroundColor: '#f0f7ff' },
  checkWrap:    { paddingHorizontal: 10, justifyContent: 'flex-start', paddingTop: 14 },
  cardBody:     { flex: 1, padding: 14, paddingLeft: 4 },
  cardTop:      { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  receiptBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e8f0fe', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  receiptNo:    { fontSize: 12, fontWeight: '800', color: C.primary },
  methodBadge:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  methodText:   { fontSize: 11, fontWeight: '700' },
  studentName:  { fontSize: 15, fontWeight: '800', color: C.text, marginBottom: 2 },
  collectedBy:  { fontSize: 11, color: C.muted, marginBottom: 10 },

  finStrip: { flexDirection: 'row', backgroundColor: '#f8fafc', borderRadius: 10, padding: 8, marginBottom: 10 },
  finCell:  { flex: 1, alignItems: 'center' },
  finDiv:   { width: 1, backgroundColor: C.border, marginVertical: 2 },
  finLabel: { fontSize: 8, color: C.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  finValue: { fontSize: 12, fontWeight: '900', marginTop: 2 },

  approveBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.success, borderRadius: 12, paddingVertical: 11, elevation: 2, shadowColor: C.success, shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  approveBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },

  // Modal
  modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBackdrop:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet:     { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '90%', paddingBottom: Platform.OS === 'ios' ? 36 : 20 },
  modalHeader:    { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  modalIconWrap:  { width: 44, height: 44, borderRadius: 14, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  modalTitle:     { fontSize: 18, fontWeight: '800', color: C.text },
  modalSub:       { fontSize: 12, color: C.muted, marginTop: 2 },
  modalCloseBtn:  { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  modalAmtRow:    { flexDirection: 'row', margin: 16, gap: 8 },
  amtBox:         { flex: 1, backgroundColor: '#f8fafc', borderRadius: 12, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  amtLabel:       { fontSize: 9, color: C.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  amtValue:       { fontSize: 14, fontWeight: '900', marginTop: 3 },
  modalDetails:   { paddingHorizontal: 16, marginBottom: 8 },
  detailRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  detailLabel:    { fontSize: 12, color: C.muted, fontWeight: '600' },
  detailValue:    { fontSize: 13, fontWeight: '700', color: C.text },
  modalItems:     { marginHorizontal: 16, marginBottom: 12, backgroundColor: '#f8fafc', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  modalItemsTitle:{ fontSize: 11, fontWeight: '800', color: C.primary, letterSpacing: 1, textTransform: 'uppercase', padding: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: '#eef2f8' },
  modalItemRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  modalItemName:  { fontSize: 13, fontWeight: '700', color: C.text },
  modalItemMeta:  { fontSize: 11, color: C.muted, marginTop: 2 },
  balPill:        { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  balPillText:    { fontSize: 11, fontWeight: '800' },
  modalFooter:    { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 8 },
  modalCancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1.5, borderColor: C.border },
  modalCancelText:{ fontSize: 14, fontWeight: '700', color: C.textSoft },
  modalApproveBtn:{ flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: C.success, elevation: 3, shadowColor: C.success, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  modalApproveText:{ fontSize: 14, fontWeight: '700', color: '#fff' },
});