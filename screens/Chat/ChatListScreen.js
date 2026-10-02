/**
 * screens/Chat/ChatListScreen.js
 * Shows all school users with online/offline status and unread badges.
 * Tapping a user opens ChatScreen.
 */
import React, {
  useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AuthContext }     from '../../context/AuthContext';
import { fetchChatUsers }  from '../../services/ChatServiceApi';

// ── Colours ──────────────────────────────────────────────────────────────────
const C = {
  bg:       '#f8fafc',
  card:     '#ffffff',
  primary:  '#1e40af',
  online:   '#22c55e',
  offline:  '#94a3b8',
  text:     '#0f172a',
  sub:      '#64748b',
  badge:    '#ef4444',
  border:   '#e2e8f0',
  section:  '#f1f5f9',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function roleLabel(role = '') {
  const map = {
    admin: 'Admin', owner: 'Owner', teacher: 'Teacher',
    accountant: 'Accountant', user: 'Staff', student: 'Student',
  };
  return map[role.toLowerCase()] ?? role;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, isOnline, size = 46 }) {
  const init   = initials(name);
  const hue    = (name.charCodeAt(0) ?? 65) % 360;
  const bgColor = `hsl(${hue}, 55%, 50%)`;
  return (
    <View style={{ width: size, height: size }}>
      <View style={[S.avatarCircle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor }]}>
        <Text style={[S.avatarTxt, { fontSize: size * 0.38 }]}>{init}</Text>
      </View>
      <View style={[S.onlineDot, isOnline ? S.dotOnline : S.dotOffline]} />
    </View>
  );
}

// ── User Row ──────────────────────────────────────────────────────────────────
function UserRow({ item, onPress }) {
  return (
    <TouchableOpacity style={S.row} onPress={() => onPress(item)} activeOpacity={0.7}>
      <Avatar name={item.display_name} isOnline={!!item.is_online} />
      <View style={S.rowMid}>
        <Text style={S.rowName} numberOfLines={1}>{item.display_name}</Text>
        <View style={S.rowSub}>
          <Feather
            name="circle"
            size={7}
            color={item.is_online ? C.online : C.offline}
            style={{ marginRight: 4, marginTop: 1 }}
          />
          <Text style={[S.rowStatus, { color: item.is_online ? C.online : C.offline }]}>
            {item.is_online ? 'Online' : 'Offline'}
          </Text>
          <Text style={S.rowDot}> · </Text>
          <Text style={S.rowRole}>{roleLabel(item.role)}</Text>
        </View>
      </View>
      {item.unread_count > 0 && (
        <View style={S.badge}>
          <Text style={S.badgeTxt}>
            {item.unread_count > 99 ? '99+' : item.unread_count}
          </Text>
        </View>
      )}
      <Feather name="chevron-right" size={18} color={C.offline} />
    </TouchableOpacity>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────
function SectionHead({ label, count }) {
  return (
    <View style={S.sectionHead}>
      <Text style={S.sectionTxt}>{label}</Text>
      {count != null && (
        <View style={S.sectionBadge}>
          <Text style={S.sectionBadgeTxt}>{count}</Text>
        </View>
      )}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ChatListScreen({ navigation }) {
  const { user }  = useContext(AuthContext);
  const insets    = useSafeAreaInsets();
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,  setSearch]  = useState('');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else           setLoading(true);
    try {
      const data = await fetchChatUsers(user);
      setUsers(data);
    } catch (e) {
      console.warn('[ChatList] load error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    load();
    // Refresh list every 15 s so online status stays current
    const t = setInterval(() => load(true), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const openChat = useCallback((otherUser) => {
    navigation.navigate('Chat', {
      otherUsername:   otherUser.username,
      otherName:       otherUser.display_name,
      otherRole:       otherUser.role,
      initialOnline:   !!otherUser.is_online,
    });
  }, [navigation]);

  // Filter by search
  const filtered = search.trim()
    ? users.filter(u =>
        u.display_name.toLowerCase().includes(search.toLowerCase()) ||
        u.username.toLowerCase().includes(search.toLowerCase())
      )
    : users;

  const onlineUsers  = filtered.filter(u => u.is_online);
  const offlineUsers = filtered.filter(u => !u.is_online);

  // Flatten into a single list with section headers
  const listData = [];
  if (onlineUsers.length) {
    listData.push({ type: 'header', key: 'h-online',  label: 'Online Now', count: onlineUsers.length });
    onlineUsers.forEach(u  => listData.push({ type: 'user', ...u, key: `u-${u.username}` }));
  }
  if (offlineUsers.length) {
    listData.push({ type: 'header', key: 'h-offline', label: 'Offline',    count: offlineUsers.length });
    offlineUsers.forEach(u => listData.push({ type: 'user', ...u, key: `u-${u.username}` }));
  }

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return <SectionHead label={item.label} count={item.count} />;
    }
    return <UserRow item={item} onPress={openChat} />;
  };

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={S.safe} edges={['left', 'right', 'bottom']}>
      {/* Header — manually applies top inset so it fills under the status bar */}
      <View style={[S.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>Messages</Text>
          <Text style={S.headerSub}>
            {onlineUsers.length} online · {users.length} total
          </Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={S.searchWrap}>
        <Feather name="search" size={16} color={C.offline} style={{ marginRight: 8 }} />
        <SearchInput value={search} onChange={setSearch} />
      </View>

      {listData.length === 0 ? (
        <View style={S.center}>
          <Feather name="users" size={48} color={C.border} />
          <Text style={S.emptyTxt}>No users found</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[C.primary]} />
          }
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </SafeAreaView>
  );
}

// ── Inline TextInput (avoids import clutter above) ────────────────────────────
import { TextInput } from 'react-native';
function SearchInput({ value, onChange }) {
  return (
    <TextInput
      style={S.searchTxt}
      value={value}
      onChangeText={onChange}
      placeholder="Search people…"
      placeholderTextColor={C.offline}
      returnKeyType="search"
      clearButtonMode="while-editing"
    />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTxt:    { color: C.offline, fontSize: 15 },

  // Header
  header:      { backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 14 },
  backBtn:     { marginRight: 12 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub:   { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 1 },

  // Search
  searchWrap:  { backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', marginHorizontal: 14, marginVertical: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  searchTxt:   { flex: 1, fontSize: 14, color: C.text, paddingVertical: 6 },

  // Section
  sectionHead: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.section, paddingHorizontal: 16, paddingVertical: 7 },
  sectionTxt:  { fontSize: 11, fontWeight: '700', color: C.sub, textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionBadge:    { backgroundColor: C.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 7 },
  sectionBadgeTxt: { fontSize: 10, color: C.sub, fontWeight: '700' },

  // Row
  row:         { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  rowMid:      { flex: 1, marginLeft: 12 },
  rowName:     { fontSize: 15, fontWeight: '700', color: C.text },
  rowSub:      { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  rowStatus:   { fontSize: 12, fontWeight: '600' },
  rowDot:      { color: C.offline, fontSize: 12 },
  rowRole:     { fontSize: 12, color: C.sub },

  // Badge
  badge:       { backgroundColor: C.badge, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginRight: 8 },
  badgeTxt:    { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Avatar
  avatarCircle:{ alignItems: 'center', justifyContent: 'center' },
  avatarTxt:   { color: '#fff', fontWeight: '800' },
  onlineDot:   { position: 'absolute', bottom: 0, right: 0, width: 13, height: 13, borderRadius: 6.5, borderWidth: 2, borderColor: C.card },
  dotOnline:   { backgroundColor: C.online },
  dotOffline:  { backgroundColor: C.offline },
});
