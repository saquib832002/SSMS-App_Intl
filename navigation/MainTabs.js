import React, { useContext, useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, Modal, Pressable, Image, Share, Clipboard, Linking,
} from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthContext } from "../context/AuthContext";
import { featureScreenLayout } from "../components/FeatureGate";
import { useFeatureLock, LockBadge } from "../components/FeatureLock";
import { HOST_NAME, PLAY_STORE_URL, APP_VERSION_LABEL } from "../Environment/EnvironmentConfig";
import { fetchInstituteDetails } from "../services/UserServiceApi";
import { sendHeartbeat }         from "../services/ChatServiceApi";
import { AppState, Platform }    from "react-native";
import * as Notifications        from "expo-notifications";
import Constants                  from "expo-constants";

// Expo Go (the generic preview app) no longer supports remote push on
// Android since SDK 53. Skip push-token registration there so the app can
// still be previewed in Expo Go; development / production builds are unaffected.
const IS_EXPO_GO = Constants.executionEnvironment === "storeClient";

import DashboardScreen        from "../screens/DashboardScreen";
import StudentDashboardScreen from "../screens/StudentDashboardScreen";
import StudentsStack          from "./StudentsStack";
import SetupStack      from "./SetupStack";
import HostelStack     from "./HostelStack";
import TransportScreen from "../screens/Transport/TransportScreen";

const Tab = createBottomTabNavigator();

// ── Shared avatar helper ──────────────────────────────────────────────────────
function useAvatarData() {
  const { user, profilePhoto } = useContext(AuthContext);
  const fullName = (`${user?.firstName ?? ''} ${user?.lastName ?? ''}`).trim()
    || user?.ssmsUserName
    || 'User';
  const initials = (fullName[0] ?? 'U').toUpperCase();
  const base     = (HOST_NAME ?? '').replace(/\/+$/, '');
  const photoUrl = profilePhoto && user?.ssmsClientCode
    ? `${base}/clients/${user.ssmsClientCode}/user/${profilePhoto}`
    : null;
  return { user, fullName, initials, photoUrl };
}

// Renders a photo if available, otherwise just the initials text
function AvatarImg({ photoUrl, initials, size, textStyle }) {
  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2, position: 'absolute' }}
      />
    );
  }
  return <Text style={textStyle}>{initials}</Text>;
}

// ── Shared unread count (written by MainTabs heartbeat, read by all headers) ──
// A simple module-level store so all AppHeader instances share the same value
// without needing Context.
let _globalUnread = 0;
const _unreadListeners = new Set();
function _setGlobalUnread(n) {
  if (n === _globalUnread) return;
  _globalUnread = n;
  _unreadListeners.forEach(fn => fn(n));
}
function useGlobalUnread() {
  const [count, setCount] = React.useState(_globalUnread);
  React.useEffect(() => {
    _unreadListeners.add(setCount);
    return () => _unreadListeners.delete(setCount);
  }, []);
  return count;
}

// ── Custom header ─────────────────────────────────────────────────────────────
function AppHeader({ title, onMorePress }) {
  const { user, fullName, initials, photoUrl } = useAvatarData();
  const insets     = useSafeAreaInsets();
  const unreadCount = useGlobalUnread();

  return (
    <View style={[hd.wrap, { paddingTop: insets.top + 6 }]}>
      {/* Left — avatar + name */}
      <View style={hd.left}>
        <View style={hd.avatar}>
          <AvatarImg photoUrl={photoUrl} initials={initials} size={36} textStyle={hd.avatarTxt} />
        </View>
        <View>
          <Text style={hd.greeting}>Hello,</Text>
          <Text style={hd.username} numberOfLines={1}>{fullName}</Text>
        </View>
      </View>

      {/* Centre — absolutely positioned so it's always truly centred */}
      <View style={hd.titleWrap} pointerEvents="none">
        <Text style={hd.title} numberOfLines={1}>{title}</Text>
      </View>

      {/* Right — More button with unread badge */}
      <View>
        <TouchableOpacity style={hd.moreBtn} onPress={onMorePress} activeOpacity={0.7}>
          <Feather name="menu" size={20} color="#1e40af" />
        </TouchableOpacity>
        {unreadCount > 0 && (
          <View style={hd.badge}>
            <Text style={hd.badgeTxt}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const hd = StyleSheet.create({
  wrap:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0", shadowColor: "#0f172a", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  left:      { flexDirection: "row", alignItems: "center", gap: 9, width: 120 },
  avatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1e40af", alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 15, fontWeight: "800", color: "#fff" },
  greeting:  { fontSize: 10, color: "#94a3b8", lineHeight: 13 },
  username:  { fontSize: 12, fontWeight: "700", color: "#0f172a", maxWidth: 82 },
  titleWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", pointerEvents: "none" },
  title:     { fontSize: 15, fontWeight: "800", color: "#7d5493", letterSpacing: -0.2 },
  moreBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  badge:     { position: "absolute", top: -4, right: -4, backgroundColor: "#ef4444", borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeTxt:  { color: "#fff", fontSize: 9, fontWeight: "800" },
});

// ── More drawer ───────────────────────────────────────────────────────────────
function MoreDrawer({ visible, onClose, navigation }) {
  const { logout, isSubscription } = useContext(AuthContext);
  const { isLocked, guard } = useFeatureLock();
  const { user, fullName, initials, photoUrl } = useAvatarData();
  const insets = useSafeAreaInsets();

  // Fetch WhatsApp community + channel links once per drawer-open (cached after first fetch)
  const [communityLink, setCommunityLink] = useState(null);
  const [channelLink,   setChannelLink]   = useState(null);
  const fetched = useRef(false);
  useEffect(() => {
    if (visible && !fetched.current && user?.token) {
      fetched.current = true;
      fetchInstituteDetails(user)
        .then(d => {
          setCommunityLink(d?.whatsapp_community_link || null);
          setChannelLink(d?.whatsapp_channel_link   || null);
        })
        .catch(() => {});
    }
  }, [visible, user]);

  const handleLogout = () => {
    onClose();
    Alert.alert(
      "Logout",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout", style: "destructive",
          onPress: () => {
            logout(); // auth guard in AppNavigator switches to Login automatically
          },
        },
      ]
    );
  };

  const isAdmin = ["admin", "owner", "super"].includes(
    (user?.ssmsUserRole ?? "").toLowerCase().trim()
  );

  const handleShareApp = useCallback(() => {
    onClose();
    Share.share({
      message: `Download the ManageMyAcademy App:\n${PLAY_STORE_URL}`,
      url:     PLAY_STORE_URL,
      title:   "ManageMyAcademy App",
    }).catch(() => {});
  }, [onClose]);

  const items = [
    { label: "Profile",         icon: "user",      onPress: () => { onClose(); navigation.navigate("UserProfile");  } },
    { label: "Notice Board",    icon: "bell",      screen: "NoticeBoard", onPress: () => { onClose(); navigation.navigate("NoticeBoard"); } },
    // International (subscription) schools only – plan status, trial, Google Play subscribe
    ...(isSubscription ? [{
      label: "Plan & Billing", icon: "credit-card",
      onPress: () => { onClose(); navigation.navigate("Subscription"); },
    }] : []),
    {
      label:   "School Gallery",
      icon:    isAdmin ? "upload-cloud" : "image",
      screen:  isAdmin ? "SchoolMemoriesAdmin" : "SchoolMemories",
      onPress: () => { onClose(); navigation.navigate(isAdmin ? "SchoolMemoriesAdmin" : "SchoolMemories"); },
    },
    { label: "Change Password", icon: "lock",      onPress: () => { onClose(); navigation.navigate("ChangePassword"); } },
    {
      label:   "Contact Support",
      icon:    "headphones",
      onPress: () => {
        onClose();
        navigation.navigate("ContactScreen", {
          token:       user?.token          ?? '',
          userRole:    user?.ssmsUserRole   ?? '',
          clientCode:  user?.ssmsClientCode ?? '',
          userName:    user?.ssmsUserName   ?? '',
          startInForm: true,
        });
      },
    },
    ...(communityLink ? [{
      label:   "Join WhatsApp Community",
      icon:    "message-circle",
      wa:      true,
      onPress: () => { onClose(); Linking.openURL(communityLink).catch(() => {}); },
    }] : []),
    ...(channelLink ? [{
      label:   "Follow WhatsApp Channel",
      icon:    "radio",
      waCh:    true,
      onPress: () => { onClose(); Linking.openURL(channelLink).catch(() => {}); },
    }] : []),
    { label: "Messages",        icon: "message-circle", screen: "ChatList", onPress: () => { onClose(); navigation.navigate("ChatList"); } },
    { divider: true },
    { label: "Share App",  icon: "share-2",  onPress: handleShareApp, accent: true },
    { label: "Logout",     icon: "log-out",  onPress: handleLogout, danger: true },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={dr.overlay} onPress={onClose}>
        <Pressable style={[dr.panel, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>

          {/* User info */}
          <View style={dr.userRow}>
            <View style={dr.avatar}>
              <AvatarImg photoUrl={photoUrl} initials={initials} size={48} textStyle={dr.avatarTxt} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={dr.userName}>{fullName}</Text>
              <Text style={dr.userMeta}>
                {user?.ssmsUserRole ?? ""}{user?.ssmsClientCode ? `  ·  ${user.ssmsClientCode}` : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={dr.closeBtn}>
              <Feather name="x" size={16} color="#64748b" />
            </TouchableOpacity>
          </View>

          <View style={dr.divider} />

          {/* Menu items */}
          {items.map((item, i) =>
            item.divider
              ? <View key={i} style={dr.divider} />
              : (
                <TouchableOpacity
                  key={item.label}
                  style={dr.item}
                  onPress={item.screen ? guard(item.screen, item.onPress) : item.onPress}
                  activeOpacity={0.7}
                >
                  <View style={[dr.itemIcon, item.danger && dr.itemIconDanger, item.accent && dr.itemIconAccent, item.wa && dr.itemIconWa, item.waCh && dr.itemIconWaCh]}>
                    <Feather name={item.icon} size={16} color={isLocked(item.screen) ? "#94a3b8" : item.danger ? "#dc2626" : item.accent ? "#16a34a" : item.wa ? "#15803d" : item.waCh ? "#6b21a8" : "#1e40af"} />
                    {isLocked(item.screen) && <LockBadge size={8} style={{ width: 15, height: 15, top: -4, right: -4 }} />}
                  </View>
                  <Text style={[dr.itemLabel, item.danger && dr.itemLabelDanger, item.accent && dr.itemLabelAccent, item.wa && dr.itemLabelWa, item.waCh && dr.itemLabelWaCh]}>
                    {item.label}
                  </Text>
                  <Feather name="chevron-right" size={14} color={item.danger ? "#fca5a5" : "#cbd5e1"} />
                </TouchableOpacity>
              )
          )}
          <Text style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
            {APP_VERSION_LABEL}
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const dr = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  panel:         { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 20, paddingHorizontal: 20 },
  userRow:       { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  avatar:        { width: 48, height: 48, borderRadius: 24, backgroundColor: "#1e40af", alignItems: "center", justifyContent: "center" },
  avatarTxt:     { fontSize: 20, fontWeight: "800", color: "#fff" },
  userName:      { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  userMeta:      { fontSize: 12, color: "#64748b", marginTop: 2, textTransform: "capitalize" },
  closeBtn:      { width: 30, height: 30, borderRadius: 8, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" },
  divider:       { height: 1, backgroundColor: "#f1f5f9", marginVertical: 8 },
  item:          { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  itemIcon:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  itemIconDanger:  { backgroundColor: "#fee2e2" },
  itemIconAccent:  { backgroundColor: "#dcfce7" },
  itemLabel:       { flex: 1, fontSize: 14, fontWeight: "600", color: "#0f172a" },
  itemLabelDanger: { color: "#dc2626" },
  itemLabelAccent: { color: "#16a34a" },
  itemIconWa:       { backgroundColor: "#dcfce7" },
  itemLabelWa:      { color: "#15803d" },
  itemIconWaCh:     { backgroundColor: "#f3e8ff" },
  itemLabelWaCh:    { color: "#6b21a8" },
});

// ── Tab screen wrapper — injects custom header ────────────────────────────────
function TabScreen({ title, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // navigation ref passed down via children is messy — use the top-level nav
  return null; // placeholder — see withHeader HOC below
}

// HOC that wraps a screen component with our custom header
function withHeader(WrappedComponent, title) {
  return function ScreenWithHeader({ navigation }) {
    const [drawerOpen, setDrawerOpen] = useState(false);
    return (
      <View style={{ flex: 1, backgroundColor: "#f8fafc" }}>
        <AppHeader title={title} onMorePress={() => setDrawerOpen(true)} />
        <WrappedComponent navigation={navigation} />
        <MoreDrawer
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          navigation={navigation}
        />
      </View>
    );
  };
}

// Wrapped screen components
const DashboardWithHeader        = withHeader(DashboardScreen,        "Dashboard");
const StudentDashboardWithHeader = withHeader(StudentDashboardScreen, "Home");
const TransportWithHeader        = withHeader(TransportScreen,        "Transport");

// Stack navigators — header applied at wrapper level so all child screens get it
function StudentsWithHeader({ navigation }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title="School" onMorePress={() => setDrawerOpen(true)} />
      <StudentsStack />
      <MoreDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigation={navigation} />
    </View>
  );
}

function HostelWithHeader({ navigation }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title="Hostel" onMorePress={() => setDrawerOpen(true)} />
      <HostelStack />
      <MoreDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigation={navigation} />
    </View>
  );
}

function SetupWithHeader({ navigation }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title="Setup" onMorePress={() => setDrawerOpen(true)} />
      <SetupStack />
      <MoreDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} navigation={navigation} />
    </View>
  );
}

// ── Main Tabs ─────────────────────────────────────────────────────────────────
export default function MainTabs({ navigation }) {
  const { user } = useContext(AuthContext);
  const { isLocked, showUpgradePrompt, featureOf } = useFeatureLock();
  const role = (user?.ssmsUserRole ?? '').toLowerCase().trim();
  const isStudentOrParent = role === 'student' || role === 'parent';
  const insets = useSafeAreaInsets();

  // ── Push token registration ────────────────────────────────────────────────
  const pushTokenRef = useRef(null);
  useEffect(() => {
    if (!user) return;
    if (IS_EXPO_GO) return; // push not available in Expo Go – use a development build
    (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') return;
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: 'c9de8370-e67a-4710-bcd4-1ab5869a3b02',
        });
        pushTokenRef.current = tokenData.data;
        // Android notification channel
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('chat', {
            name: 'Chat messages',
            importance: Notifications.AndroidImportance.HIGH,
            sound: true,
          });
        }
      } catch (e) {
        // Push token registration failures are non-fatal
      }
    })();
  }, [user]);

  // ── Heartbeat: keep presence alive every 30 s while app is in foreground ──
  useEffect(() => {
    if (!user) return;
    const beat = async () => {
      const result = await sendHeartbeat(user, pushTokenRef.current);
      if (result != null) _setGlobalUnread(result);
    };
    beat();
    const interval = setInterval(beat, 30_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') beat();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [user]);

  const tabIcons = {
    Dashboard:   "home",
    School:      "book-open",
    "My Portal": "grid",
    Hostel:      "home",
    Transport:   "truck",
    Setup:       "settings",
  };

  return (
    <Tab.Navigator
      screenLayout={featureScreenLayout}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor:   "#2563eb",
        tabBarInactiveTintColor: "#64748b",
        tabBarStyle: {
          height: 72 + insets.bottom, paddingBottom: insets.bottom + 4, paddingTop: 8,
          backgroundColor: "#fff", borderTopColor: "#e2e8f0",
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        tabBarIcon: ({ color, focused }) => (
          <View style={[tb.iconWrap, focused && tb.iconActive]}>
            <Feather name={tabIcons[route.name] ?? "circle"} size={22} color={isLocked(route.name) ? "#94a3b8" : color} />
            {isLocked(route.name) && <LockBadge size={8} style={{ width: 15, height: 15, top: 0, right: 0 }} />}
          </View>
        ),
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={isStudentOrParent ? StudentDashboardWithHeader : DashboardWithHeader}
      />

      {isStudentOrParent ? (
        <Tab.Screen
          name="My Portal"
          component={StudentsWithHeader}
          options={{ tabBarLabel: "My Portal" }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              e.preventDefault();
              navigation.navigate("My Portal", { screen: "StudentsList" });
            },
          })}
        />
      ) : (
        <>
          <Tab.Screen
            name="School"
            component={StudentsWithHeader}
            listeners={({ navigation }) => ({
              tabPress: (e) => {
                e.preventDefault();
                navigation.navigate("School", { screen: "StudentsList" });
              },
            })}
          />
          <Tab.Screen
            name="Hostel"
            component={HostelWithHeader}
            listeners={({ navigation }) => ({
              tabPress: (e) => {
                e.preventDefault();
                if (isLocked("Hostel")) { showUpgradePrompt(featureOf("Hostel")); return; }
                navigation.navigate("Hostel", { screen: "HostelHome" });
              },
            })}
          />
          <Tab.Screen
            name="Transport"
            component={TransportWithHeader}
            listeners={() => ({
              tabPress: (e) => {
                if (isLocked("Transport")) { e.preventDefault(); showUpgradePrompt(featureOf("Transport")); }
              },
            })}
          />
          <Tab.Screen
            name="Setup"
            component={SetupWithHeader}
            listeners={({ navigation }) => ({
              tabPress: (e) => {
                e.preventDefault();
                navigation.navigate("Setup", { screen: "SetupHome" });
              },
            })}
          />
        </>
      )}
    </Tab.Navigator>
  );
}

const tb = StyleSheet.create({
  iconWrap:  { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  iconActive:{ backgroundColor: "#eff6ff" },
});