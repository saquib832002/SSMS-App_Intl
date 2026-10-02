// ============================================
// components/AppDrawer.js
// ============================================
import React, { useContext } from "react";
import { Modal, Pressable, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { AuthContext } from "../context/AuthContext";

export default function AppDrawer({ visible, onClose }) {
  const navigation = useNavigation();
  const { logout, user } = useContext(AuthContext);

  const menuItems = [
    {
      label: "Profile",
      icon: "user",
      action: () => {
        onClose();
        navigation.navigate("Profile");
      },
    },
    {
      label: "Settings",
      icon: "settings",
      action: () => {
        onClose();
        navigation.navigate("Settings");
      },
    },
    {
      label: "Admin",
      icon: "shield",
      action: () => {
        onClose();
        navigation.navigate("Admin");
      },
    },
    {
      label: "Notifications",
      icon: "bell",
      action: () => {
        onClose();
        navigation.navigate("Notifications");
      },
    },
    {
      label: "Logout",
      icon: "log-out",
      action: () => {
        onClose();
        logout();
      },
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={drawerStyles.overlay} onPress={onClose}>
        <Pressable style={drawerStyles.sidePanel} onPress={() => {}}>
          <View style={drawerStyles.panelHeader}>
            <View style={drawerStyles.avatarCircle}>
              <Feather name="user" size={22} color="#fff" />
            </View>
            <View>
              <Text style={drawerStyles.panelTitle}>{user?.name || "School User"}</Text>
              <Text style={drawerStyles.panelSubtitle}>Quick actions & account</Text>
            </View>
          </View>

          {menuItems.map((item) => (
            <TouchableOpacity key={item.label} style={drawerStyles.menuItem} onPress={item.action}>
              <Feather name={item.icon} size={18} color="#334155" />
              <Text style={drawerStyles.menuText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const drawerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
  },
  sidePanel: {
    width: "72%",
    maxWidth: 320,
    height: "100%",
    backgroundColor: "#ffffff",
    paddingTop: 58,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: -4, height: 0 },
    elevation: 12,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  panelSubtitle: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 2,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  menuText: {
    marginLeft: 12,
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
});
