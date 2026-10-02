/**
 * screens/SchoolMemoriesAdminScreen.js
 * Admin screen — upload and manage School Memories photos.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, Image, Alert,
  StyleSheet, Dimensions, ActivityIndicator, TextInput, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AuthContext } from "../context/AuthContext";
import {
  fetchGalleryPhotos,
  uploadGalleryPhoto,
  deleteGalleryPhoto,
} from "../services/GalleryServiceApi";

const { width: SW } = Dimensions.get("window");
const COLS  = 3;
const THUMB = Math.floor((SW - 32 - (COLS - 1) * 8) / COLS);

// ── Upload progress modal ─────────────────────────────────────────────────────
function UploadModal({ visible }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={um.overlay}>
        <View style={um.box}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={um.txt}>Uploading…</Text>
        </View>
      </View>
    </Modal>
  );
}

// ── Single photo tile ─────────────────────────────────────────────────────────
const PhotoTile = React.memo(function PhotoTile({ photo, onDelete }) {
  return (
    <View style={st.tile}>
      <Image source={{ uri: photo.url }} style={st.tileImg} resizeMode="cover" />
      {!!photo.caption && (
        <View style={st.tileCaptionBar}>
          <Text style={st.tileCaptionTxt} numberOfLines={1}>{photo.caption}</Text>
        </View>
      )}
      <TouchableOpacity style={st.deleteBtn} onPress={() => onDelete(photo)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <Feather name="trash-2" size={13} color="#fff" />
      </TouchableOpacity>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
export default function SchoolMemoriesAdminScreen({ navigation }) {
  const { user } = useContext(AuthContext);

  const [photos,      setPhotos]      = useState([]);
  const [photoLimit,  setPhotoLimit]  = useState(10); // updated from server on load
  const [loading,     setLoading]     = useState(true);
  const [uploading,   setUploading]   = useState(false);
  const [caption,     setCaption]     = useState("");
  const [pending,     setPending]     = useState(null); // { uri } picked but not uploaded yet

  const atLimit = photos.length >= photoLimit;

  // ── Load existing photos ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { photos, limit } = await fetchGalleryPhotos(user);
      setPhotos(photos);
      setPhotoLimit(limit);
    } catch (e) {
      Alert.alert("Error", e?.message ?? "Failed to load photos");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Pick image from library ──────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    if (atLimit) {
      Alert.alert(
        "Gallery Full",
        `You've reached the maximum of ${photoLimit} photos. Delete a photo to make room for a new one.`
      );
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Please allow access to your photo library.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",   // string literal — compatible with all expo-image-picker versions
        quality:    0.8,
        allowsEditing: true,
      });
      if (!result.canceled && result.assets?.length) {
        setPending({ uri: result.assets[0].uri });
        setCaption("");
      }
    } catch (e) {
      Alert.alert("Error", e?.message ?? "Could not open photo library.");
    }
  }, [atLimit, photoLimit]);

  // ── Upload ───────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!pending) return;
    try {
      setUploading(true);
      const newPhoto = await uploadGalleryPhoto(user, pending.uri, caption.trim());
      setPhotos(prev => [{ ...newPhoto, caption: caption.trim() }, ...prev]);
      setPending(null);
      setCaption("");
    } catch (e) {
      Alert.alert("Upload Failed", e?.message ?? "Something went wrong");
    } finally {
      setUploading(false);
    }
  }, [pending, caption, user]);

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = useCallback((photo) => {
    Alert.alert(
      "Delete Photo",
      photo.caption ? `Delete "${photo.caption}"?` : "Delete this photo?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await deleteGalleryPhoto(user, photo.id);
              setPhotos(prev => prev.filter(p => p.id !== photo.id));
            } catch (e) {
              Alert.alert("Delete Failed", e?.message ?? "Could not delete photo. Please try again.");
            }
          },
        },
      ]
    );
  }, [user]);

  const renderItem = useCallback(({ item }) => (
    <PhotoTile photo={item} onDelete={handleDelete} />
  ), [handleDelete]);

  return (
    <SafeAreaView style={st.safe} edges={["top"]}>
      <UploadModal visible={uploading} />

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Feather name="arrow-left" size={20} color="#2563eb" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>Manage Memories</Text>
          <Text style={st.headerSub}>
            {loading ? "Loading…" : `${photos.length} / ${photoLimit} photos`}
          </Text>
        </View>
        <TouchableOpacity
          style={[st.addBtn, atLimit && st.addBtnDisabled]}
          onPress={pickImage}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={18} color="#fff" />
          <Text style={st.addBtnTxt}>{atLimit ? "Limit Reached" : "Add Photo"}</Text>
        </TouchableOpacity>
      </View>

      {/* Limit banner */}
      {atLimit && !pending && (
        <View style={st.limitBanner}>
          <Feather name="info" size={14} color="#92400e" />
          <Text style={st.limitTxt}>
            Gallery is full ({photoLimit}/{photoLimit}). Delete a photo to upload a new one.
          </Text>
        </View>
      )}

      {/* Pending upload card */}
      {pending && (
        <View style={st.uploadCard}>
          <Image source={{ uri: pending.uri }} style={st.previewImg} resizeMode="cover" />
          <View style={{ flex: 1 }}>
            <TextInput
              style={st.captionInput}
              placeholder="Caption (optional)"
              placeholderTextColor="#94a3b8"
              value={caption}
              onChangeText={setCaption}
              maxLength={120}
            />
            <View style={st.uploadRow}>
              <TouchableOpacity style={st.cancelUploadBtn} onPress={() => setPending(null)}>
                <Text style={st.cancelUploadTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.uploadBtn} onPress={handleUpload}>
                <Feather name="upload-cloud" size={15} color="#fff" />
                <Text style={st.uploadBtnTxt}>Upload</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Photo grid */}
      {loading ? (
        <View style={st.center}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : photos.length === 0 && !pending ? (
        <View style={st.center}>
          <Feather name="image" size={56} color="#cbd5e1" />
          <Text style={st.emptyTitle}>No photos yet</Text>
          <Text style={st.emptySub}>Tap "Add Photo" to upload your first memory.</Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={p => String(p.id)}
          renderItem={renderItem}
          numColumns={COLS}
          contentContainerStyle={st.grid}
          columnWrapperStyle={{ gap: 8 }}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#f8fafc" },
  header:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", gap: 12 },
  backBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  headerTitle:     { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  headerSub:       { fontSize: 12, color: "#64748b", marginTop: 1 },
  addBtn:          { flexDirection: "row", alignItems: "center", backgroundColor: "#2563eb", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, gap: 6 },
  addBtnDisabled:  { backgroundColor: "#94a3b8" },
  addBtnTxt:       { color: "#fff", fontWeight: "700", fontSize: 13 },

  limitBanner:     { flexDirection: "row", alignItems: "center", gap: 8, margin: 12, marginBottom: 0, backgroundColor: "#fef3c7", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  limitTxt:        { flex: 1, fontSize: 12, color: "#92400e", fontWeight: "500" },

  uploadCard:      { flexDirection: "row", gap: 12, margin: 16, backgroundColor: "#fff", borderRadius: 16, padding: 12, elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  previewImg:      { width: 80, height: 80, borderRadius: 10, backgroundColor: "#e2e8f0" },
  captionInput:    { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: "#0f172a", marginBottom: 10, backgroundColor: "#f8fafc" },
  uploadRow:       { flexDirection: "row", gap: 8 },
  cancelUploadBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  cancelUploadTxt: { fontSize: 13, fontWeight: "600", color: "#64748b" },
  uploadBtn:       { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#16a34a", paddingVertical: 9, borderRadius: 10, gap: 6 },
  uploadBtnTxt:    { color: "#fff", fontWeight: "700", fontSize: 13 },

  grid:            { padding: 16, paddingTop: 12, gap: 8 },
  tile:            { width: THUMB, height: THUMB, borderRadius: 10, overflow: "hidden", backgroundColor: "#1e293b" },
  tileImg:         { width: "100%", height: "100%" },
  tileCaptionBar:  { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 4, paddingVertical: 3 },
  tileCaptionTxt:  { color: "#fff", fontSize: 8, fontWeight: "600" },
  deleteBtn:       { position: "absolute", top: 5, right: 5, backgroundColor: "rgba(220,38,38,0.85)", borderRadius: 14, padding: 5 },

  center:          { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyTitle:      { fontSize: 18, fontWeight: "700", color: "#334155" },
  emptySub:        { fontSize: 14, color: "#94a3b8", textAlign: "center" },
});

const um = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  box:     { backgroundColor: "#fff", borderRadius: 16, padding: 28, alignItems: "center", gap: 14, minWidth: 180 },
  txt:     { fontSize: 14, fontWeight: "600", color: "#334155" },
});
