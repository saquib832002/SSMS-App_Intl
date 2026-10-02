/**
 * screens/SchoolMemoriesScreen.js
 * School Memories — photo gallery viewer for all users.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, Image, Modal,
  StyleSheet, Dimensions, ActivityIndicator, StatusBar, RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { fetchGalleryPhotos } from "../services/GalleryServiceApi";

const { width: SW } = Dimensions.get("window");
const COLS   = 3;
const THUMB  = Math.floor((SW - 4) / COLS); // 3-col grid, 2px gaps

// ── Lightbox ─────────────────────────────────────────────────────────────────
function Lightbox({ photos, index, onClose }) {
  const [current, setCurrent] = useState(index);
  const insets = useSafeAreaInsets();
  const photo  = photos[current];

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar backgroundColor="#000" barStyle="light-content" />
      <View style={lb.root}>

        {/* Close */}
        <TouchableOpacity style={[lb.closeBtn, { top: insets.top + 12 }]} onPress={onClose}>
          <Feather name="x" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Counter */}
        <View style={[lb.counter, { top: insets.top + 14 }]}>
          <Text style={lb.counterTxt}>{current + 1} / {photos.length}</Text>
        </View>

        {/* Photo */}
        <Image
          source={{ uri: photo.url }}
          style={lb.photo}
          resizeMode="contain"
        />

        {/* Caption */}
        {!!photo.caption && (
          <View style={[lb.captionBar, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={lb.captionTxt}>{photo.caption}</Text>
          </View>
        )}

        {/* Prev / Next */}
        {current > 0 && (
          <TouchableOpacity style={[lb.nav, lb.navLeft]} onPress={() => setCurrent(c => c - 1)}>
            <Feather name="chevron-left" size={30} color="#fff" />
          </TouchableOpacity>
        )}
        {current < photos.length - 1 && (
          <TouchableOpacity style={[lb.nav, lb.navRight]} onPress={() => setCurrent(c => c + 1)}>
            <Feather name="chevron-right" size={30} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

// ── Grid thumbnail ────────────────────────────────────────────────────────────
const Thumb = React.memo(function Thumb({ photo, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ width: THUMB, height: THUMB, margin: 1 }}>
      <Image source={{ uri: photo.url }} style={st.thumb} resizeMode="cover" />
      {!!photo.caption && (
        <View style={st.thumbCaption}>
          <Text style={st.thumbCaptionTxt} numberOfLines={1}>{photo.caption}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
export default function SchoolMemoriesScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const [photos,     setPhotos]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lightbox,   setLightbox]   = useState(null); // index or null

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const { photos: data } = await fetchGalleryPhotos(user);
      setPhotos(data);
    } catch (e) {
      console.warn("[SchoolMemories] load error:", e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  const renderItem = useCallback(({ item, index }) => (
    <Thumb photo={item} onPress={() => setLightbox(index)} />
  ), []);

  return (
    <SafeAreaView style={st.safe} edges={["top"]}>

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Feather name="arrow-left" size={20} color="#2563eb" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>School Memories</Text>
          {photos.length > 0 && (
            <Text style={st.headerSub}>{photos.length} photo{photos.length !== 1 ? "s" : ""}</Text>
          )}
        </View>
      </View>

      {/* Grid */}
      {loading ? (
        <View style={st.center}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : photos.length === 0 ? (
        <View style={st.center}>
          <Feather name="image" size={56} color="#cbd5e1" />
          <Text style={st.emptyTitle}>No photos yet</Text>
          <Text style={st.emptySub}>The school admin hasn't uploaded any photos yet.</Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={p => String(p.id)}
          renderItem={renderItem}
          numColumns={COLS}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#2563eb"]} />}
          getItemLayout={(_, index) => ({ length: THUMB + 2, offset: (THUMB + 2) * Math.floor(index / COLS), index })}
        />
      )}

      {/* Lightbox */}
      {lightbox !== null && (
        <Lightbox
          photos={photos}
          index={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#000" },
  header:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff", gap: 12 },
  backBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  headerTitle:     { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  headerSub:       { fontSize: 12, color: "#64748b", marginTop: 1 },
  center:          { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc", gap: 12, padding: 32 },
  emptyTitle:      { fontSize: 18, fontWeight: "700", color: "#334155" },
  emptySub:        { fontSize: 14, color: "#94a3b8", textAlign: "center" },
  thumb:           { width: "100%", height: "100%", backgroundColor: "#1e293b" },
  thumbCaption:    { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 4, paddingVertical: 3 },
  thumbCaptionTxt: { color: "#fff", fontSize: 9, fontWeight: "600" },
});

const lb = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" },
  closeBtn:   { position: "absolute", left: 16, zIndex: 10, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 22, padding: 8 },
  counter:    { position: "absolute", right: 16, zIndex: 10, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  counterTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },
  photo:      { width: SW, height: "75%" },
  captionBar: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 20, paddingTop: 12 },
  captionTxt: { color: "#fff", fontSize: 14, fontWeight: "500", textAlign: "center" },
  nav:        { position: "absolute", top: "45%", backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 28, padding: 10 },
  navLeft:    { left: 12 },
  navRight:   { right: 12 },
});
