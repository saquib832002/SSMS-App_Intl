/**
 * screens/Chat/ChatScreen.js
 * 1-to-1 chat with 4-second message polling while screen is focused.
 *
 * Route params:
 *   otherUsername  – string
 *   otherName      – string (display name)
 *   otherRole      – string
 *   initialOnline  – boolean
 */
import React, {
  useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView,
  Platform, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AuthContext }           from '../../context/AuthContext';
import { fetchMessages, sendChatMessage } from '../../services/ChatServiceApi';

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  bg:        '#f0f4f8',
  primary:   '#1e40af',
  sent:      '#1e40af',   // bubble background — my messages
  recv:      '#ffffff',   // bubble background — their messages
  sentTxt:   '#ffffff',
  recvTxt:   '#0f172a',
  timeTxt:   '#94a3b8',
  online:    '#22c55e',
  offline:   '#94a3b8',
  border:    '#e2e8f0',
  input:     '#ffffff',
  sendBtn:   '#1e40af',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now  = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return hhmm;
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${hhmm}`;
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg, isMine, otherName }) {
  return (
    <View style={[S.bubbleWrap, isMine ? S.bubbleRight : S.bubbleLeft]}>
      {!isMine && (
        <View style={S.recvAvatar}>
          <Text style={S.recvAvatarTxt}>{initials(otherName)}</Text>
        </View>
      )}
      <View style={[S.bubble, isMine ? S.bubbleSent : S.bubbleRecv]}>
        <Text style={[S.bubbleTxt, { color: isMine ? C.sentTxt : C.recvTxt }]}>
          {msg.body}
        </Text>
        <View style={S.bubbleMeta}>
          <Text style={[S.bubbleTime, { color: isMine ? 'rgba(255,255,255,0.65)' : C.timeTxt }]}>
            {fmtTime(msg.created_at)}
          </Text>
          {isMine && (
            <Feather
              name={msg.is_read ? 'check-circle' : 'check'}
              size={11}
              color="rgba(255,255,255,0.65)"
              style={{ marginLeft: 4 }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

// ── Date divider ──────────────────────────────────────────────────────────────
function DateDivider({ dateStr }) {
  return (
    <View style={S.dateDivWrap}>
      <View style={S.dateLine} />
      <Text style={S.dateTxt}>{dateStr}</Text>
      <View style={S.dateLine} />
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ChatScreen({ route, navigation }) {
  const { otherUsername, otherName, otherRole, initialOnline } = route.params ?? {};
  const { user }  = useContext(AuthContext);
  const insets    = useSafeAreaInsets();

  const [messages,   setMessages]   = useState([]);
  const [inputText,  setInputText]  = useState('');
  const [loading,    setLoading]    = useState(true);
  const [sending,    setSending]    = useState(false);
  const [isOnline,   setIsOnline]   = useState(!!initialOnline);

  const listRef      = useRef(null);
  const lastTsRef    = useRef(null);   // ISO timestamp of most-recent message we have
  const pollTimer    = useRef(null);

  // ── Load initial messages ────────────────────────────────────────────────
  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const { messages: msgs } = await fetchMessages(user, otherUsername, null, 60);
      setMessages(msgs);
      if (msgs.length) {
        lastTsRef.current = msgs[msgs.length - 1].created_at;
      }
    } catch (e) {
      console.warn('[Chat] load error', e.message);
    } finally {
      setLoading(false);
    }
  }, [user, otherUsername]);

  // ── Poll for new messages ────────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const { messages: newMsgs } = await fetchMessages(
        user, otherUsername, lastTsRef.current, 50
      );
      if (newMsgs.length) {
        setMessages(prev => {
          // Deduplicate by id
          const ids = new Set(prev.map(m => m.id));
          const fresh = newMsgs.filter(m => !ids.has(m.id));
          if (!fresh.length) return prev;
          return [...prev, ...fresh];
        });
        lastTsRef.current = newMsgs[newMsgs.length - 1].created_at;
      }
    } catch {
      // fail silently — poll will retry
    }
  }, [user, otherUsername]);

  // Start / stop polling while screen is focused
  useEffect(() => {
    loadInitial();
    pollTimer.current = setInterval(poll, 4_000);
    return () => clearInterval(pollTimer.current);
  }, [loadInitial, poll]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // ── Send ────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const body = inputText.trim();
    if (!body || sending) return;
    setInputText('');
    setSending(true);

    // Optimistic message
    const optimistic = {
      id:         `opt-${Date.now()}`,
      sender:     user.ssmsUserName ?? user.username,
      body,
      is_read:    0,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      await sendChatMessage(user, otherUsername, body);
      // Poll will confirm the real message; optimistic stays until deduped
    } catch (e) {
      // Remove optimistic on failure
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      console.warn('[Chat] send error', e.message);
    } finally {
      setSending(false);
    }
  }, [inputText, sending, user, otherUsername]);

  // ── Render list with date dividers ──────────────────────────────────────
  const myUsername = user?.ssmsUserName ?? user?.username ?? '';

  const listItems = [];
  let lastDate = null;
  for (const msg of messages) {
    const d    = msg.created_at ? new Date(msg.created_at) : null;
    const dStr = d ? d.toDateString() : null;
    if (dStr && dStr !== lastDate) {
      const today     = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      const label = dStr === today     ? 'Today'
                  : dStr === yesterday ? 'Yesterday'
                  : d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
      listItems.push({ type: 'divider', key: `div-${dStr}`, label });
      lastDate = dStr;
    }
    listItems.push({ type: 'msg', key: `msg-${msg.id}`, msg });
  }

  const renderItem = ({ item }) => {
    if (item.type === 'divider') return <DateDivider dateStr={item.label} />;
    const isMine = item.msg.sender === myUsername;
    return <Bubble msg={item.msg} isMine={isMine} otherName={otherName} />;
  };

  return (
    <SafeAreaView style={S.safe} edges={['left', 'right', 'bottom']}>
      {/* Header — manually applies top inset */}
      <View style={[S.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={S.headerAvatar}>
          <Text style={S.headerAvatarTxt}>{initials(otherName)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={S.headerName} numberOfLines={1}>{otherName}</Text>
          <View style={S.headerSubRow}>
            <View style={[S.onlineDot, { backgroundColor: isOnline ? C.online : C.offline }]} />
            <Text style={S.headerSub}>{isOnline ? 'Online' : 'Offline'}</Text>
          </View>
        </View>
      </View>

      {/* Messages + input — KeyboardAvoidingView lifts the input above the keyboard */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {loading ? (
          <View style={S.center}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : listItems.length === 0 ? (
          <View style={S.center}>
            <Feather name="message-circle" size={52} color={C.border} />
            <Text style={S.emptyTxt}>No messages yet</Text>
            <Text style={S.emptySub}>Say hello to {otherName} 👋</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={listItems}
            keyExtractor={item => item.key}
            renderItem={renderItem}
            contentContainerStyle={S.listContent}
            showsVerticalScrollIndicator={false}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {/* Input bar */}
        <View style={S.inputBar}>
          <TextInput
            style={S.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={`Message ${otherName}…`}
            placeholderTextColor={C.timeTxt}
            multiline
            maxLength={2000}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[S.sendBtn, (!inputText.trim() || sending) && S.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Feather name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTxt:{ fontSize: 16, color: C.timeTxt, fontWeight: '600' },
  emptySub:{ fontSize: 13, color: C.timeTxt },

  // Header
  header:        { backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12 },
  backBtn:       { marginRight: 10 },
  headerAvatar:  { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerAvatarTxt:{ color: '#fff', fontWeight: '800', fontSize: 14 },
  headerName:    { color: '#fff', fontSize: 16, fontWeight: '800' },
  headerSubRow:  { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  onlineDot:     { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  headerSub:     { color: 'rgba(255,255,255,0.75)', fontSize: 12 },

  // List
  listContent:   { paddingHorizontal: 12, paddingVertical: 14, gap: 4 },

  // Bubble
  bubbleWrap:    { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 2 },
  bubbleLeft:    { justifyContent: 'flex-start' },
  bubbleRight:   { justifyContent: 'flex-end' },
  bubble:        { maxWidth: '75%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 8 },
  bubbleSent:    { backgroundColor: C.sent, borderBottomRightRadius: 4, marginLeft: 'auto' },
  bubbleRecv:    { backgroundColor: C.recv, borderBottomLeftRadius: 4, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  bubbleTxt:     { fontSize: 15, lineHeight: 21 },
  bubbleMeta:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 },
  bubbleTime:    { fontSize: 10 },

  // Avatar beside received bubble
  recvAvatar:    { width: 28, height: 28, borderRadius: 14, backgroundColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', marginRight: 6, marginBottom: 4 },
  recvAvatarTxt: { color: '#1e293b', fontSize: 10, fontWeight: '800' },

  // Date divider
  dateDivWrap:   { flexDirection: 'row', alignItems: 'center', marginVertical: 10 },
  dateLine:      { flex: 1, height: 1, backgroundColor: C.border },
  dateTxt:       { color: C.timeTxt, fontSize: 11, fontWeight: '600', marginHorizontal: 10 },

  // Input bar
  inputBar:      { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: C.input, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 12, paddingVertical: 8, gap: 10 },
  input:         { flex: 1, fontSize: 15, color: '#0f172a', maxHeight: 120, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f8fafc', borderRadius: 22, borderWidth: 1, borderColor: C.border },
  sendBtn:       { width: 42, height: 42, borderRadius: 21, backgroundColor: C.sendBtn, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#93c5fd' },
});
