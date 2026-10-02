// screens/UserProfileScreen.js
import React, { useContext, useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { AuthContext } from "../context/AuthContext";
import { HOST_NAME } from "../Environment/EnvironmentConfig";
import { fetchUserProfile, updateUserPhoto } from "../services/UserServiceApi";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  primary: '#2563eb',
  indigo:  '#4338ca',
  text:    '#0f172a',
  sub:     '#334155',
  muted:   '#64748b',
  border:  '#e2e8f0',
  card:    '#ffffff',
  bg:      '#eef2f7',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun",
                     "Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(str) {
  if (!str) return '—';
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return str;
  return `${String(m[3]).padStart(2,'0')} ${MONTH_SHORT[+m[2]-1]} ${m[1]}`;
}

function daysUntil(str) {
  if (!str) return null;
  const exp = new Date(str + 'T00:00:00');
  if (isNaN(exp)) return null;
  return Math.ceil((exp - new Date()) / 86400000);
}

function ExpiryBadge({ expiryDate, status }) {
  const days  = daysUntil(expiryDate);
  const label = fmtDate(expiryDate);

  let bg, textColor, dot, caption;
  if (status?.toLowerCase() === 'inactive') {
    bg = '#fee2e2'; textColor = '#b91c1c'; dot = '#b91c1c'; caption = 'Inactive';
  } else if (days === null) {
    bg = '#f1f5f9'; textColor = C.muted; dot = C.muted; caption = '';
  } else if (days < 0) {
    bg = '#fee2e2'; textColor = '#b91c1c'; dot = '#b91c1c'; caption = 'Expired';
  } else if (days <= 30) {
    bg = '#fef9c3'; textColor = '#b45309'; dot = '#b45309';
    caption = `Expires in ${days}d`;
  } else {
    bg = '#dcfce7'; textColor = '#15803d'; dot = '#15803d'; caption = 'Active';
  }

  return (
    <View style={[xb.wrap, { backgroundColor: bg }]}>
      <View style={[xb.dot, { backgroundColor: dot }]} />
      <View>
        <Text style={[xb.date, { color: textColor }]}>{label}</Text>
        {!!caption && <Text style={[xb.caption, { color: textColor }]}>{caption}</Text>}
      </View>
    </View>
  );
}
const xb = StyleSheet.create({
  wrap:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, alignSelf: 'flex-start' },
  dot:     { width: 8, height: 8, borderRadius: 4 },
  date:    { fontSize: 14, fontWeight: '700' },
  caption: { fontSize: 11, fontWeight: '600', marginTop: 1 },
});

// ── Info row ──────────────────────────────────────────────────────────────────
function InfoRow({ icon, label, value, accent }) {
  const clr = accent ?? C.primary;
  return (
    <View style={ir.row}>
      <View style={[ir.iconBox, { backgroundColor: clr + '18' }]}>
        <Feather name={icon} size={14} color={clr} />
      </View>
      <View style={ir.body}>
        <Text style={ir.label}>{label}</Text>
        <Text style={ir.value} numberOfLines={2}>{value || '—'}</Text>
      </View>
    </View>
  );
}
const ir = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 8, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  iconBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  body:    { flex: 1, justifyContent: 'center' },
  label:   { fontSize: 10.5, color: C.muted, fontWeight: '600', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  value:   { fontSize: 14, color: C.text, fontWeight: '700' },
});

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({ label, icon, color }) {
  return (
    <View style={sh.row}>
      <View style={[sh.box, { backgroundColor: color }]}>
        <Feather name={icon} size={12} color="#fff" />
      </View>
      <Text style={[sh.label, { color }]}>{label}</Text>
      <View style={[sh.line, { backgroundColor: color + '30' }]} />
    </View>
  );
}
const sh = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 10 },
  box:   { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  line:  { flex: 1, height: 1 },
});

// ── Avatar with photo + edit button ──────────────────────────────────────────
function AvatarWithEdit({ firstName, lastName, photoUrl, size = 72, onEdit, uploading }) {
  const initials = ((firstName?.[0] ?? '') + (lastName?.[0] ?? '')).toUpperCase() || '?';
  return (
    <View style={{ position: 'relative' }}>
      <View style={[av.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
          />
        ) : (
          <View style={[av.circle, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={[av.text, { fontSize: size * 0.36 }]}>{initials}</Text>
          </View>
        )}
      </View>
      <TouchableOpacity
        style={av.editBtn}
        onPress={onEdit}
        disabled={uploading}
        activeOpacity={0.8}
      >
        {uploading
          ? <ActivityIndicator size="small" color="#fff" />
          : <Feather name="camera" size={12} color="#fff" />
        }
      </TouchableOpacity>
    </View>
  );
}
const av = StyleSheet.create({
  ring:    { borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', padding: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  circle:  { backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  text:    { color: '#fff', fontWeight: '800', letterSpacing: -0.5 },
  editBtn: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: '#2563eb', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});

// ── MAIN SCREEN ───────────────────────────────────────────────────────────────
export default function UserProfileScreen() {
  const { user, logout, setProfilePhoto } = useContext(AuthContext);
  const [profile,   setProfile]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchUserProfile(user)
      .then(p => {
        setProfile(p);
        if (p?.userPhoto) setProfilePhoto(p.userPhoto);
      })
      .catch(e => Alert.alert('Error', e.message || 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [user]);

  const baseUrl  = (HOST_NAME ?? '').replace(/\/+$/, '');
  const photoUrl = profile?.userPhoto
    ? `${baseUrl}/clients/${user?.ssmsClientCode ?? ''}/user/${profile.userPhoto}`
    : null;

  const handlePickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library to update your profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    try {
      setUploading(true);
      const res = await updateUserPhoto(user, result.assets[0]);
      setProfile(prev => ({ ...prev, userPhoto: res.filename }));
      setProfilePhoto(res.filename);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  // Role display label
  const roleLabel = (user?.ssmsUserRole ?? '').replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()) || 'User';

  const fullName = profile
    ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || user?.ssmsUserName
    : user?.ssmsUserName ?? '';

  if (loading) {
    return (
      <View style={s.loaderWrap}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={s.loaderText}>Loading profile…</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <LinearGradient colors={['#1e3a8a', '#2563eb']} style={s.hero}>
          <AvatarWithEdit
            firstName={profile?.firstName}
            lastName={profile?.lastName}
            photoUrl={photoUrl}
            size={72}
            onEdit={handlePickPhoto}
            uploading={uploading}
          />
          <View style={s.heroInfo}>
            <Text style={s.heroName} numberOfLines={2}>{fullName}</Text>
            <Text style={s.heroUsername}>@{user?.ssmsUserName}</Text>
            <View style={s.heroRoleRow}>
              <View style={s.rolePill}>
                <Text style={s.roleText}>{roleLabel}</Text>
              </View>
              {!!user?.ssmsClientCode && (
                <View style={s.codePill}>
                  <Text style={s.codeText}>{user.ssmsClientCode}</Text>
                </View>
              )}
            </View>
          </View>
        </LinearGradient>

        <View style={s.content}>

          {/* ── CONTACT ──────────────────────────────────────────────────── */}
          <SectionHead label="Contact" icon="user" color={C.primary} />
          <InfoRow icon="mail"       label="Email"        value={profile?.emailAddress}  accent={C.primary} />
          <InfoRow icon="phone"      label="Mobile"       value={profile?.mobileNumber}  accent={C.primary} />
          <InfoRow icon="user"       label="Username"     value={user?.ssmsUserName}     accent={C.primary} />

          {/* ── MEMBERSHIP ───────────────────────────────────────────────── */}
          <SectionHead label="Membership" icon="shield" color="#7c3aed" />

          {!!profile?.clientName && (
            <InfoRow icon="home"    label="Institute"    value={profile.clientName}     accent="#7c3aed" />
          )}

          <View style={ir.row}>
            <View style={[ir.iconBox, { backgroundColor: '#7c3aed18' }]}>
              <Feather name="calendar" size={14} color="#7c3aed" />
            </View>
            <View style={ir.body}>
              <Text style={ir.label}>Membership Expiry</Text>
              <ExpiryBadge
                expiryDate={profile?.expiryDate}
                status={profile?.clientStatus}
              />
            </View>
          </View>

          <InfoRow icon="tag"   label="Plan Status"  value={profile?.clientStatus ?? '—'}  accent="#7c3aed" />

          {/* ── SIGN OUT ─────────────────────────────────────────────────── */}
          <TouchableOpacity
            style={s.logoutBtn}
            onPress={() =>
              Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: logout },
              ])
            }
          >
            <Feather name="log-out" size={17} color="#dc2626" />
            <Text style={s.logoutTxt}>Sign Out</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: C.bg },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: C.bg },
  loaderText: { color: C.muted, fontSize: 14 },
  scroll:     { paddingBottom: 40 },

  // Hero
  hero:       { paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 28, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroInfo:   { flex: 1 },
  heroName:   { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: -0.3, marginBottom: 2 },
  heroUsername:{ fontSize: 12, color: '#bfdbfe', fontWeight: '500', marginBottom: 8 },
  heroRoleRow:{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  rolePill:   { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  roleText:   { color: '#fff', fontSize: 11, fontWeight: '700' },
  codePill:   { backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  codeText:   { color: '#dbeafe', fontSize: 11, fontWeight: '600' },

  // Content
  content:    { paddingHorizontal: 16, paddingTop: 8 },

  // Logout
  logoutBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 28, paddingVertical: 14, borderRadius: 14, backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
  logoutTxt:  { color: '#dc2626', fontWeight: '700', fontSize: 15 },
});
