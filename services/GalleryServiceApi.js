/**
 * services/GalleryServiceApi.js
 * School Memories photo gallery API functions.
 */
import { BASE_URL, HOST_NAME } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";

const buildHeaders = (user) => ({
  Accept:         "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? user?.username   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role       ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? user?.clientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

// Build a gallery photo URL from a fileName — matches student/user photo convention
const galleryUrl = (clientCode, fileName) => {
  const base = (HOST_NAME ?? "").replace(/\/+$/, "");
  return `${base}/clients/${clientCode}/gallery/${fileName}`;
};

// ── Fetch all active gallery photos ──────────────────────────────────────────
// Returns { photos: [...], limit: N } — limit comes from the server (per-client config).
export const fetchGalleryPhotos = async (user) => {
  const res  = await safeFetch(`${BASE_URL}SchoolGalleryApi/getPhotos`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(json?.message ?? "Failed to load gallery");
  const clientCode = user?.ssmsClientCode ?? "";
  const photos = (json.photos ?? []).map(p => ({
    ...p,
    url: galleryUrl(clientCode, p.fileName),
  }));
  return { photos, limit: json.limit ?? 10 };
};

// ── Upload a new photo (admin only) ──────────────────────────────────────────
export const uploadGalleryPhoto = async (user, imageUri, caption = "") => {
  const fileName = imageUri.split("/").pop();
  const ext      = (fileName.split(".").pop() ?? "jpg").toLowerCase();
  const mimeMap  = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  const mimeType = mimeMap[ext] ?? "image/jpeg";

  const form = new FormData();
  form.append("photo",   { uri: imageUri, name: fileName, type: mimeType });
  form.append("caption", caption);

  const headers = buildHeaders(user);
  // Do NOT set Content-Type — let fetch set multipart boundary automatically
  delete headers["Accept"];

  const res  = await safeFetch(`${BASE_URL}SchoolGalleryApi/uploadPhoto`, {
    method:  "POST",
    headers: { ...headers, Accept: "application/json" },
    body:    form,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status === false) throw new Error(json?.message ?? "Upload failed");
  const clientCode = user?.ssmsClientCode ?? "";
  return {
    ...json.photo,
    url: galleryUrl(clientCode, json.photo.fileName),
  };
};

// ── Delete a photo (admin only) ───────────────────────────────────────────────
export const deleteGalleryPhoto = async (user, photoId) => {
  const res  = await safeFetch(`${BASE_URL}SchoolGalleryApi/deletePhoto`, {
    method:  "POST",
    headers: { ...buildHeaders(user), "Content-Type": "application/json" },
    body:    JSON.stringify({ id: photoId }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.status === false) throw new Error(json?.message ?? "Delete failed");
  return true;
};
