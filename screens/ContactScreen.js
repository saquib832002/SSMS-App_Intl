// ============================================================
// screens/ContactScreen.js
// Public support-ticket form — no login required.
// Admin ticket management is in screens/SupportTicketsScreen.js
// ============================================================
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Keyboard, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BASE_URL } from "../Environment/EnvironmentConfig";

// ── Safe JSON parse (strips PHP warnings) ───────────────────────────────────
const safeJson = (raw) => {
  const idx = raw.indexOf('{');
  if (idx === -1) throw new Error('Non-JSON response from server.');
  return JSON.parse(raw.slice(idx));
};

const STATUS_COLORS = {
  'Open':        { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  'In Progress': { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  'Resolved':    { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  'Closed':      { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
};

// ── Field component ──────────────────────────────────────────────────────────
function Field({ label, required, icon, children }) {
  return (
    <View style={s.fieldWrap}>
      <Text style={s.label}>
        {label}
        {required && <Text style={{ color: '#dc2626' }}> *</Text>}
      </Text>
      <View style={s.inputBox}>
        {icon && <Feather name={icon} size={16} color="#64748b" style={{ marginRight: 8 }} />}
        {children}
      </View>
    </View>
  );
}

// ── Success card ─────────────────────────────────────────────────────────────
function SuccessCard({ ticketNumber, email, onNew, onBack, backLabel = '← Back to Login' }) {
  return (
    <View style={s.successCard}>
      <View style={s.successIcon}>
        <Feather name="check-circle" size={48} color="#16a34a" />
      </View>
      <Text style={s.successTitle}>Ticket Submitted!</Text>
      <Text style={s.successSub}>Your support request has been received.</Text>

      <View style={s.ticketBadge}>
        <Text style={s.ticketLabel}>Ticket Number</Text>
        <Text style={s.ticketNumber}>{ticketNumber}</Text>
      </View>

      <Text style={s.successNote}>
        A confirmation email has been sent to{'\n'}
        <Text style={{ fontWeight: '700', color: '#2563eb' }}>{email}</Text>
        {'\n\n'}Our team will respond within 24–48 hours.
      </Text>

      <TouchableOpacity style={s.newBtn} onPress={onNew}>
        <Feather name="plus" size={16} color="#fff" />
        <Text style={s.newBtnText}>  Submit Another</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.backBtn} onPress={onBack}>
        <Text style={s.backBtnText}>{backLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────
export default function ContactScreen({ navigation, route }) {
  // If opened from inside the app, we get auth headers from route.params
  const authToken    = route?.params?.token       ?? '';
  const userRole     = route?.params?.userRole    ?? '';
  const clientCode   = route?.params?.clientCode  ?? '';
  const userName     = route?.params?.userName    ?? 'Admin';
  const startInForm  = route?.params?.startInForm ?? false;
  const isAdminUser  = ['admin', 'owner'].includes(userRole.toLowerCase());

  // startInForm forces the submit form even for admins (drawer → Contact Support)
  // Without it (e.g. deep-link from admin panel), admins land on the ticket list
  const isAdminView  = isAdminUser && !startInForm;

  const [view, setView] = useState(isAdminView ? 'list' : 'form');
  // 'form' | 'success' | 'list' | 'detail'

  // ── Keyboard height tracking ──────────────────────────────────────────────
  const scrollRef      = useRef(null);
  const descFocused    = useRef(false);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => setKbHeight(e.endCoordinates.height);
    const onHide = ()  => setKbHeight(0);
    const sub1 = Keyboard.addListener(showEvent, onShow);
    const sub2 = Keyboard.addListener(hideEvent, onHide);
    return () => { sub1.remove(); sub2.remove(); };
  }, []);

  // Scroll to show the description field AFTER kbHeight is applied
  // (padding is added first, then this effect fires with the new value)
  useEffect(() => {
    if (kbHeight > 0 && descFocused.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [kbHeight]);

  // ── Pick up stored JWT (if user was previously logged in) ─────────────────
  const [storedToken, setStoredToken] = useState(authToken);
  useEffect(() => {
    if (!authToken) {
      AsyncStorage.getItem('userToken').then(t => { if (t) setStoredToken(t); }).catch(() => {});
    }
  }, [authToken]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [mobile,      setMobile]      = useState('');
  const [description, setDescription] = useState('');
  const [schoolCode,  setSchoolCode]  = useState(clientCode);
  const [submitting,  setSubmitting]  = useState(false);
  const [ticketResult, setTicketResult] = useState(null); // { ticketNumber, email }

  // ── Admin list/detail state ───────────────────────────────────────────────
  const [tickets,       setTickets]       = useState([]);
  const [loadingList,   setLoadingList]   = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [updStatus,     setUpdStatus]     = useState('');
  const [updResponse,   setUpdResponse]   = useState('');
  const [updating,      setUpdating]      = useState(false);
  const [filterStatus,  setFilterStatus]  = useState('');

  const STATUS_OPTIONS = ['', 'Open', 'In Progress', 'Resolved', 'Closed'];

  // ── Submit ticket ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!name.trim())        return Alert.alert('Validation', 'Please enter your name.');
    if (!email.trim())       return Alert.alert('Validation', 'Please enter your email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                             return Alert.alert('Validation', 'Please enter a valid email address.');
    if (!description.trim()) return Alert.alert('Validation', 'Please describe your problem.');

    try {
      setSubmitting(true);
      const headers = { 'Content-Type': 'application/json' };
      if (storedToken) headers['Authorization'] = `Bearer ${storedToken}`;
      const res = await fetch(`${BASE_URL}/UserServiceApi/submitTicket`, {
        method:  'POST',
        headers,
        body: JSON.stringify({
          name:                name.trim(),
          email_address:       email.trim().toLowerCase(),
          mobile_number:       mobile.trim(),
          problem_description: description.trim(),
          ssms_client_code:    schoolCode.trim().toUpperCase(),
        }),
      });
      const json = safeJson(await res.text());
      if (!json.status) {
        const msg = json.message ?? 'Submission failed.';
        // JWT middleware hasn't whitelisted submitTicket yet
        if (/token|authorization|auth/i.test(msg)) {
          throw new Error(
            'The server is not yet configured to accept public support tickets.\n\n' +
            'Please ask your administrator to add "submitTicket" to the JWT middleware public actions list on the server.'
          );
        }
        throw new Error(msg);
      }
      setTicketResult({ ticketNumber: json.ticket_number, email: email.trim() });
      setView('success');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  }, [name, email, mobile, description, schoolCode]);

  // ── Load tickets (admin) ──────────────────────────────────────────────────
  const loadTickets = useCallback(async (statusFilter = filterStatus) => {
    try {
      setLoadingList(true);
      const qs  = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const res = await fetch(`${BASE_URL}/UserServiceApi/getTickets${qs}`, {
        headers: {
          Authorization:  `Bearer ${storedToken || authToken}`,
          ssmsUserRole:   userRole,
          ssmsClientCode: clientCode,
        },
      });
      const json = safeJson(await res.text());
      if (!json.status) throw new Error(json.message);
      setTickets(json.data ?? []);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoadingList(false);
    }
  }, [authToken, userRole, clientCode, filterStatus]);

  React.useEffect(() => {
    if (view === 'list') loadTickets();
  }, [view]);

  // ── Update ticket (admin) ─────────────────────────────────────────────────
  const handleUpdate = useCallback(async () => {
    if (!updStatus) return Alert.alert('Validation', 'Please select a status.');
    if (!updResponse.trim()) return Alert.alert('Validation', 'Please type a reply before saving.');
    try {
      setUpdating(true);
      const res = await fetch(`${BASE_URL}/UserServiceApi/updateTicket/${selectedTicket.ticket_id}`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${storedToken || authToken}`,
          ssmsUserRole:   userRole,
          ssmsClientCode: clientCode,
          ssmsUserName:   userName,
        },
        body: JSON.stringify({ status: updStatus, reply: updResponse.trim() }),
      });
      const json = safeJson(await res.text());
      if (!json.status) throw new Error(json.message);
      // Update local ticket so thread refreshes instantly without a round-trip
      setSelectedTicket(prev => ({
        ...prev,
        status:   json.updated_status   ?? updStatus,
        response: json.updated_response ?? prev.response,
      }));
      setUpdResponse('');
      Alert.alert('Sent', json.message);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setUpdating(false);
    }
  }, [selectedTicket, updStatus, updResponse, authToken, userRole, clientCode, userName]);

  const openTicket = (ticket) => {
    setSelectedTicket(ticket);
    setUpdStatus(ticket.status);
    setUpdResponse('');          // always start with blank reply input
    setView('detail');
  };

  const resetForm = () => {
    setName(''); setEmail(''); setMobile('');
    setDescription(''); setSchoolCode(clientCode);
    setTicketResult(null);
    setView('form'); // always back to form, not admin list
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1f5f9' }} edges={['top']}>
      <LinearGradient colors={['#e0ecff', '#f8fbff', '#eef4ff']} style={{ flex: 1 }}>

        {/* ── Header ── */}
        <View style={s.header}>
          <TouchableOpacity
            style={s.headerBack}
            onPress={() => {
              if (view === 'detail') { setView('list'); return; }
              navigation?.goBack();
            }}
          >
            <Feather name="arrow-left" size={20} color="#2563eb" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>
              {view === 'list'   ? 'Support Tickets'
             : view === 'detail' ? `Ticket ${selectedTicket?.ticket_number ?? ''}`
             : 'Contact Support'}
            </Text>
            <Text style={s.headerSub}>
              {view === 'list'   ? 'Tap a ticket to view & respond'
             : view === 'detail' ? 'Update status and send response'
             : 'We typically respond within 24–48 hours'}
            </Text>
          </View>
          {isAdminUser && view !== 'list' && (
            <TouchableOpacity style={s.listBtn} onPress={() => setView('list')}>
              <Feather name="list" size={16} color="#2563eb" />
            </TouchableOpacity>
          )}
        </View>

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[s.scroll, { paddingBottom: kbHeight + 40 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >

            {/* ════ SUCCESS ════ */}
            {view === 'success' && ticketResult && (
              <SuccessCard
                ticketNumber={ticketResult.ticketNumber}
                email={ticketResult.email}
                onNew={resetForm}
                onBack={() => navigation?.goBack()}
                backLabel={storedToken ? '← Back' : '← Back to Login'}
              />
            )}

            {/* ════ SUBMIT FORM ════ */}
            {view === 'form' && (
              <View style={s.card}>
                <View style={s.cardIcon}>
                  <Feather name="headphones" size={28} color="#2563eb" />
                </View>
                <Text style={s.cardTitle}>Submit a Support Request</Text>
                <Text style={s.cardSub}>
                  Fill in the form below and our team will get back to you.
                </Text>

                <Field label="Full Name" required icon="user">
                  <TextInput
                    style={s.input}
                    placeholder="Your full name"
                    placeholderTextColor="#94a3b8"
                    value={name}
                    onChangeText={setName}
                  />
                </Field>

                <Field label="Email Address" required icon="mail">
                  <TextInput
                    style={s.input}
                    placeholder="you@example.com"
                    placeholderTextColor="#94a3b8"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </Field>

                <Field label="Mobile Number" icon="phone">
                  <TextInput
                    style={s.input}
                    placeholder="+91 98765 43210 (optional)"
                    placeholderTextColor="#94a3b8"
                    value={mobile}
                    onChangeText={setMobile}
                    keyboardType="phone-pad"
                  />
                </Field>

                <Field label="School Code" icon="hash">
                  <TextInput
                    style={s.input}
                    placeholder="If registered (optional)"
                    placeholderTextColor="#94a3b8"
                    value={schoolCode}
                    onChangeText={v => setSchoolCode(v.toUpperCase())}
                    autoCapitalize="characters"
                    maxLength={5}
                  />
                </Field>

                <View style={s.fieldWrap}>
                  <Text style={s.label}>
                    Problem Description <Text style={{ color: '#dc2626' }}>*</Text>
                  </Text>
                  <TextInput
                    style={[s.inputBox, s.textarea]}
                    placeholder="Please describe your issue in detail…"
                    placeholderTextColor="#94a3b8"
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                    onFocus={() => { descFocused.current = true; }}
                    onBlur={() =>  { descFocused.current = false; }}
                  />
                </View>

                <TouchableOpacity
                  style={[s.submitBtn, submitting && { opacity: 0.65 }]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : <><Feather name="send" size={17} color="#fff" />
                        <Text style={s.submitBtnText}>  Submit Request</Text></>}
                </TouchableOpacity>
              </View>
            )}

            {/* ════ ADMIN — TICKET LIST ════ */}
            {view === 'list' && (
              <View>
                {/* Filter bar */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 14 }}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
                >
                  {STATUS_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt || 'all'}
                      style={[
                        s.filterChip,
                        filterStatus === opt && s.filterChipActive,
                      ]}
                      onPress={() => { setFilterStatus(opt); loadTickets(opt); }}
                    >
                      <Text style={[s.filterChipText, filterStatus === opt && { color: '#fff' }]}>
                        {opt || 'All'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {loadingList
                  ? <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 40 }} />
                  : tickets.length === 0
                    ? <View style={s.emptyBox}>
                        <Feather name="inbox" size={40} color="#94a3b8" />
                        <Text style={s.emptyText}>No tickets found</Text>
                      </View>
                    : tickets.map(t => {
                        const sc = STATUS_COLORS[t.status] ?? STATUS_COLORS['Open'];
                        return (
                          <TouchableOpacity
                            key={t.ticket_id}
                            style={s.ticketRow}
                            onPress={() => openTicket(t)}
                            activeOpacity={0.8}
                          >
                            <View style={s.ticketRowTop}>
                              <Text style={s.ticketRowNum}>{t.ticket_number}</Text>
                              <View style={[s.statusBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                                <Text style={[s.statusText, { color: sc.text }]}>{t.status}</Text>
                              </View>
                            </View>
                            <Text style={s.ticketRowName}>{t.name}</Text>
                            <Text style={s.ticketRowEmail}>{t.email_address}</Text>
                            <Text style={s.ticketRowDesc} numberOfLines={2}>{t.problem_description}</Text>
                            <Text style={s.ticketRowDate}>{t.created?.slice(0, 10)}</Text>
                          </TouchableOpacity>
                        );
                      })
                }
              </View>
            )}

            {/* ════ ADMIN — TICKET DETAIL / UPDATE ════ */}
            {view === 'detail' && selectedTicket && (
              <View style={s.card}>
                {/* Ticket info */}
                <View style={s.detailRow}><Text style={s.detailLabel}>Ticket #</Text><Text style={s.detailValue}>{selectedTicket.ticket_number}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Name</Text><Text style={s.detailValue}>{selectedTicket.name}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Email</Text><Text style={s.detailValue}>{selectedTicket.email_address}</Text></View>
                {!!selectedTicket.mobile_number && <View style={s.detailRow}><Text style={s.detailLabel}>Mobile</Text><Text style={s.detailValue}>{selectedTicket.mobile_number}</Text></View>}
                {!!selectedTicket.ssms_client_code && <View style={s.detailRow}><Text style={s.detailLabel}>School Code</Text><Text style={s.detailValue}>{selectedTicket.ssms_client_code}</Text></View>}
                <View style={s.detailRow}><Text style={s.detailLabel}>Submitted</Text><Text style={s.detailValue}>{selectedTicket.created?.slice(0, 16).replace('T', ' ')}</Text></View>

                <View style={s.divider} />

                <Text style={[s.label, { marginBottom: 6 }]}>Problem Description</Text>
                <Text style={s.descText}>{selectedTicket.problem_description}</Text>

                <View style={s.divider} />

                {/* Status selector */}
                <Text style={s.label}>Update Status <Text style={{ color: '#dc2626' }}>*</Text></Text>
                <View style={s.statusRow}>
                  {['Open', 'In Progress', 'Resolved', 'Closed'].map(opt => (
                    <TouchableOpacity
                      key={opt}
                      style={[s.statusOpt, updStatus === opt && s.statusOptActive]}
                      onPress={() => setUpdStatus(opt)}
                    >
                      <Text style={[s.statusOptText, updStatus === opt && { color: '#fff' }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={s.divider} />

                {/* Read-only response thread */}
                <Text style={[s.label, { marginBottom: 8 }]}>Response Thread</Text>
                {selectedTicket.response ? (
                  <ScrollView
                    style={s.threadScroll}
                    nestedScrollEnabled
                    scrollEnabled
                    showsVerticalScrollIndicator
                  >
                    {selectedTicket.response.split('\n\n').map((entry, i) => {
                      const headerMatch = entry.match(/^\[([^\]]+)\]\[([^\]]+)\]\n([\s\S]*)$/);
                      if (headerMatch) {
                        return (
                          <View key={i} style={s.threadEntry}>
                            <View style={s.threadMeta}>
                              <Feather name="clock" size={11} color="#64748b" />
                              <Text style={s.threadTime}> {headerMatch[1]}</Text>
                              <Text style={s.threadName}>  · {headerMatch[2]}</Text>
                            </View>
                            <Text style={s.threadBody}>{headerMatch[3]}</Text>
                          </View>
                        );
                      }
                      return (
                        <View key={i} style={s.threadEntry}>
                          <Text style={s.threadBody}>{entry}</Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <View style={s.threadEmpty}>
                    <Text style={s.threadEmptyText}>No replies yet.</Text>
                  </View>
                )}

                {/* New reply input */}
                <Text style={[s.label, { marginTop: 16 }]}>
                  New Reply <Text style={{ color: '#dc2626' }}>*</Text>
                </Text>
                <TextInput
                  style={[s.inputBox, s.textarea]}
                  placeholder="Type your reply… (will be appended and emailed)"
                  placeholderTextColor="#94a3b8"
                  value={updResponse}
                  onChangeText={setUpdResponse}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  onFocus={() => { descFocused.current = true; setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100); }}
                  onBlur={() =>  { descFocused.current = false; }}
                />

                <TouchableOpacity
                  style={[s.submitBtn, updating && { opacity: 0.65 }]}
                  onPress={handleUpdate}
                  disabled={updating}
                >
                  {updating
                    ? <ActivityIndicator color="#fff" />
                    : <><Feather name="check-circle" size={17} color="#fff" />
                        <Text style={s.submitBtnText}>  Save & Send Email</Text></>}
                </TouchableOpacity>
              </View>
            )}

          </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  headerBack:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  headerSub:   { fontSize: 12, color: '#64748b', marginTop: 1 },
  listBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 16, paddingTop: 4, flexGrow: 1 },

  card:       { backgroundColor: '#fff', borderRadius: 20, padding: 20, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  cardIcon:   { width: 60, height: 60, borderRadius: 30, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
  cardTitle:  { fontSize: 20, fontWeight: '800', color: '#0f172a', textAlign: 'center', marginBottom: 6 },
  cardSub:    { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 20, lineHeight: 20 },

  fieldWrap:  { marginBottom: 14 },
  label:      { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6 },
  inputBox:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  input:      { flex: 1, fontSize: 14, color: '#0f172a', paddingVertical: 10 },
  textarea:   { flexDirection: 'column', alignItems: 'flex-start', minHeight: 110, paddingVertical: 12, fontSize: 14, color: '#0f172a' },

  submitBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2563eb', borderRadius: 14, paddingVertical: 15, marginTop: 8, elevation: 3, shadowColor: '#2563eb', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  // Success
  successCard:   { backgroundColor: '#fff', borderRadius: 20, padding: 28, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  successIcon:   { marginBottom: 16 },
  successTitle:  { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 6 },
  successSub:    { fontSize: 14, color: '#64748b', marginBottom: 20 },
  ticketBadge:   { backgroundColor: '#eff6ff', borderWidth: 1.5, borderColor: '#93c5fd', borderRadius: 16, paddingHorizontal: 24, paddingVertical: 14, alignItems: 'center', marginBottom: 20, width: '100%' },
  ticketLabel:   { fontSize: 11, fontWeight: '700', color: '#64748b', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  ticketNumber:  { fontSize: 22, fontWeight: '900', color: '#2563eb', letterSpacing: 1 },
  successNote:   { fontSize: 13, color: '#475569', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  newBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28, marginBottom: 12, width: '100%' },
  newBtnText:    { fontSize: 14, fontWeight: '700', color: '#fff' },
  backBtn:       { paddingVertical: 10 },
  backBtnText:   { fontSize: 14, fontWeight: '600', color: '#64748b' },

  // Admin list
  filterChip:       { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1' },
  filterChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  filterChipText:   { fontSize: 13, fontWeight: '600', color: '#334155' },
  emptyBox:         { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText:        { fontSize: 14, color: '#94a3b8', fontWeight: '600' },

  ticketRow:     { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  ticketRowTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  ticketRowNum:  { fontSize: 13, fontWeight: '800', color: '#2563eb' },
  ticketRowName: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  ticketRowEmail:{ fontSize: 12, color: '#64748b', marginBottom: 6 },
  ticketRowDesc: { fontSize: 13, color: '#334155', lineHeight: 18, marginBottom: 6 },
  ticketRowDate: { fontSize: 11, color: '#94a3b8' },
  statusBadge:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  statusText:    { fontSize: 11, fontWeight: '700' },

  // Admin detail
  divider:      { height: 1, backgroundColor: '#f1f5f9', marginVertical: 16 },
  threadScroll: { maxHeight: 220, backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 4 },
  threadEntry:  { marginBottom: 14 },
  threadMeta:   { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  threadTime:   { fontSize: 11, color: '#64748b' },
  threadName:   { fontSize: 11, fontWeight: '700', color: '#2563eb' },
  threadBody:   { fontSize: 13, color: '#0f172a', lineHeight: 20 },
  threadEmpty:  { backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 16, alignItems: 'center', marginBottom: 4 },
  threadEmptyText: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic' },
  detailRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  detailLabel: { fontSize: 12, color: '#64748b', fontWeight: '600', flex: 1 },
  detailValue: { fontSize: 13, color: '#0f172a', fontWeight: '700', flex: 2, textAlign: 'right' },
  descText:    { fontSize: 13, color: '#334155', lineHeight: 20, backgroundColor: '#f8fafc', borderRadius: 10, padding: 12 },
  statusRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  statusOpt:   { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  statusOptActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  statusOptText:   { fontSize: 13, fontWeight: '600', color: '#334155' },
});
