/**
 * StudentFeeScreen.js
 *
 * Navigate to this screen via:
 *   navigation.navigate('StudentFee', {
 *     enrollment_id:   1042,
 *     registration_id: 5,
 *     student_name:    'John Smith',
 *     class_id:        3,
 *     session_id:      2,
 *     branch_id:       1,
 *     ssms_client_code:'SCH01',
 *   })
 *
 * Screen layout:
 *   1. Student header card
 *   2. DUE FEES — selectable rows (cart-style), running total at bottom
 *   3. Payment entry — paid amount input, balance auto-calc, submit
 *   4. PAYMENT HISTORY — paid records as tappable receipt links
 *   5. ReceiptDetailModal — full details of a past payment
 */

import React, {
  useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, ActivityIndicator, Platform,
  RefreshControl, Dimensions, FlatList, Animated, Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import {
  fetchStudentHostelFeeData,
  submitPayment,
  sendReceiptEmail,
} from '../../services/FeeServiceApi';

import { fmtMoney, fmtDate as fmtLocalDate, currencySymbol, taxLabel } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";
const { width } = Dimensions.get('window');
const isTablet  = width >= 768;
// NOTE: useContext(AuthContext) moved inside the component function below

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt      = (v)    => (isNaN(parseFloat(v)) ? '0.00' : parseFloat(v).toFixed(2));
const fmtCurr  = (v) => fmtMoney(v);   // Region & formats (the school's currency and number style)
const fmtDate  = (d)    => {
  if (!d) return '—';
  const x = new Date(d);
  return isNaN(x) ? d : fmtLocalDate(x, 'medium');
};
const today = () => new Date().toISOString().split('T')[0];

// Auto-generate a cash receipt number: CASH-YYYYMMDD-XXXX
const genCashReceipt = () => {
  const d   = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `CASH-${ymd}-${rnd}`;
};

const PAYMENT_METHODS = [
  { id: 'Cash',          icon: 'payments',               get label() { return _t("Cash"); },         color: '#15803d', bg: '#f0fdf4' },
//   { id: 'Card',          icon: 'credit-card',            label: 'Card',         color: '#0f4c81', bg: '#eff6ff' },
  { id: 'PhonePe',       icon: 'smartphone',             get label() { return _t("PhonePe"); },      color: '#5f259f', bg: '#faf5ff' },
  { id: 'Google Pay',    icon: 'account-balance-wallet', get label() { return _t("Google Pay"); },   color: '#1a73e8', bg: '#eff8ff' },
  { id: 'Paytm',         icon: 'qr-code-2',              get label() { return _t("Paytm"); },        color: '#00b9f5', bg: '#f0fbff' },
//   { id: 'Bank Transfer', icon: 'account-balance',        label: 'Bank Transfer',color: '#b45309', bg: '#fffbeb' },
];

const REVIEW_STYLE = {
  Approved:       { bg: '#dcfce7', text: '#15803d', border: '#bbf7d0' },
  Rejected:       { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' },
  'Under Review': { bg: '#fef9c3', text: '#a16207', border: '#fef08a' },
  Pending:        { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' },
};
const rs = (s) => REVIEW_STYLE[s] ?? REVIEW_STYLE.Pending;

// ─── Cart reducer ─────────────────────────────────────────────────────────────
const cartReducer = (state, action) => {
  switch (action.type) {
    case 'TOGGLE': {
      const id = action.id;
      return state.includes(id) ? state.filter(x => x !== id) : [...state, id];
    }
    case 'SELECT_ALL':  return action.ids;
    case 'CLEAR':       return [];
    default:            return state;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
export default function StudentFeeScreen({ route, navigation }) {
  // Accept both camelCase (from EnrolledStudentsScreen) and snake_case param names
  const params = route?.params ?? {};
  const enrollment_id   = params.enrollmentId   ?? params.enrollment_id;
  const registration_id = params.registrationId ?? params.registration_id;
  const student_name    = params.studentsName   ?? params.student_name;
  const class_id        = params.classId        ?? params.class_id;
  const session_id      = params.sessionId      ?? params.session_id;
  const branch_id       = params.branchId       ?? params.branch_id;
  const ssms_client_code = params.ssmsClientCode ?? params.ssms_client_code;

  const { user, logout } = useContext(AuthContext);

  // Only admin and owner roles can collect/submit fee payments
  const canCollect = useMemo(() =>
    ['admin', 'owner'].includes((user?.ssmsUserRole ?? user?.role ?? '').toLowerCase().trim()),
  [user]);

  // Data
  const [dueItems,     setDueItems]    = useState([]);   // joined fee_structure rows with balance
  const [paidRecords,  setPaidRecords] = useState([]);   // ssms_fee_paid_details rows (fully/partially paid)
  const [schoolDetails,  setSchoolDetails] = useState({});
  // Currency symbol from school settings — fallback to ₹
  const currSym = currencySymbol();   // ssms_fee_paid_details rows (fully/partially paid)
  const [loading,      setLoading]     = useState(true);
  const [refreshing,   setRefreshing]  = useState(false);

  // Cart
  const [selected, dispatch] = useReducer(cartReducer, []);

  // Late fee overrides — keyed by fee_id, allows manual entry per due item.
  // Pre-populated from API value (item.late_fee); user can edit before paying.
  const [lateFeeOverrides, setLateFeeOverrides] = useState({});

  const getLateFee = useCallback((item) => {
    // Late fee only applies to overdue items
    const isOverdue = item.due_date && new Date(item.due_date) < new Date();
    if (!isOverdue) return 0;
    const override = lateFeeOverrides[item.fee_id];
    return override !== undefined ? (parseFloat(override) || 0) : (parseFloat(item.late_fee) || 0);
  }, [lateFeeOverrides]);

  const setLateFee = useCallback((feeId, val) => {
    setLateFeeOverrides(prev => ({ ...prev, [feeId]: val }));
  }, []);

  // Payment form
  const [paidInput,      setPaidInput]    = useState('');
  const [receiptInput,   setReceiptInput] = useState('');
  const [paymentDate,    setPaymentDate]  = useState(today());
  const [paymentMethod,  setPaymentMethod]= useState('Cash');
  const [submitting,     setSubmitting]   = useState(false);

  // UPI / QR modal
  const [qrModal,        setQrModal]      = useState(false);

 
  // Receipt detail modal
  const [receiptModal,  setReceiptModal] = useState(false);
  const [receiptRecord, setReceiptRecord]= useState(null);

  // Email receipt modal
  const [emailModal,   setEmailModal]  = useState(false);
  const [emailRecord,  setEmailRecord] = useState(null);
  const [emailAddr,    setEmailAddr]   = useState('');
  const [sendingEmail, setSendingEmail]= useState(false);

  // Shake animation for validation
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 60, useNativeDriver: true }),
    ]).start();
  };

  // isCash drives receipt field behaviour
  const isCash = paymentMethod === 'Cash';

  // When method switches TO Cash → auto-generate receipt number
  // When method switches AWAY from Cash → clear so user must enter their ref
  React.useEffect(() => {
    if (isCash) {
      setReceiptInput(genCashReceipt());
    } else {
      setReceiptInput('');
    }
  }, [paymentMethod]);

  // ── Derived cart totals ────────────────────────────────────────────────────
  const selectedItems = useMemo(
    () => dueItems.filter(i => selected.includes(i.fee_id)),
    [dueItems, selected],
  );

  const cartTotal = useMemo(
    () => selectedItems.reduce((s, i) => {
      const base = parseFloat(i.balance_due ?? i.fee_amount ?? 0);
      return s + base + getLateFee(i);
    }, 0),
    [selectedItems, getLateFee],
  );

  const cartLateFeeTotal = useMemo(
    () => selectedItems.reduce((s, i) => s + getLateFee(i), 0),
    [selectedItems, getLateFee],
  );

  const cartTaxTotal = useMemo(
    () => selectedItems.reduce((s, i) => s + parseFloat(i.tax_amount ?? 0), 0),
    [selectedItems],
  );

  const paidAmt   = parseFloat(paidInput) || 0;
  const balanceAmt = Math.max(0, cartTotal - paidAmt);
  const overpaid   = paidAmt > cartTotal && cartTotal > 0;

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!user || !enrollment_id) { setLoading(false); setRefreshing(false); return; }
    console.log('Loading fee data with params:', { enrollment_id, class_id, session_id, branch_id, ssms_client_code });
    try {
      if (!silent) setLoading(true);
      let res;
      try {
        res = await fetchStudentHostelFeeData(enrollment_id,  {
          class_id, session_id, branch_id, ssms_client_code, category: 'Hostel',
        }, user);
      } catch (e) {
        if (String(e?.message ?? '').includes('Session expired') || String(e?.message ?? '').includes('SESSION_EXPIRED')) {
          logout();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        throw e;
      }
      const dueData = Array.isArray(res?.due) ? res.due : [];
      setDueItems(dueData);
      setPaidRecords(Array.isArray(res?.paid) ? res.paid : []);

      const schoolData = res?.schoolDetails ?? {};
      setSchoolDetails(schoolData);

      // Pre-populate late fee overrides from API values
      const initOverrides = {};
      dueData.forEach(i => {
        if (parseFloat(i.late_fee) > 0) initOverrides[i.fee_id] = String(i.late_fee);
      });
      setLateFeeOverrides(initOverrides);
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message) ?? _t("Failed to load fee data."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enrollment_id, class_id, session_id, branch_id, ssms_client_code, user]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(true); };

  // ── Summary across all due items ───────────────────────────────────────────
  const totalDue  = useMemo(() => dueItems.reduce((s, i) => {
    return s + parseFloat(i.balance_due ?? i.fee_amount ?? 0) + parseFloat(i.late_fee ?? 0);
  }, 0), [dueItems]);
  const totalPaid = useMemo(() => paidRecords.reduce((s, r) => s + parseFloat(r.total_collected ?? r.total_paid ?? r.paid_amount ?? 0), 0), [paidRecords]);

   // UPI config — update these for your school
  const UPI_ID        = schoolDetails?.upi_id        ?? '';  //'9801198648@ybl';
  const MERCHANT_NAME = schoolDetails?.pay_account_nam ?? '';

  // ── Submit payment ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (selected.length === 0) {
      Alert.alert(_t("Select Items"), _t("Please select at least one fee item to pay.")); return;
    }
    if (!isCash && !receiptInput.trim()) {
      shake();
      Alert.alert(_t("Reference Required"), _t("Please enter the {paymentMethod} transaction / reference number.", { paymentMethod })); return;
    }
    if (paidAmt <= 0) {
      shake();
      Alert.alert(_t("Amount Required"), _t("Please enter a valid payment amount.")); return;
    }
    if (overpaid) {
      Alert.alert(_t("Overpayment"), _t("Paid amount cannot exceed the selected total of {cartTotal}.", { cartTotal: fmtCurr(cartTotal, currSym) })); return;
    }

    try {
      setSubmitting(true);
      await submitPayment({
        enrollment_id: enrollment_id,
        registration_id: route?.params?.registrationId,
        selected_fee_items: selectedItems.map(i => ({
          fee_item_id:      i.fee_item_id,
          fee_id:           i.fee_id,
          fee_amount:       i.fee_amount,
          net_fee_amount:   i.net_fee_amount ?? i.fee_amount,
          discount_amount:  i.discount_amount  ?? 0,
          discount_percent: i.discount_percent ?? 0,
          discount_reason:  i.discount_reason  ?? '',
          tax_percent:      i.tax_percent  ?? 0,
          tax_amount:       i.tax_amount   ?? 0,
          balance_due:      i.balance_due ?? i.fee_amount,
          late_fee:         getLateFee(i),
          class_id:         i.class_id,
          session_id:       i.session_id,
          branch_id:        i.branch_id,
          ssms_user_name:   user?.ssmsUserName || '',
          ssms_client_code: user?.ssmsClientCode || '',
          trxn_id:          i.trxn_id,
          existing_trxn:    i.trxn_id ?? null,
          existing_receipt: i.receipt_number ?? null,
        })),
        receipt_number:   receiptInput.trim(),
        fee_paid_amount:      paidAmt,
        balance_amount:   balanceAmt,
        payment_date:     paymentDate,
        fee_paid_date:    paymentDate,
        payment_method:   paymentMethod,
        admin_user:       user?.ssms_user_name ?? '',
        class_id,
        session_id,
        branch_id,
        ssms_client_code,
        ssms_user_name:   student_name ?? '',
        // These two fields are used by payStudentFees() to auto-send
        // the receipt email immediately after saving — no separate call needed
        student_name:     student_name ?? '',
        email_address:    route?.params?.email_address ?? '',
      }, user);

      // Reset form
      dispatch({ type: 'CLEAR' });
      setPaidInput('');
      setReceiptInput(genCashReceipt());   // pre-fill for next cash payment
      setPaymentDate(today());
      setPaymentMethod('Cash');
      load(true);
      Alert.alert(_t("Payment Recorded"), _t("Receipt #{v} saved successfully.", { v: receiptInput.trim() }));
    } catch (e) {
      Alert.alert(_t("Error"), _tx(e.message) ?? _t("Payment failed."));
    } finally {
      setSubmitting(false);
    }
  };

  const openReceipt = (rec) => { setReceiptRecord(rec); setReceiptModal(true); };

  const openEmailModal = useCallback((rec) => {
    setEmailRecord(rec);
    setEmailAddr('');
    setEmailModal(true);
  }, []);

  const handleSendEmail = useCallback(async () => {
    const addr = emailAddr.trim();
    if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      Alert.alert(_t("Invalid Email"), _t("Please enter a valid email address.")); return;
    }
    try {
      setSendingEmail(true);
      // Build fee_items array from the grouped receipt's items[]
      const feeItems = (emailRecord?.items ?? []).map(item => ({
        fee_item_name:  item.fee_item_name,
        fee_amount:     item.fee_amount,
        paid_amount:    item.paid_amount,
        balance_amount: item.balance_amount,
        late_fee:       item.late_fee  ?? 0,
        month_no:       item.month_no  ?? '',
      }));
      await sendReceiptEmail({
        email:          addr,
        receipt_number: emailRecord?.receipt_number,
        student_name:   student_name ?? '',
        enrollment_id:  enrollment_id ?? enrollment_id,
        // Receipt-level totals
        paid_amount:    emailRecord?.total_paid + emailRecord?.total_late_fee ?? 0,
        balance_amount: emailRecord?.total_balance ?? 0,
        fee_amount:     emailRecord?.total_fee     ?? 0,
        payment_date:   emailRecord?.payment_date,
        fee_paid_date:  emailRecord?.fee_paid_date,
        payment_method: emailRecord?.payment_method ?? 'Cash',
        admin_user:     emailRecord?.admin_user     ?? '',
        // Full items breakdown for the email table
        fee_items: feeItems,
      }, user);
      setEmailModal(false);
      Alert.alert(_t("Sent ✓"), _t("Receipt emailed to {addr} successfully.", { addr }));
    } catch (e) {
      Alert.alert(_t("Failed"), _tx(e.message) ?? _t("Could not send email. Please try again."));
    } finally {
      setSendingEmail(false);
    }
  }, [emailAddr, emailRecord, student_name, enrollment_id, route, user]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.root}>
        <NavBar title={_tx(student_name) ?? _t("Student Fees")} sub={_t("Enrollment #{enrollment_id}", { enrollment_id })} onBack={() => navigation?.goBack()} />
        <View style={s.loaderWrap}>
          <ActivityIndicator size="large" color="#0f4c81" />
          <Text style={s.loaderText}>{_t("Loading fee data…")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
     
      

      <ScrollView

        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0f4c81']} tintColor="#0f4c81" />}
      >
        {/* ── Student info card ───────────────────────────────────────────────── */}
      <StudentInfoCard
        studentsName={route?.params?.studentsName}
        enrollmentId={enrollment_id}
        className={route?.params?.className}
        totalDue={totalDue}
        totalPaid={totalPaid}
        currSym={currSym}
      />
       <View style={si.separator}></View>
        {/* Summary banner removed — financials now live in StudentInfoCard above */}

        {/* ═══════════════════════════════════════════════════════════════════
            DUE FEES — selectable cart rows
        ════════════════════════════════════════════════════════════════════ */}
        <View style={s.sectionHeader}>
          <View style={s.sectionHeaderLeft}>
            <View style={[s.sectionDot, { backgroundColor: '#b91c1c' }]} />
            <Text style={s.sectionTitle}>{_t("Due Payments")}</Text>
            {dueItems.length > 0 && (
              <View style={s.sectionBadge}><Text style={s.sectionBadgeText}>{_tx(dueItems.length)}</Text></View>
            )}
          </View>
          {dueItems.length > 0 && (
            <TouchableOpacity
              onPress={() =>
                selected.length === dueItems.length
                  ? dispatch({ type: 'CLEAR' })
                  : dispatch({ type: 'SELECT_ALL', ids: dueItems.map(i => i.fee_id) })
              }
            >
              <Text style={s.selectAllText}>
                {selected.length === dueItems.length ? _t("Deselect all") : _t("Select all")}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {dueItems.length === 0 ? (
          <View style={s.emptyDue}>
            <MaterialIcons name="celebration" size={36} color="#15803d" />
            <Text style={s.emptyDueText}>{_t("No outstanding fees — all clear!")}</Text>
          </View>
        ) : (
          dueItems.map((item) => {
            const checked = selected.includes(item.fee_id);
            const overdue = item.due_date && new Date(item.due_date) < new Date();
            return (
              <TouchableOpacity
                key={item.fee_id}
                activeOpacity={0.85}
                onPress={() => dispatch({ type: 'TOGGLE', id: item.fee_id })}
              >
                <View style={[s.dueCard, checked && s.dueCardSelected]}>
                  {/* Checkbox */}
                  <View style={[s.checkbox, checked && s.checkboxChecked]}>
                    {checked && <MaterialIcons name="check" size={14} color="#fff" />}
                  </View>

                  {/* Content */}
                  <View style={s.dueCardContent}>
                    <View style={s.dueCardTopRow}>
                      <Text style={s.dueItemName} numberOfLines={1}>
                        {_tx(item.fee_item_name)} ({_tx(item.month_no)})
                        {/* {item.fee_name ? `  ·  ${item.fee_name}` : ''} */}
                      </Text>
                      {overdue && (
                        <View style={s.overdueBadge}>
                          <MaterialIcons name="warning" size={10} color="#b45309" />
                          <Text style={s.overdueBadgeText}>{_t("Overdue")}</Text>
                        </View>
                      )}
                    </View>

                    <View style={s.dueCardMetaRow}>
                      <MetaTag icon="event" label={_t("Due {due_date}", { due_date: fmtDate(item.due_date) })} />
                      <MetaTag icon="class" label={_t("Class: {v}", { v: item.class_name ?? '—' })} />
                      {item.late_fee > 0 && (
                        <MetaTag icon="timer" label={_t("Late {late_fee}", { late_fee: fmtCurr(item.late_fee) })} warn />
                      )}
                    </View>

                    {/* Late fee row — appears only when item is selected AND overdue */}
                    {checked && overdue && (
                      <View style={s.lateFeeRow}>
                        <MaterialIcons name="timer" size={14} color="#b45309" />
                        <Text style={s.lateFeeLabel}>{_t("Late Fee:")}</Text>
                        <View style={s.lateFeeInputWrap}>
                          <Text style={s.lateFeeRupee}>{_tx(currSym)}</Text>
                          <TextInput
                            style={s.lateFeeInput}
                            placeholder="0.00"
                            placeholderTextColor="#94a3b8"
                            value={lateFeeOverrides[item.fee_id] ?? (parseFloat(item.late_fee) > 0 ? String(item.late_fee) : '')}
                            onChangeText={val => setLateFee(item.fee_id, val)}
                            keyboardType="decimal-pad"
                          />
                        </View>
                        {getLateFee(item) > 0 && (
                          <TouchableOpacity onPress={() => setLateFee(item.fee_id, '0')} style={s.lateFeeClear}>
                            <MaterialIcons name="close" size={14} color="#b45309" />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {/* Discount badge */}
                    {parseFloat(item.discount_amount ?? 0) > 0 && (
                      <View style={s.discountRow}>
                        <MaterialIcons name="local-offer" size={12} color="#16a34a" />
                        <Text style={s.discountTxt}>{_t("{discount_percent}% discount applied", { discount_percent: fmt(item.discount_percent) })}</Text>
                        <View style={{ flex: 1 }} />
                        <Text style={s.discountStrike}>{fmtCurr(item.fee_amount, currSym)}</Text>
                        <Text style={s.discountSaved}>−{fmtCurr(item.discount_amount, currSym)}</Text>
                      </View>
                    )}

                    {/* Tax badge */}
                    {parseFloat(item.tax_amount ?? 0) > 0 && (
                      <View style={[s.discountRow, { backgroundColor: '#eff6ff' }]}>
                        <MaterialIcons name="account-balance" size={12} color="#0f4c81" />
                        <Text style={[s.discountTxt, { color: '#0f4c81' }]}>
                          {taxLabel()} {fmt(item.tax_percent)}%
                        </Text>
                        <View style={{ flex: 1 }} />
                        <Text style={[s.discountSaved, { color: '#0f4c81' }]}>+{fmtCurr(item.tax_amount, currSym)}</Text>
                      </View>
                    )}

                    <View style={s.dueAmountRow}>
                      {item.previously_paid > 0 && (
                        <View style={s.prevPaidTag}>
                          <Text style={s.prevPaidText}>{_t("Paid {previously_paid}", { previously_paid: fmtCurr(item.previously_paid) })}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }} />
                      <View style={{ alignItems: 'flex-end' }}>
                        {checked && overdue && getLateFee(item) > 0 && (
                          <Text style={s.lateFeeBreakdown}>{_t("Base {v} + Late {v2}", { v: fmtCurr(item.balance_due ?? item.fee_amount, currSym), v2: fmtCurr(getLateFee(item, currSym)) })}</Text>
                        )}
                        <Text style={s.dueAmountLabel}>
                          {checked && overdue && getLateFee(item) > 0 ? _t("Total (incl. Late)") : _t("Balance Due")}
                        </Text>
                        <Text style={[s.dueAmount, checked && s.dueAmountSelected]}>
                          {checked && overdue && getLateFee(item) > 0
                            ? fmtCurr((parseFloat(item.balance_due ?? item.fee_amount, currSym) || 0) + getLateFee(item))
                            : fmtCurr(item.balance_due ?? item.fee_amount, currSym)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PAYMENT ENTRY — sticky cart-style bottom section
        ════════════════════════════════════════════════════════════════════ */}
        {dueItems.length > 0 && (
          <View style={s.paymentPanel}>
            {/* Selected items summary */}
            <View style={s.cartSummaryRow}>
              <Text style={s.cartSummaryLabel}>{_t("{length} item{pl} selected", { length: selected.length, pl: selected.length !== 1 ? 's' : '' })}</Text>
              <Text style={s.cartTotal}>{fmtCurr(cartTotal, currSym)}</Text>
            </View>

            {selected.length > 0 && (
              <>
                {/* Selected items breakdown */}
                <View style={s.cartBreakdown}>
                  {selectedItems.map(i => {
                    const lf = getLateFee(i);
                    return (
                      <View key={i.fee_id}>
                        <View style={s.cartBreakdownRow}>
                          <Text style={s.cartBreakdownLabel} numberOfLines={1}>
                            {_tx(i.fee_item_name)} ({_tx(i.month_no)})
                          </Text>
                          <Text style={s.cartBreakdownAmt}>{fmtCurr(i.balance_due ?? i.fee_amount, currSym)}</Text>
                        </View>
                        {lf > 0 && (
                          <View style={s.cartBreakdownRow}>
                            <Text style={[s.cartBreakdownLabel, { color: '#b45309', paddingLeft: 10 }]}>{_t("↳ Late Fee")}</Text>
                            <Text style={[s.cartBreakdownAmt, { color: '#b45309' }]}>{fmtCurr(lf, currSym)}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                  <View style={s.cartBreakdownDivider} />
                  {cartTaxTotal > 0 && (
                    <View style={s.cartBreakdownRow}>
                      <Text style={[s.cartBreakdownLabel, { color: '#0f4c81' }]}>{taxLabel()}</Text>
                      <Text style={[s.cartBreakdownAmt,   { color: '#0f4c81' }]}>{fmtCurr(cartTaxTotal, currSym)}</Text>
                    </View>
                  )}
                  {cartLateFeeTotal > 0 && (
                    <View style={s.cartBreakdownRow}>
                      <Text style={[s.cartBreakdownLabel, { color: '#b45309' }]}>{_t("Total Late Fee")}</Text>
                      <Text style={[s.cartBreakdownAmt,   { color: '#b45309' }]}>{fmtCurr(cartLateFeeTotal, currSym)}</Text>
                    </View>
                  )}
                  <View style={s.cartBreakdownRow}>
                    <Text style={[s.cartBreakdownLabel, { fontWeight: '800', color: '#0c1a2e' }]}>{_t("Total")}</Text>
                    <Text style={[s.cartBreakdownAmt,   { fontWeight: '900', color: '#0f4c81' }]}>{fmtCurr(cartTotal, currSym)}</Text>
                  </View>
                </View>

                {/* ── Payment Method selector — 2 per row ─────────────────── */}
                <Text style={s.inputLabel}>{_t("Payment Method")}</Text>
                <View style={s.methodGrid}>
                  {PAYMENT_METHODS.map((m, idx) => {
                    const active = paymentMethod === m.id;
                    // 2 columns: every item takes (50% - gap/2)
                    const isLastOdd = idx === PAYMENT_METHODS.length - 1 && PAYMENT_METHODS.length % 2 !== 0;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        activeOpacity={0.75}
                        style={[
                          s.methodBtn,
                          isLastOdd && s.methodBtnFull,
                          active && {
                            borderColor: m.color,
                            backgroundColor: m.bg,
                          },
                        ]}
                        onPress={() => setPaymentMethod(m.id)}
                      >
                        {/* Brand icon — large, centred */}
                        <View style={[s.methodIconWrap, active && { backgroundColor: m.color + '20' }]}>
                          <MaterialIcons name={m.icon} size={28} color={active ? m.color : '#94a3b8'} />
                        </View>

                        {/* Label */}
                        <Text style={[s.methodLabel, active && { color: m.color, fontWeight: '800' }]}>
                          {_tx(m.label)}
                        </Text>

                        {/* Active checkmark badge */}
                        {active && (
                          <View style={[s.methodCheck, { backgroundColor: m.color }]}>
                            <MaterialIcons name="check" size={9} color="#fff" />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* UPI apps: show QR button when PhonePe / GPay / Paytm selected */}
                {['PhonePe', 'Google Pay', 'Paytm'].includes(paymentMethod) && cartTotal > 0 && (
                  <TouchableOpacity style={s.qrLaunchBtn} onPress={() => setQrModal(true)}>
                    <MaterialIcons name="qr-code-2" size={22} color="#5f259f" />
                    <Text style={s.qrLaunchText}>{_t("Show QR Code for {paymentMethod}", { paymentMethod })}</Text>
                    <MaterialIcons name="chevron-right" size={18} color="#5f259f" />
                  </TouchableOpacity>
                )}

                {/* ── Inputs ────────────────────────────────────────────────── */}
                <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
                  {/* Receipt Number — auto for Cash, user-entry for all others */}
                  <View style={s.receiptLabelRow}>
                    <Text style={s.inputLabel}>
                      {isCash ? _t("Receipt Number (auto-generated)") : _t("{paymentMethod} Reference / Transaction No. *", { paymentMethod })}
                    </Text>
                    {isCash && (
                      <TouchableOpacity onPress={() => setReceiptInput(genCashReceipt())} style={s.regenBtn}>
                        <MaterialIcons name="refresh" size={14} color="#0f4c81" />
                        <Text style={s.regenBtnText}>{_t("Regenerate")}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={[s.inputWrap, isCash && s.inputWrapAuto]}>
                    <MaterialIcons
                      name={isCash ? 'auto-awesome' : 'tag'}
                      size={16}
                      color={isCash ? '#15803d' : '#94a3b8'}
                      style={s.inputIcon}
                    />
                    <TextInput
                      style={[s.inputText, isCash && { color: '#15803d', fontStyle: 'italic' }]}
                      placeholder={isCash ? _t("Auto-generated") : _t("Enter {paymentMethod} ref / UTR no.", { paymentMethod })}
                      placeholderTextColor="#94a3b8"
                      value={receiptInput}
                      onChangeText={setReceiptInput}
                      editable={!isCash}
                      autoCorrect={false}
                      autoCapitalize="characters"
                    />
                    {!isCash && (
                      <View style={s.requiredDot} />
                    )}
                  </View>
                  {!isCash && (
                    <Text style={s.receiptHint}>{_t("Enter the UTR / transaction ID shown on your {paymentMethod} app after payment.", { paymentMethod })}</Text>
                  )}

                  <View style={s.twoCol}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>{_t("Paid Amount *")}</Text>
                      <View style={[s.inputWrap, overpaid && s.inputWrapError]}>
                        <MaterialIcons name="currency-rupee" size={16} color="#94a3b8" style={s.inputIcon} />
                        <TextInput
                          style={s.inputText}
                          placeholder={_t("Max {cartTotal}", { cartTotal: fmtCurr(cartTotal, currSym) })}
                          placeholderTextColor="#94a3b8"
                          value={paidInput}
                          onChangeText={setPaidInput}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>
                    <View style={{ width: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.inputLabel}>{_t("Balance")}</Text>
                      <View style={[s.inputWrap, s.inputWrapReadonly]}>
                        <MaterialIcons name="pending-actions" size={16} color="#b91c1c" style={s.inputIcon} />
                        <Text style={[s.inputText, { color: balanceAmt > 0 ? '#b91c1c' : '#15803d', fontWeight: '800', paddingTop: 13 }]}>
                          {fmtCurr(balanceAmt, currSym)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {overpaid && (
                    <Text style={s.overpaidWarning}>{_t("⚠️  Amount exceeds the selected total of {cartTotal}", { cartTotal: fmtCurr(cartTotal, currSym) })}</Text>
                  )}

                  <Text style={s.inputLabel}>{_t("Payment Date")}</Text>
                  <View style={s.inputWrap}>
                    <MaterialIcons name="event" size={16} color="#94a3b8" style={s.inputIcon} />
                    <TextInput
                      style={s.inputText}
                      placeholder={_t("YYYY-MM-DD")}
                      placeholderTextColor="#94a3b8"
                      value={paymentDate}
                      onChangeText={setPaymentDate}
                    />
                  </View>
                </Animated.View>

                {/* Balance note */}
                {balanceAmt > 0 && paidAmt > 0 && (
                  <View style={s.balanceNote}>
                    <MaterialIcons name="info-outline" size={15} color="#0f4c81" />
                    <Text style={s.balanceNoteText}>{_t("A partial payment row will be created for the remaining {balanceAmt}.", { balanceAmt: fmtCurr(balanceAmt, currSym) })}</Text>
                  </View>
                )}

                {/* Submit */}
                {canCollect ? (
                <TouchableOpacity
                  style={[s.submitBtn, submitting && { opacity: 0.65 }]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <MaterialIcons name="check-circle" size={20} color="#fff" style={{ marginRight: 10 }} />
                        <Text style={s.submitBtnText}>{_t("{v}  Record {paymentMethod} · {v2}", { v: paymentMethod === 'Cash' ? '💵' :
                           paymentMethod === 'Card' ? '💳' :
                           ['PhonePe','Google Pay','Paytm'].includes(paymentMethod) ? '📱' : '🏦', paymentMethod, v2: fmtCurr(paidAmt || cartTotal, currSym) })}</Text>
                      </>}
                </TouchableOpacity>
                ) : (
                <View style={s.notAllowedBanner}>
                  <MaterialIcons name="lock" size={16} color="#b45309" />
                  <Text style={s.notAllowedText}>{_t("You are not allowed to collect fees.")}</Text>
                </View>
                )}
              </>
            )}
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PAYMENT HISTORY
        ════════════════════════════════════════════════════════════════════ */}
        <View style={[s.sectionHeader, { marginTop: 24 }]}>
          <View style={s.sectionHeaderLeft}>
            <View style={[s.sectionDot, { backgroundColor: '#15803d' }]} />
            <Text style={s.sectionTitle}>{_t("Payment History")}</Text>
            {paidRecords.length > 0 && (
              <View style={[s.sectionBadge, { backgroundColor: '#15803d' }]}>
                <Text style={s.sectionBadgeText}>{_tx(paidRecords.length)}</Text>
              </View>
            )}
          </View>
        </View>

        {paidRecords.length === 0 ? (
          <View style={s.emptyDue}>
            <MaterialIcons name="receipt-long" size={36} color="#94a3b8" />
            <Text style={s.emptyDueText}>{_t("No payments recorded yet.")}</Text>
          </View>
        ) : (
          paidRecords.map((rec, idx) => (
            <ReceiptRow key={rec.receipt_number ?? idx} record={rec} onPress={() => openReceipt(rec)} onEmail={openEmailModal} currSym={currSym} />
          ))
        )}

        <View style={{ height: 50 }} />
      </ScrollView>

      {/* ═══════════════════════════════════════════════════════════════════════
          UPI QR CODE MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      <UpiQrModal
        visible={qrModal}
        amount={paidAmt > 0 ? paidAmt : cartTotal}
        upiId={UPI_ID}
        merchantName={MERCHANT_NAME}
        paymentMethod={paymentMethod}
        studentName={student_name ?? ''}
        receiptNumber={receiptInput}
        onClose={() => setQrModal(false)}
        onConfirm={() => { setQrModal(false); handleSubmit(); }}
      />

      {/* ═══════════════════════════════════════════════════════════════════════
          EMAIL RECEIPT MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={emailModal}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={() => setEmailModal(false)}
      >
        <View style={s.emailOverlay}>
          <TouchableOpacity style={s.emailBackdrop} onPress={() => setEmailModal(false)} activeOpacity={1} />
          <View style={s.emailSheet}>

            {/* Header */}
            <View style={s.emailHeader}>
              <View style={s.emailIconWrap}>
                <MaterialIcons name="mark-email-unread" size={22} color="#0f4c81" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.emailTitle}>{_t("Email Receipt")}</Text>
                <Text style={s.emailSub}>{_t("Receipt #{v}", { v: emailRecord?.receipt_number || '—' })}</Text>
              </View>
              <TouchableOpacity style={s.emailCloseBtn} onPress={() => setEmailModal(false)}>
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Payment summary strip */}
            <View style={s.emailSummaryStrip}>
              <View style={s.emailSummaryCell}>
                <Text style={s.emailSummaryLabel}>{_t("Paid")}</Text>
                <Text style={[s.emailSummaryValue, { color: '#15803d' }]}>{fmtCurr((emailRecord?.total_paid + emailRecord?.total_late_fee, currSym) ?? emailRecord?.fee_paid_amount + emailRecord?.fee_late_fee)}</Text>
              </View>
              <View style={s.emailSummaryDivider} />
              <View style={s.emailSummaryCell}>
                <Text style={s.emailSummaryLabel}>{_t("Balance")}</Text>
                <Text style={[s.emailSummaryValue, {
                  color: parseFloat(emailRecord?.total_balance ?? emailRecord?.balance_amount ?? 0) > 0 ? '#b91c1c' : '#15803d'
                }]}>{fmtCurr(emailRecord?.total_balance ?? emailRecord?.balance_amount, currSym)}</Text>
              </View>
              <View style={s.emailSummaryDivider} />
              <View style={s.emailSummaryCell}>
                <Text style={s.emailSummaryLabel}>{_t("Items")}</Text>
                <Text style={s.emailSummaryValue} numberOfLines={1}>{_tx(emailRecord?.items?.length) ?? 1}</Text>
              </View>
            </View>

            {/* Email input */}
            <Text style={s.emailFieldLabel}>{_t("Send to Email Address")}</Text>
            <View style={s.emailInputRow}>
              <MaterialIcons name="mail-outline" size={18} color="#94a3b8" style={{ marginLeft: 12, marginRight: 8 }} />
              <TextInput
                style={s.emailInput}
                placeholder="guardian@example.com"
                placeholderTextColor="#94a3b8"
                value={emailAddr}
                onChangeText={setEmailAddr}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {emailAddr.length > 0 && (
                <TouchableOpacity onPress={() => setEmailAddr('')} style={{ paddingRight: 12 }}>
                  <MaterialIcons name="cancel" size={18} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.emailHint}>{_t("A full HTML receipt with payment breakdown will be delivered to this address.")}</Text>

            {/* Buttons */}
            <View style={s.emailFooterRow}>
              <TouchableOpacity style={s.emailCancelBtn} onPress={() => setEmailModal(false)}>
                <Text style={s.emailCancelText}>{_t("Cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.emailSendBtn, sendingEmail && { opacity: 0.65 }]}
                onPress={handleSendEmail}
                disabled={sendingEmail}
              >
                {sendingEmail
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                      <MaterialIcons name="send" size={18} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={s.emailSendText}>{_t("Send Receipt")}</Text>
                    </>}
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          RECEIPT DETAIL MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      <ReceiptDetailModal
        visible={receiptModal}
        record={receiptRecord}
        onClose={() => setReceiptModal(false)}
        className={dueItems[0]?.class_name   ?? route?.params?.className ?? String(class_id   ?? '')}
        sessionName={dueItems[0]?.session_name ?? String(session_id ?? '')}
        branchName={dueItems[0]?.branch_name   ?? String(branch_id  ?? '')}
        currSym={currSym}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ─── Student Info Card ───────────────────────────────────────────────────────
function StudentInfoCard({
  studentsName, enrollmentId, className, sessionId, branchId, clientCode,
  totalDue, totalPaid, currSym = currencySymbol(),
}) {
  // Derive initials from name for avatar
  const initials = (studentsName ?? 'S')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const fullyPaid = totalDue <= 0;

  return (
    <View style={si.card}>
      {/* Decorative top stripe */}
      <View style={si.topStripe} />
        
      <View style={si.body}>
        {/* Avatar + name block */}
        <View style={si.avatarRow}>
          <View style={si.avatar}>
            <Text style={si.avatarText}>{_tx(initials)}</Text>
          </View>
          <View style={{ flex: 1 }}>

            <Text style={si.studentName} numberOfLines={1}>{_tx(studentsName) ?? '—'}</Text>
            <View style={si.enrollRow}>
              <MaterialIcons name="badge" size={13} color="#64748b" />
              <Text style={si.enrollText}>{_tx(enrollmentId) ?? '—'}</Text>
                <View style={si.chipsRow}>
            
          {<InfoChip icon="class"            label={_t("Fee Type:")}   value='Hostel Fee'   />}
          {className  ? <InfoChip icon="class"            label={_t("Class:")}   value={className}   /> : null}
          {sessionId? <InfoChip icon="date-range"       label={_t("Session")} value={sessionId} /> : null}
          {branchId ? <InfoChip icon="account-balance"  label={_t("Branch")}  value={branchId}  /> : null}
          {clientCode?<InfoChip icon="business"         label={_t("Code")}    value={clientCode}/> : null}
        </View>
            </View>
          </View>

          {/* Fee status badge */}
          <View style={[si.statusBadge, { backgroundColor: fullyPaid ? '#dcfce7' : '#fee2e2' }]}>
            <MaterialIcons
              name={fullyPaid ? 'check-circle' : 'pending-actions'}
              size={14}
              color={fullyPaid ? '#15803d' : '#b91c1c'}
            />
            <Text style={[si.statusBadgeText, { color: fullyPaid ? '#15803d' : '#b91c1c' }]}>
              {fullyPaid ? _t("Paid") : _t("Due")}
            </Text>
          </View>
        </View>

        {/* Detail chips row */}
        {/* <View style={si.chipsRow}>
          {className  ? <InfoChip icon="class"            label="Class:"   value={className}   /> : null}
          {sessionId? <InfoChip icon="date-range"       label="Session" value={sessionId} /> : null}
          {branchId ? <InfoChip icon="account-balance"  label="Branch"  value={branchId}  /> : null}
          {clientCode?<InfoChip icon="business"         label="Code"    value={clientCode}/> : null}
        </View> */}

        {/* Mini financials */}
        <View style={si.financialRow}>
          <View style={si.finCell}>
            <Text style={si.finLabel}>{_t("Due")}</Text>
            <Text style={[si.finValue, { color: totalDue > 0 ? '#b91c1c' : '#15803d' }]}>
              {_tx(currSym)} {parseFloat(totalDue || 0).toFixed(2)}
            </Text>
          </View>
          <View style={si.finDivider} />
          <View style={si.finCell}>
            <Text style={si.finLabel}>{" "}{_t("Paid")}</Text>
            <Text style={[si.finValue, { color: '#15803d' }]}>
              {_tx(currSym)} {parseFloat(totalPaid || 0).toFixed(2)}
            </Text>
          </View>
          <View style={si.finDivider} />
          <View style={si.finCell}>
            <Text style={si.finLabel}>{_t("Total")}</Text>
            <Text style={[si.finValue, { color: '#0f4c81' }]}>
              {_tx(currSym)} {(parseFloat(totalDue || 0) + parseFloat(totalPaid || 0)).toFixed(2)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function InfoChip({ icon, label, value }) {
  return (
    <View style={si.chip}>
      <MaterialIcons name={icon} size={11} color="#0f4c81" />
      <Text style={si.chipLabel}>{_tx(label)} </Text>
      <Text style={si.chipValue}>{_tx(value)}</Text>
    </View>
  );
}

function NavBar({ title, sub, onBack }) {
  return (
    <View style={s.navbar}>
      <TouchableOpacity style={s.backBtn} onPress={onBack}>
        <MaterialIcons name="arrow-back-ios" size={20} color="#0f4c81" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={s.navTitle} numberOfLines={1}>{_tx(title)}</Text>
        <Text style={s.navSub}>{_tx(sub)}</Text>
      </View>
    </View>
  );
}

function SumCell({ icon, label, value, light }) {
  return (
    <View style={s.sumCell}>
      <MaterialIcons name={icon} size={18} color={light ? 'rgba(255,255,255,0.85)' : '#0f4c81'} />
      <Text style={[s.sumValue, light && { color: '#fff' }]}>{_tx(value)}</Text>
      <Text style={[s.sumLabel,  light && { color: 'rgba(255,255,255,0.7)' }]}>{_tx(label)}</Text>
    </View>
  );
}

function MetaTag({ icon, label, warn }) {
  return (
    <View style={[s.metaTag, warn && s.metaTagWarn]}>
      <MaterialIcons name={icon} size={11} color={warn ? '#b45309' : '#64748b'} />
      <Text style={[s.metaTagText, warn && { color: '#b45309' }]}>{_tx(label)}</Text>
    </View>
  );
}

// Method icon/colour maps — module-level so they are not recreated on render
const METHOD_ICON_MAP = {
  Cash: 'payments', Card: 'credit-card', PhonePe: 'smartphone',
  'Google Pay': 'account-balance-wallet', Paytm: 'qr-code',
  'Bank Transfer': 'account-balance', Cheque: 'description',
};
const METHOD_COLOR_MAP = {
  Cash: '#15803d', Card: '#0f4c81', PhonePe: '#5f259f',
  'Google Pay': '#1a73e8', Paytm: '#00b9f5',
  'Bank Transfer': '#b45309', Cheque: '#475569',
};

function ReceiptRow({ record: r, onPress, onEmail, currSym = currencySymbol() }) {
  const rc         = rs(r.admin_review);
  const items      = r.items ?? [];
  const hasBalance = parseFloat(r.total_balance ?? 0) > 0;
  const hasLateFee = parseFloat(r.total_late_fee ?? 0) > 0;
  const ic         = METHOD_ICON_MAP[r.payment_method]  ?? 'payments';
  const co         = METHOD_COLOR_MAP[r.payment_method] ?? '#0f4c81';

  return (
    <TouchableOpacity style={s.receiptRow} onPress={onPress} activeOpacity={0.8}>
      {/* Left accent — amber if balance remains, green if fully paid */}
      <View style={[s.receiptRowAccent, { backgroundColor: hasBalance ? '#f59e0b' : '#15803d' }]} />

      <View style={s.receiptRowBody}>

        {/* ── Top row: receipt number + email icon + status pill ── */}
        <View style={s.receiptRowTop}>
          <TouchableOpacity style={s.receiptLink} onPress={onPress} activeOpacity={0.75}>
            <MaterialIcons name="receipt" size={14} color="#0f4c81" />
            <Text style={s.receiptLinkText}>#{_tx(r.receipt_number) || '—'}</Text>
            <MaterialIcons name="open-in-new" size={12} color="#0f4c81" />
          </TouchableOpacity>
          <View style={s.receiptRowActions}>
            {onEmail && (
              <TouchableOpacity style={s.emailIconBtn} onPress={() => onEmail(r)} activeOpacity={0.75}>
                <MaterialIcons name="email" size={16} color="#0f4c81" />
              </TouchableOpacity>
            )}
            <View style={[s.reviewPill, { backgroundColor: rc.bg, borderColor: rc.border }]}>
              <View style={[s.reviewDot, { backgroundColor: rc.text }]} />
              <Text style={[s.reviewPillText, { color: rc.text }]}>{_tx(r.admin_review) ?? _t("Pending")}</Text>
            </View>
          </View>
        </View>

        {/* ── Receipt-level totals strip ── */}
        <View style={s.receiptAmtRow}>
          <ReceiptAmt label={_t("Total Fee")}  value={fmtCurr(r.total_fee, currSym)} />
          {parseFloat(r.total_discount ?? 0) > 0 && (
            <ReceiptAmt label={_t("Discount")} value={`−${fmtCurr(r.total_discount, currSym)}`} green />
          )}
          {parseFloat(r.total_tax ?? 0) > 0 && (
            <ReceiptAmt label={_t("Tax")} value={fmtCurr(r.total_tax, currSym)} blue />
          )}
          <ReceiptAmt label={_t("Collected")}  value={fmtCurr(r.total_collected ?? r.total_paid, currSym)} green />
          {hasLateFee && (
            <ReceiptAmt label={_t("Late Fee")} value={fmtCurr(r.total_late_fee, currSym)} warn />
          )}
          <ReceiptAmt label={_t("Balance")}    value={fmtCurr(r.total_balance, currSym)}
            red={hasBalance} green={!hasBalance} />
        </View>

        {/* ── Per-item breakdown ── */}
        {items.length > 0 && (
          <View style={s.receiptItemsList}>
            {items.map((item, idx) => {
              const bal      = parseFloat(item.balance_amount ?? 0);
              const late     = parseFloat(item.late_fee ?? 0);
              const thisPaid = parseFloat(item.paid_amount ?? 0);   // this receipt only
              const allPaid  = parseFloat(item.total_paid  ?? thisPaid); // all-time total
              return (
                <View key={item.trxn_id ?? idx}
                  style={[s.receiptItemRow, idx === items.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.receiptItemName} numberOfLines={1}>
                      {_tx(item.fee_item_name)}
                      {item.month_no ? `  ·  ${_tx(item.month_no)}` : ''}
                    </Text>
                    <Text style={s.receiptItemFee}>{_t("Fee {fee_amount}", { fee_amount: fmtCurr(item.fee_amount, currSym) })}</Text>
                    {parseFloat(item.discount_amount ?? 0) > 0 && (
                      <Text style={[s.receiptItemFee, { color: '#16a34a' }]}>{_t("Disc −{discount_amount}{v}", { discount_amount: fmtCurr(item.discount_amount, currSym), v: parseFloat(item.discount_percent ?? 0) > 0
                          ? ` (${fmt(item.discount_percent)}%)` : '' })}</Text>
                    )}
                    {parseFloat(item.tax_amount ?? 0) > 0 && (
                      <Text style={[s.receiptItemFee, { color: '#0f4c81' }]}>{_t("Tax +{tax_amount}{v}", { tax_amount: fmtCurr(item.tax_amount, currSym), v: parseFloat(item.tax_percent ?? 0) > 0
                          ? ` (${fmt(item.tax_percent)}%)` : '' })}</Text>
                    )}
                  </View>
                  <View style={s.receiptItemRight}>
                    {/* This receipt's payment */}
                    <Text style={[s.receiptItemPaid, { color: '#15803d' }]}>{_t("Paid {thisPaid}", { thisPaid: fmtCurr(thisPaid, currSym) })}</Text>
                    {/* All-time paid — shown only when differs from this receipt */}
                    {allPaid > thisPaid && (
                      <Text style={[s.receiptItemPaid, { color: '#475569', fontSize: 10 }]}>{_t("Total paid {allPaid}", { allPaid: fmtCurr(allPaid, currSym) })}</Text>
                    )}
                    {late > 0 && (
                      <Text style={[s.receiptItemPaid, { color: '#b45309' }]}>{_t("Late {late}", { late: fmtCurr(late, currSym) })}</Text>
                    )}
                    {/* Balance pill: based on true_balance from backend (fee_structure − all payments) */}
                    <View style={[s.receiptItemBalancePill,
                      { backgroundColor: bal > 0 ? '#fef3c7' : '#dcfce7' }]}>
                      <Text style={[s.receiptItemBalanceText,
                        { color: bal > 0 ? '#b45309' : '#15803d' }]}>
                        {bal > 0 ? _t("Bal {bal}", { bal: fmtCurr(bal, currSym) }) : _t("✓ Cleared")}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Footer: date + item count + payment method ── */}
        <View style={s.receiptMeta}>
          <MetaTag icon="event" label={fmtDate(r.payment_date)} />
          <MetaTag icon="receipt" label={_t("{length} item{pl}", { length: items.length, pl: items.length !== 1 ? 's' : '' })} />
          <View style={[s.methodHistoryBadge, { backgroundColor: co + '14', borderColor: co + '40' }]}>
            <MaterialIcons name={ic} size={11} color={co} />
            <Text style={[s.methodHistoryText, { color: co }]}>{_tx(r.payment_method) || _t("Cash")}</Text>
          </View>
          {hasBalance && (
            <View style={s.partialBadge}><Text style={s.partialBadgeText}>{_t("Partial")}</Text></View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function ReceiptAmt({ label, value, green, red, warn, blue }) {
  const color = green ? '#15803d' : red ? '#b91c1c' : warn ? '#b45309' : blue ? '#0f4c81' : '#475569';
  return (
    <View style={s.receiptAmtCell}>
      <Text style={s.receiptAmtLabel}>{_tx(label)}</Text>
      <Text style={[s.receiptAmtValue, { color }]}>{_tx(value)}</Text>
    </View>
  );
}

// ─── UPI QR Code Modal ───────────────────────────────────────────────────────
/**
 * Generates a standard UPI deep-link URI and renders it as a QR code
 * using the free api.qrserver.com service (no API key needed).
 *
 * UPI URI format:  upi://pay?pa=VPA&pn=NAME&am=AMOUNT&cu=INR&tn=NOTE
 * Works with PhonePe, Google Pay, Paytm, BHIM and all UPI apps.
 *
 * Install: expo install react-native-webview
 */
function UpiQrModal({ visible, amount, upiId, merchantName, paymentMethod, studentName, receiptNumber, onClose, onConfirm, currSym = currencySymbol() }) {
  const amtStr  = parseFloat(amount || 0).toFixed(2);
  const note    = encodeURIComponent(`Fee: ${studentName}${receiptNumber ? ' / ' + receiptNumber : ''}`);
  const upiUri  = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${amtStr}&cu=INR&tn=${note}`;

  // QR image via free public API — no key needed, works offline-tolerantly
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(upiUri)}&format=png&margin=16`;

  const METHOD_COLOR = {
    PhonePe:      '#5f259f',
    'Google Pay': '#1a73e8',
    Paytm:        '#00b9f5',
  };
  const accent = METHOD_COLOR[paymentMethod] ?? '#0f4c81';

  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError,  setImgError]  = useState(false);

  // Reset state when modal opens
  React.useEffect(() => {
    if (visible) { setImgLoaded(false); setImgError(false); }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={sq.overlay}>
        <View style={sq.sheet}>

          {/* Header */}
          <View style={sq.header}>
            <View style={[sq.headerIcon, { backgroundColor: accent + '18' }]}>
              <MaterialIcons name="qr-code-2" size={26} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={sq.headerTitle}>{_t("Pay via {paymentMethod}", { paymentMethod })}</Text>
              <Text style={sq.headerSub}>{_t("Scan with any UPI app")}</Text>
            </View>
            <TouchableOpacity style={sq.closeBtn} onPress={onClose}>
              <MaterialIcons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Amount pill */}
          <View style={[sq.amountPill, { borderColor: accent }]}>
            <Text style={sq.amountPillLabel}>{_t("Amount to Pay")}</Text>
            <Text style={[sq.amountPillValue, { color: accent }]}>{_tx(currSym)} {_tx(amtStr)}</Text>
          </View>

          {/* QR code */}
          <View style={sq.qrWrap}>
            {!imgLoaded && !imgError && (
              <View style={sq.qrLoader}>
                <ActivityIndicator size="large" color={accent} />
                <Text style={sq.qrLoaderText}>{_t("Generating QR…")}</Text>
              </View>
            )}
            {imgError ? (
              <View style={sq.qrError}>
                <MaterialIcons name="wifi-off" size={40} color="#94a3b8" />
                <Text style={sq.qrErrorText}>{_t("Could not load QR code.")}</Text>
                <Text style={sq.qrErrorSub}>{_t("Check your internet connection.")}</Text>
              </View>
            ) : (
              <Image
                source={{ uri: qrUrl }}
                style={[sq.qrImage, !imgLoaded && { opacity: 0 }]}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
                resizeMode="contain"
              />
            )}
          </View>

          {/* UPI ID display */}
          <View style={sq.upiRow}>
            <MaterialIcons name="account-balance-wallet" size={15} color="#64748b" />
            <Text style={sq.upiLabel}>{_t("UPI ID:")}{" "}</Text>
            <Text style={sq.upiId}>{_tx(upiId)}</Text>
          </View>

          {/* Instructions */}
          <View style={sq.steps}>
            {[
              _t("Open {paymentMethod} on your phone", { paymentMethod }),
              'Tap "Scan QR" or "Pay"',
              _t("Verify amount {currSym}{amtStr} and confirm", { currSym, amtStr }),
              'Share screenshot / transaction ID for receipt',
            ].map((step, i) => (
              <View key={i} style={sq.step}>
                <View style={[sq.stepNum, { backgroundColor: accent }]}>
                  <Text style={sq.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={sq.stepText}>{_tx(step)}</Text>
              </View>
            ))}
          </View>

          {/* Footer actions */}
          <View style={sq.footer}>
            <TouchableOpacity style={sq.cancelBtn} onPress={onClose}>
              <Text style={sq.cancelBtnText}>{_t("Cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[sq.confirmBtn, { backgroundColor: accent }]} onPress={onConfirm}>
              <MaterialIcons name="check-circle" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={sq.confirmBtnText}>{_t("Payment Done — Record It")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Receipt Detail Modal ─────────────────────────────────────────────────────
function ReceiptDetailModal({ visible, record: r, onClose, className, sessionName, branchName, currSym = currencySymbol() }) {
  if (!r) return null;
  const rc         = rs(r.admin_review);
  const items      = r.items ?? [];
  const hasBalance = parseFloat(r.total_balance ?? 0) > 0;
  const hasLateFee = parseFloat(r.total_late_fee ?? 0) > 0;
  const methodIcon  = METHOD_ICON_MAP[r.payment_method]  ?? 'payments';
  const methodColor = METHOD_COLOR_MAP[r.payment_method] ?? '#0f4c81';

  const Field = ({ label, value, highlight }) => (
    <View style={s.detailField}>
      <Text style={s.detailFieldLabel}>{_tx(label)}</Text>
      <Text style={[s.detailFieldValue, highlight && { color: '#0f4c81', fontWeight: '800' }]}>
        {_tx(value) ?? '—'}
      </Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent={false} animationType="slide"
      presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.modalRoot}>

        {/* ── Header ── */}
        <View style={s.modalHeader}>
          <View style={s.modalHeaderLeft}>
            <View style={s.modalIconWrap}>
              <MaterialIcons name="receipt-long" size={22} color="#0f4c81" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.modalTitle}>{_t("Receipt #{receipt_number}", { receipt_number: r.receipt_number })}</Text>
              <Text style={s.modalSubtitle}>{_t("{length} fee item{pl}  ·  {payment_date}", { length: items.length, pl: items.length !== 1 ? 's' : '', payment_date: fmtDate(r.payment_date) })}</Text>
            </View>
          </View>
          <TouchableOpacity style={s.modalCloseBtn} onPress={onClose}>
            <MaterialIcons name="close" size={22} color="#64748b" />
          </TouchableOpacity>
        </View>
        <View style={s.modalDivider} />

        <ScrollView style={s.modalBody} contentContainerStyle={s.modalBodyContent}
          showsVerticalScrollIndicator={false}>

          {/* ── Status + payment method ── */}
          <View style={[s.receiptStatusBanner, { backgroundColor: rc.bg, borderColor: rc.border }]}>
            <View style={[s.reviewDot, { backgroundColor: rc.text, width: 10, height: 10 }]} />
            <Text style={[s.receiptStatusText, { color: rc.text }]}>{_tx(r.admin_review) ?? _t("Pending")}</Text>
            <View style={{ flex: 1 }} />
            <View style={[s.detailMethodBadge,
              { backgroundColor: methodColor + '18', borderColor: methodColor + '40' }]}>
              <MaterialIcons name={methodIcon} size={13} color={methodColor} />
              <Text style={[s.detailMethodText, { color: methodColor }]}>
                {_tx(r.payment_method) || _t("Cash")}
              </Text>
            </View>
            {hasBalance && (
              <View style={[s.partialBadge, { marginLeft: 8 }]}>
                <Text style={s.partialBadgeText}>{_t("Partial")}</Text>
              </View>
            )}
          </View>

          {/* ── Receipt-level totals grid ── */}
          <View style={s.receiptAmtGrid}>
            <AmountBox label={_t("Total Fee")}  value={fmtCurr(r.total_fee, currSym)}                          color="#0f4c81" />
            {parseFloat(r.total_discount ?? 0) > 0 && (
              <AmountBox label={_t("Discount")} value={`−${fmtCurr(r.total_discount, currSym)}`}               color="#15803d" />
            )}
            {parseFloat(r.total_tax ?? 0) > 0 && (
              <AmountBox label={taxLabel()} value={fmtCurr(r.total_tax, currSym)}                          color="#0f4c81" />
            )}
            {hasLateFee && (
              <AmountBox label={_t("Late Fee")}  value={fmtCurr(r.total_late_fee, currSym)}                     color="#a16207" />
            )}
            <AmountBox label={_t("Collected")}  value={fmtCurr(r.total_collected ?? r.total_paid, currSym)}    color="#15803d" />
            <AmountBox label={_t("Balance")}    value={fmtCurr(r.total_balance, currSym)}
              color={hasBalance ? '#b91c1c' : '#15803d'} />
          </View>

          {/* ── Per-item breakdown ── */}
          <DetailSection label={_t("FEE ITEMS ({length})", { length: items.length })}>
            {items.map((item, idx) => {
              const bal = parseFloat(item.balance_amount ?? 0);
              return (
                <View key={item.trxn_id ?? idx}
                  style={[s.detailItemRow,
                    idx === items.length - 1 && { borderBottomWidth: 0 }]}>
                  {/* Left: name + fee breakdown */}
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={s.detailItemName}>
                      {_tx(item.fee_item_name)}
                      {item.month_no ? `  ·  ${_tx(item.month_no)}` : ''}
                    </Text>
                    <Text style={s.detailItemMeta}>{_t("Fee {fee_amount}", { fee_amount: fmtCurr(item.fee_amount, currSym) })}</Text>
                    {parseFloat(item.discount_amount ?? 0) > 0 && (
                      <Text style={[s.detailItemMeta, { color: '#16a34a' }]}>{_t("Discount −{discount_amount}{v}", { discount_amount: fmtCurr(item.discount_amount, currSym), v: parseFloat(item.discount_percent ?? 0) > 0
                          ? ` (${fmt(item.discount_percent)}%)` : '' })}</Text>
                    )}
                    {parseFloat(item.tax_amount ?? 0) > 0 && (
                      <Text style={[s.detailItemMeta, { color: '#0f4c81' }]}>{_t("Tax +{tax_amount}{v}", { tax_amount: fmtCurr(item.tax_amount, currSym), v: parseFloat(item.tax_percent ?? 0) > 0
                          ? ` (${fmt(item.tax_percent)}%)` : '' })}</Text>
                    )}
                    {parseFloat(item.late_fee ?? 0) > 0 && (
                      <Text style={[s.detailItemMeta, { color: '#b45309' }]}>{_t("Late Fee +{late_fee}", { late_fee: fmtCurr(item.late_fee, currSym) })}</Text>
                    )}
                  </View>
                  {/* Right: paid + balance pill */}
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[s.detailFieldValue, { color: '#15803d' }]}>{_t("Paid {paid_amount}", { paid_amount: fmtCurr(item.paid_amount, currSym) })}</Text>
                    <View style={[s.receiptItemBalancePill,
                      { backgroundColor: bal > 0 ? '#fef3c7' : '#dcfce7' }]}>
                      <Text style={[s.receiptItemBalanceText,
                        { color: bal > 0 ? '#b45309' : '#15803d' }]}>
                        {bal > 0 ? _t("Bal {bal}", { bal: fmtCurr(bal, currSym) }) : _t("✓ Cleared")}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </DetailSection>

          {/* ── Payment info ── */}
          <DetailSection label={_t("PAYMENT INFO")}>
            <Field label={_t("Receipt Number")} value={r.receipt_number} highlight />
            <Field label={_t("Payment Date")}   value={fmtDate(r.payment_date)} />
            <Field label={_t("Fee Paid Date")}  value={fmtDate(r.fee_paid_date)} />
            <Field label={_t("Recorded By")}    value={r.admin_user} />
          </DetailSection>

          {/* ── Reference ── */}
          <DetailSection label={_t("REFERENCE")}>
            <Field label={_t("Enrollment")}   value={r.enrollment_id} />
            <Field label={_t("Class")}        value={className   || String(r.class_id   ?? '—')} />
            <Field label={_t("Branch")}       value={branchName  || String(r.branch_id  ?? '—')} />
            <Field label={_t("Session")}      value={sessionName || String(r.session_id ?? '—')} />
            <Field label={_t("Collected By")} value={r.ssms_user_name || r.admin_user || '—'} />
          </DetailSection>

          {/* ── Admin review ── */}
          <DetailSection label={_t("ADMIN REVIEW")}>
            <Field label={_t("Status")}      value={r.admin_review} />
            <Field label={_t("Reviewed By")} value={r.admin_user} />
            <Field label={_t("Review Date")} value={fmtDate(r.admin_review_date)} />
          </DetailSection>

          <TouchableOpacity style={s.closeReceiptBtn} onPress={onClose}>
            <Text style={s.closeReceiptBtnText}>{_t("Close")}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function AmountBox({ label, value, color }) {
  return (
    <View style={s.amountBox}>
      <Text style={s.amountBoxLabel}>{_tx(label)}</Text>
      <Text style={[s.amountBoxValue, { color }]}>{_tx(value)}</Text>
    </View>
  );
}

function DetailSection({ label, children }) {
  return (
    <View style={s.detailSection}>
      <Text style={s.detailSectionLabel}>{_tx(label)}</Text>
      <View style={s.detailSectionBody}>{children}</View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#f0f4f8' },
  scroll:{ flex: 1 },
  scrollContent: { padding: 16, paddingTop: 14, paddingBottom: 80 },

  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  loaderText: { marginTop: 12, color: '#64748b', fontSize: 13 },

  // Navbar
  navbar:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingTop: Platform.OS === 'ios' ? 52 : 20, paddingBottom: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#e8f0fe', gap: 10, elevation: 3, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  backBtn:    { width: 38, height: 38, borderRadius: 12, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  navTitle:   { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  navSub:     { fontSize: 12, color: '#64748b', marginTop: 1 },

  // Summary banner
  summaryBanner: { flexDirection: 'row', backgroundColor: '#1e3a8a', borderRadius: 20, padding: 18, marginBottom: 20, elevation: 5, shadowColor: '#0f4c81', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  sumCell:       { flex: 1, alignItems: 'center' },
  sumDivider:    { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },
  sumValue:      { fontSize: 14, fontWeight: '800', color: '#fff', marginTop: 4 },
  sumLabel:      { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 3, fontWeight: '600' },

  // Section headers
  sectionHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionDot:        { width: 10, height: 10, borderRadius: 5 },
  sectionTitle:      { fontSize: 13, fontWeight: '800', color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionBadge:      { backgroundColor: '#b91c1c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  sectionBadgeText:  { fontSize: 11, fontWeight: '800', color: '#fff' },
  selectAllText:     { fontSize: 12, color: '#1e40af', fontWeight: '700' },

  emptyDue:     { alignItems: 'center', paddingVertical: 30, backgroundColor: '#fff', borderRadius: 18, marginBottom: 16 },

  // Late fee per-item UI
  lateFeeRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fffbeb',
                      borderRadius: 8, padding: 7, marginTop: 6, marginBottom: 8,
                      borderWidth: 1, borderColor: '#fde68a' },
  lateFeeLabel:     { fontSize: 12, fontWeight: '700', color: '#b45309' },
  lateFeeInputWrap: { flexDirection: 'row', alignItems: 'center', flex: 1, backgroundColor: '#fff',
                      borderRadius: 6, borderWidth: 1, borderColor: '#fcd34d', paddingHorizontal: 8, height: 32 },
  lateFeeRupee:     { fontSize: 13, color: '#b45309', fontWeight: '700', marginRight: 3 },
  lateFeeInput:     { flex: 1, fontSize: 13, color: '#b45309', fontWeight: '700', paddingVertical: 0 },
  lateFeeClear:     { padding: 4 },
  lateFeeBreakdown: { fontSize: 10, color: '#b45309', fontWeight: '600', marginBottom: 2 },
  emptyDueText: { marginTop: 10, fontSize: 13, color: '#64748b', fontWeight: '600' },

  // Due fee card
  dueCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#fff', borderRadius: 18, padding: 14,
    marginBottom: 10, borderWidth: 1.5, borderColor: '#e2e8f0',
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  dueCardSelected: {
    borderColor: '#0f4c81', backgroundColor: '#f0f7ff',
    elevation: 4, shadowOpacity: 0.04,
  },
  checkbox:        { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 2, backgroundColor: '#fff' },
  checkboxChecked: { backgroundColor: '#0f4c81', borderColor: '#0f4c81' },

  dueCardContent:  { flex: 1 },
  dueCardTopRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dueItemName:     { fontSize: 13, fontWeight: '700', color: '#1946b2', flex: 1 },
  overdueBadge:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef3c7', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, gap: 3, marginLeft: 8 },
  overdueBadgeText:{ fontSize: 10, color: '#b45309', fontWeight: '700' },

  dueCardMetaRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  metaTag:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, gap: 4 },
  metaTagWarn:     { backgroundColor: '#fef3c7' },
  metaTagText:     { fontSize: 11, color: '#64748b', fontWeight: '500' },

  dueAmountRow:    { flexDirection: 'row', alignItems: 'center' },

  // Discount + tax badge row on due card
  discountRow:     { flexDirection: 'row', alignItems: 'center', gap: 6,
                     backgroundColor: '#f0fdf4', borderRadius: 8,
                     paddingHorizontal: 8, paddingVertical: 5, marginBottom: 6 },
  discountTxt:     { fontSize: 11, color: '#15803d', fontWeight: '600', flex: 1 },
  discountStrike:  { fontSize: 11, color: '#94a3b8', textDecorationLine: 'line-through', marginRight: 4 },
  discountSaved:   { fontSize: 11, color: '#15803d', fontWeight: '800' },
  prevPaidTag:     { backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  prevPaidText:    { fontSize: 11, color: '#15803d', fontWeight: '700' },
  dueAmountLabel:  { fontSize: 11, color: '#94a3b8', fontWeight: '600', marginRight: 6 },
  dueAmount:       { fontSize: 17, fontWeight: '900', color: '#b91c1c' },
  dueAmountSelected:{ color: '#0f4c81' },

  // Payment panel
  paymentPanel:       { backgroundColor: '#fff', borderRadius: 22, padding: 18, marginTop: 8, marginBottom: 4, borderWidth: 1.5, borderColor: '#e8f0fe', elevation: 4, shadowColor: '#0f4c81', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  cartSummaryRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cartSummaryLabel:   { fontSize: 13, color: '#64748b', fontWeight: '600' },
  cartTotal:          { fontSize: 24, fontWeight: '900', color: '#0f4c81', letterSpacing: -0.5 },
  cartBreakdown:      { backgroundColor: '#f8fafc', borderRadius: 14, padding: 12, marginTop: 12, marginBottom: 16 },
  cartBreakdownRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  cartBreakdownLabel: { fontSize: 13, color: '#475569', flex: 1, marginRight: 8 },
  cartBreakdownAmt:   { fontSize: 13, color: '#475569', fontWeight: '700' },
  cartBreakdownDivider:{ height: 1, backgroundColor: '#e2e8f0', marginVertical: 8 },

  inputLabel:   { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6 },
  inputWrap:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, marginBottom: 14, minHeight: 48 },
  inputWrapError:   { borderColor: '#ef4444', backgroundColor: '#fff5f5' },
  inputWrapReadonly:{ backgroundColor: '#f1f5f9' },
  inputIcon:    { marginLeft: 12, marginRight: 4 },
  inputText:    { flex: 1, fontSize: 15, color: '#0c1a2e', paddingVertical: 12, paddingRight: 12 },
  twoCol:       { flexDirection: 'row' },
  overpaidWarning: { fontSize: 12, color: '#b91c1c', fontWeight: '600', marginTop: -10, marginBottom: 10 },

  balanceNote:     { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#e8f0fe', borderRadius: 12, padding: 12, marginBottom: 16, gap: 8 },
  balanceNoteText: { flex: 1, fontSize: 13, color: '#0f4c81', lineHeight: 18 },

  submitBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f4c81', borderRadius: 16, paddingVertical: 17, elevation: 5, shadowColor: '#0f4c81', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  submitBtnText: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  notAllowedBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  notAllowedText:   { fontSize: 14, fontWeight: '600', color: '#b45309', flex: 1 },

  // Receipt row
  receiptRow:       { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0', elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  receiptRowAccent: { width: 5 },
  receiptRowBody:   { flex: 1, padding: 14 },
  receiptRowTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  receiptLink:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#e8f0fe', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  receiptLinkText:  { fontSize: 13, fontWeight: '800', color: '#0f4c81' },
  reviewPill:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14, borderWidth: 1.5, gap: 5 },
  reviewDot:        { width: 7, height: 7, borderRadius: 4 },
  reviewPillText:   { fontSize: 11, fontWeight: '700' },

  receiptAmtRow:    { flexDirection: 'row', gap: 4, marginBottom: 10 },
  receiptAmtCell:   { flex: 1, backgroundColor: '#f8fafc', borderRadius: 10, padding: 8, alignItems: 'center' },
  receiptAmtLabel:  { fontSize: 9, color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  receiptAmtValue:  { fontSize: 13, fontWeight: '800', marginTop: 3 },
  receiptMeta:      { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  partialBadge:     { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  partialBadgeText: { fontSize: 10, color: '#b45309', fontWeight: '800' },

  // Receipt detail modal
  modalRoot:       { flex: 1, backgroundColor: '#f0f4f8' },
  modalHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 18 : 20, paddingBottom: 16, backgroundColor: '#fff' },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  modalIconWrap:   { width: 44, height: 44, borderRadius: 14, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  modalTitle:      { fontSize: 19, fontWeight: '800', color: '#0c1a2e' },
  modalSubtitle:   { fontSize: 12, color: '#64748b', marginTop: 2 },
  modalCloseBtn:   { width: 38, height: 38, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  modalDivider:    { height: 1, backgroundColor: '#e2e8f0' },
  modalBody:       { flex: 1 },
  modalBodyContent:{ padding: 20, paddingBottom: Platform.OS === 'ios' ? 44 : 28 },

  receiptStatusBanner: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, marginBottom: 20, gap: 8, borderWidth: 1.5 },
  receiptStatusText:   { fontSize: 15, fontWeight: '800', flex: 1 },

  receiptAmtGrid:  { flexDirection: 'row', gap: 8, marginBottom: 24 },
  amountBox:       { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', elevation: 1 },
  amountBoxLabel:  { fontSize: 10, color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  amountBoxValue:  { fontSize: 15, fontWeight: '900', marginTop: 6 },

  detailSection:      { marginBottom: 20 },
  detailSectionLabel: { fontSize: 11, fontWeight: '800', color: '#0f4c81', letterSpacing: 1.2, marginBottom: 12 },
  detailSectionBody:  { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' },
  detailField:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  detailFieldLabel:   { fontSize: 13, color: '#64748b', fontWeight: '600' },
  detailFieldValue:   { fontSize: 13, color: '#0c1a2e', fontWeight: '700', textAlign: 'right', flex: 1, marginLeft: 12 },

  closeReceiptBtn:     { backgroundColor: '#0f4c81', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  closeReceiptBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Receipt row — per-item breakdown list
  receiptItemsList:       { borderTopWidth: 1, borderTopColor: '#f1f5f9', marginTop: 10, marginBottom: 4 },
  receiptItemRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  receiptItemName:        { fontSize: 13, fontWeight: '700', color: '#0c1a2e' },
  receiptItemFee:         { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  receiptItemRight:       { alignItems: 'flex-end', gap: 4 },
  receiptItemPaid:        { fontSize: 12, fontWeight: '700' },
  receiptItemBalancePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  receiptItemBalanceText: { fontSize: 11, fontWeight: '800' },

  // Receipt detail modal — item rows
  detailItemRow:  { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  detailItemName: { fontSize: 13, fontWeight: '700', color: '#0c1a2e' },
  detailItemMeta: { fontSize: 11, color: '#94a3b8', marginTop: 3 },

  // ReceiptRow email button
  receiptRowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emailIconBtn:      { width: 32, height: 32, borderRadius: 10, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },

  // Email receipt modal
  emailOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', justifyContent: 'flex-end' },
  emailBackdrop:      { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  emailSheet:         { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Platform.OS === 'ios' ? 38 : 24 },
  emailHeader:        { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  emailIconWrap:      { width: 44, height: 44, borderRadius: 14, backgroundColor: '#e8f0fe', alignItems: 'center', justifyContent: 'center' },
  emailTitle:         { fontSize: 18, fontWeight: '800', color: '#0c1a2e' },
  emailSub:           { fontSize: 12, color: '#64748b', marginTop: 2 },
  emailCloseBtn:      { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  emailSummaryStrip:  { flexDirection: 'row', marginHorizontal: 16, marginVertical: 14, backgroundColor: '#f8fafc', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  emailSummaryCell:   { flex: 1, alignItems: 'center' },
  emailSummaryDivider:{ width: 1, backgroundColor: '#e2e8f0', marginVertical: 2 },
  emailSummaryLabel:  { fontSize: 10, color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  emailSummaryValue:  { fontSize: 14, fontWeight: '800', color: '#0c1a2e', marginTop: 4 },
  emailFieldLabel:    { fontSize: 12, fontWeight: '700', color: '#374151', marginHorizontal: 16, marginBottom: 6 },
  emailInputRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 13, marginHorizontal: 16, minHeight: 50 },
  emailInput:         { flex: 1, fontSize: 14, color: '#0c1a2e', paddingVertical: 12 },
  emailHint:          { fontSize: 12, color: '#94a3b8', marginHorizontal: 16, marginTop: 6, marginBottom: 20, lineHeight: 17 },
  emailFooterRow:     { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  emailCancelBtn:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1.5, borderColor: '#e2e8f0' },
  emailCancelText:    { fontSize: 14, fontWeight: '700', color: '#475569' },
  emailSendBtn:       { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#0f4c81', elevation: 3, shadowColor: '#0f4c81', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  emailSendText:      { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Payment method badge in receipt detail modal
  detailMethodBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, alignSelf: 'flex-end' },
  detailMethodText:  { fontSize: 13, fontWeight: '700' },

  // Payment method badge in receipt history row
  methodHistoryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  methodHistoryText:  { fontSize: 11, fontWeight: '700' },

  // Receipt label row + hints
  receiptLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  regenBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e8f0fe', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  regenBtnText:    { fontSize: 11, color: '#0f4c81', fontWeight: '700' },
  inputWrapAuto:   { borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' },
  requiredDot:     { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444', marginRight: 12 },
  receiptHint:     { fontSize: 11, color: '#64748b', marginTop: -10, marginBottom: 14, lineHeight: 16 },

  // Payment method selector — 2 per row
  methodGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  methodBtn:        {
    width: '47%',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    position: 'relative',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    gap: 8,
  },
  methodBtnFull:    { width: '100%' },
  methodIconWrap:   { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  methodLabel:      { fontSize: 13, color: '#64748b', fontWeight: '600', textAlign: 'center' },
  methodCheck:      { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },

  // QR launch button
  qrLaunchBtn:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f0ff', borderWidth: 1.5, borderColor: '#c4b5fd', borderRadius: 14, padding: 14, marginBottom: 16, gap: 10 },
  qrLaunchText: { flex: 1, fontSize: 14, color: '#5f259f', fontWeight: '700' },
});

// ─── Student Info Card styles ────────────────────────────────────────────────
const si = StyleSheet.create({
  card:         {  flex: 1,backgroundColor: '#fff', marginHorizontal: 4, marginBottom: 0, borderRadius: 24, overflow: 'hidden', elevation: 4, shadowColor: '#0f4c81', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, borderWidth: 1, borderColor: '#25ae9c' },
  topStripe:    { height: 2, backgroundColor: '#0f4c81' },
  body:         { padding: 1 },
  separator: {
    marginVertical: 18,
    borderBottomColor: '#0eed46',
    borderBottomWidth: StyleSheet.hairlineWidth, // Best for a thin, crisp line
  },
  avatarRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  avatar:       { width: 52, height: 52, borderRadius: 16, backgroundColor: '#0f4c81', alignItems: 'center', justifyContent: 'center' },
  avatarText:   { fontSize: 20, fontWeight: '900', color: '#fff' },
  studentName:  { fontSize: 17, fontWeight: '800', color: '#0c1a2e', marginBottom: 4 },
  enrollRow:    { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  enrollText:   { fontSize: 12, color: '#64748b', fontWeight: '600' },
  enrollDivider:{ fontSize: 12, color: '#cbd5e1', marginHorizontal: 2 },

  statusBadge:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusBadgeText:  { fontSize: 12, fontWeight: '800' },

  chipsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  chip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f7ff', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, gap: 4, borderWidth: 1, borderColor: '#bfdbfe' },
  chipLabel:    { fontSize: 11, color: '#64748b', fontWeight: '600' },
  chipValue:    { fontSize: 11, color: '#0f4c81', fontWeight: '800' },

  financialRow: { flexDirection: 'row', backgroundColor: '#dfe7f0', borderRadius: 14, padding: 12 },
  finCell:      { flex: 1, alignItems: 'center' },
  finDivider:   { width: 1, backgroundColor: '#f9f9fa', marginVertical: 2 },
  finLabel:     { fontSize: 10, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  finValue:     { fontSize: 15, fontWeight: '900', letterSpacing: -0.3 },
});

// ─── UPI QR Modal styles ──────────────────────────────────────────────────────
const sq = StyleSheet.create({
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:          { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Platform.OS === 'ios' ? 36 : 24, maxHeight: '92%' },

  header:         { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 },
  headerIcon:     { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { fontSize: 20, fontWeight: '800', color: '#0c1a2e' },
  headerSub:      { fontSize: 13, color: '#64748b', marginTop: 2 },
  closeBtn:       { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },

  amountPill:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 20, backgroundColor: '#f8fafc', borderWidth: 1.5, borderRadius: 16, padding: 14 },
  amountPillLabel:{ fontSize: 13, color: '#64748b', fontWeight: '600' },
  amountPillValue:{ fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },

  qrWrap:         { alignItems: 'center', justifyContent: 'center', marginHorizontal: 20, marginBottom: 16, backgroundColor: '#fafafa', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', minHeight: 296 },
  qrLoader:       { alignItems: 'center', gap: 12, padding: 40 },
  qrLoaderText:   { fontSize: 14, color: '#64748b', fontWeight: '600' },
  qrImage:        { width: 280, height: 280 },
  qrError:        { alignItems: 'center', gap: 8, padding: 40 },
  qrErrorText:    { fontSize: 15, color: '#475569', fontWeight: '700' },
  qrErrorSub:     { fontSize: 13, color: '#94a3b8' },

  upiRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 20 },
  upiLabel:       { fontSize: 13, color: '#64748b' },
  upiId:          { fontSize: 13, fontWeight: '800', color: '#0c1a2e' },

  steps:          { marginHorizontal: 20, marginBottom: 20, gap: 10 },
  step:           { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum:        { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  stepNumText:    { fontSize: 12, fontWeight: '800', color: '#fff' },
  stepText:       { fontSize: 13, color: '#475569', lineHeight: 20, flex: 1 },

  footer:         { flexDirection: 'row', gap: 12, paddingHorizontal: 20 },
  cancelBtn:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1.5, borderColor: '#e2e8f0' },
  cancelBtnText:  { fontSize: 14, fontWeight: '700', color: '#475569' },
  confirmBtn:     { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14 },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});