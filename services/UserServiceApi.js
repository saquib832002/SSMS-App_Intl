//const BASE_URL = "http://192.168.4.90/ssms5/UserServiceApi";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";
// Strip trailing slash so URLs never have double-slash
const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");

const buildHeaders = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

// ── Helper: safely parse JSON from a raw response string ─────────────────────
function safeJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── Helper: trim a value safely ───────────────────────────────────────────────
function t(val) {
  return (val ?? "").toString().trim();
}


// ── Sign-up config (public, no login) ────────────────────────────────────────
// Current free-trial length set by the platform owner. Returns { trialDays }
// or null if the server can't be reached (callers fall back to 14).
export const fetchSignupConfig = async () => {
  try {
    const res  = await fetch(`${BASE_URL}/UserServiceApi/getSignupConfig`, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === false) return null;
    return data.data ?? null;
  } catch {
    return null;
  }
};

// ── Entitlements (billing model + active modules) ────────────────────────────
// Returns { billingModel, activeModules, moduleExpiries } or null on failure.
export const fetchEntitlements = async (user) => {
  const response = await safeFetch(`${BASE_URL}/UserServiceApi/getEntitlements`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) return null;
  return data.data ?? null;
};

// ── User Profile ─────────────────────────────────────────────────────────────
export const fetchUserProfile = async (user) => {
  const response = await safeFetch(`${BASE_URL}/UserServiceApi/getUserProfile`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false)
    throw new Error(data.message || "Failed to load profile");
  return data.data ?? null;
};

// ── Student / Parent user account management ──────────────────────────────────
export const fetchStudentUsers = async (user, statusFilter = '') => {
  const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
  const res  = await safeFetch(`${BASE_URL}/UserServiceApi/getStudentUsers${qs}`, {
    method: 'GET',
    headers: buildHeaders(user),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error(data.message || 'Failed to load accounts');
  return data.data ?? [];
};

export const toggleStudentUserStatus = async (user, userName, status) => {
  const res  = await safeFetch(`${BASE_URL}/UserServiceApi/toggleStudentUserStatus`, {
    method:  'POST',
    headers: buildHeaders(user),
    body:    JSON.stringify({ userName, status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error(data.message || 'Failed to update status');
  return data;
};

export const registerTrialUser = ({ form, photoAsset, onProgress }) => {
  return new Promise((resolve, reject) => {
    if (!form) return reject(new Error("registerTrialUser: form is missing"));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/UserServiceApi/registerTrialUser`);
    xhr.timeout = 30000;

    xhr.onload = () => {
      const text = xhr.responseText || "";
      //console.log("registerTrialUser status:", xhr.status);
     // console.log("registerTrialUser response:", text.substring(0, 300));
      const json = safeJsonFromText(text);
      if (!json) {
        return reject(new Error(`Server did not return JSON (HTTP ${xhr.status}). Preview: ${text.slice(0, 120)}`));
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.status !== false) {
        resolve(json);
      } else {
        reject(new Error(json.message || `Request failed HTTP ${xhr.status}`));
      }
    };

    xhr.onerror   = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Request timed out after 30s"));

    if (xhr.upload && typeof onProgress === "function") {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }

    const fd = new FormData();
    fd.append("firstName",    t(form.firstName));
    fd.append("lastName",     t(form.lastName));
    fd.append("emailAddress", t(form.emailAddress));
    fd.append("mobileNumber", t(form.mobileNumber));
    fd.append("dob",          t(form.dob));
    fd.append("nationality",  t(form.nationality));
    fd.append("userName",     t(form.userName));
    fd.append("userPassword", t(form.userPassword));

    if (photoAsset?.uri) {
      const uri = photoAsset.uri;
      const ext  = (uri.split(".").pop() || "jpg").toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      fd.append("userPhoto", { uri, name: `user.${ext}`, type: mime });
    }

    xhr.send(fd);
  });
};


export const fetchUsers = async (user) => {
  const response = await safeFetch(`${BASE_URL}/UserServiceApi/getUsers`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) {
    throw new Error(data.message || "Failed to fetch users");
  }
  return data;
};

export const createUser = async (payload, user) => {
  const response = await safeFetch(`${BASE_URL}/UserServiceApi/createUser`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) {
    throw new Error(data.message || "Failed to create user");
  }
  return data;
};

export const updateUser = async (userName, payload, user) => {
  const response = await safeFetch(`${BASE_URL}/UserServiceApi/updateUser/${userName}`, {
    method: "PUT",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) {
    throw new Error(data.message || "Failed to update user");
  }
  return data;
};

export const deleteUser = async (userName, user) => {
  const response = await safeFetch(`${BASE_URL}/UserServiceApi/deleteUser/${userName}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) {
    throw new Error(data.message || "Failed to delete user");
  }
  return data;
};

export const sendForgotPasswordCode = async (payload) => {
  const response = await fetch(`${BASE_URL}/UserServiceApi/sendForgotPasswordCode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || data.status === false) {
    throw new Error(data.message || "Failed to send code");
  }

  return data;
};

export const verifyForgotPasswordCode = async (payload) => {
  const response = await fetch(`${BASE_URL}/UserServiceApi/verifyForgotPasswordCode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || data.status === false) {
    throw new Error(data.message || "Invalid verification code");
  }

  return data;
};

export const resetForgotPassword = async (payload) => {
  const response = await fetch(`${BASE_URL}/UserServiceApi/resetPassword`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || data.status === false) {
    throw new Error(data.message || "Failed to reset password");
  }

  return data;
};
// ── Update User Photo ─────────────────────────────────────────────────────────
export const updateUserPhoto = (user, photoAsset) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/UserServiceApi/updateUserPhoto`);
    xhr.timeout = 30000;

    xhr.setRequestHeader("ssmsUserName",   user?.ssmsUserName   ?? "");
    xhr.setRequestHeader("ssmsUserRole",   user?.ssmsUserRole   ?? "");
    xhr.setRequestHeader("ssmsClientCode", user?.ssmsClientCode ?? "");
    if (user?.token) xhr.setRequestHeader("Authorization", `Bearer ${user.token}`);

    xhr.onload = () => {
      const text  = xhr.responseText || "";
      const start = text.indexOf("{");
      const end   = text.lastIndexOf("}");
      try {
        const json = JSON.parse(start > -1 ? text.slice(start, end + 1) : text);
        if (xhr.status >= 200 && xhr.status < 300 && json.status !== false)
          resolve(json);
        else
          reject(new Error(json.message || `HTTP ${xhr.status}`));
      } catch {
        reject(new Error("Invalid server response"));
      }
    };
    xhr.onerror   = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Request timed out"));

    const fd  = new FormData();
    const uri = photoAsset.uri;
    const ext = (uri.split(".").pop() || "jpg").toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    fd.append("user_photo", { uri, name: `photo.${ext}`, type: mime });
    xhr.send(fd);
  });
};

// ── Change Password ───────────────────────────────────────────────────────────
export const changePassword = async (currentPassword, newPassword, user) => {
  const response = await safeFetch(`${BASE_URL}/UserServiceApi/changePassword`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false)
    throw new Error(data.message || "Failed to change password");
  return data;
};

// ── Institute Details ─────────────────────────────────────────────────────────

export const fetchInstituteDetails = async (user) => {
  const response = await safeFetch(`${BASE_URL}/UserServiceApi/getInstituteDetails`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false)
    throw new Error(data.message || "Failed to fetch institute details");
  return data.data ?? null;
};

export const updateInstituteDetails = (user, payload, logoAsset) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/UserServiceApi/updateInstituteDetails`);
    xhr.timeout = 30000;

    // Set auth headers (no Content-Type — browser sets it for FormData)
    xhr.setRequestHeader("ssmsUserName",   user?.ssmsUserName   ?? "");
    xhr.setRequestHeader("ssmsUserRole",   user?.ssmsUserRole   ?? user?.role ?? "");
    xhr.setRequestHeader("ssmsClientCode", user?.ssmsClientCode ?? "");
    if (user?.token) xhr.setRequestHeader("Authorization", `Bearer ${user.token}`);

    xhr.onload = () => {
      const text = xhr.responseText || "";
      const start = text.indexOf("{");
      const end   = text.lastIndexOf("}");
      try {
        const json = JSON.parse(start > -1 ? text.slice(start, end + 1) : text);
        if (xhr.status >= 200 && xhr.status < 300 && json.status !== false)
          resolve(json);
        else
          reject(new Error(json.message || `HTTP ${xhr.status}`));
      } catch {
        reject(new Error("Invalid server response"));
      }
    };
    xhr.onerror   = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Request timed out"));

    const fd = new FormData();
    const fields = [
      "ssms_client_name","ssms_client_address","ssms_client_city",
      "ssms_client_state","ssms_client_zip","ssms_client_email",
      "ssms_client_phone","ssms_client_header_text","currency",
      "enroll_prefix","registration_prefix","upi_id","pay_account_name",
      "whatsapp_community_link","whatsapp_channel_link",
    ];
    fields.forEach(f => fd.append(f, t(payload[f])));

    if (logoAsset?.uri) {
      const uri  = logoAsset.uri;
      const name = logoAsset.name ?? ("logo." + (uri.split(".").pop() || "jpg"));
      const mime = logoAsset.mimeType
        ?? (name.endsWith(".png")  ? "image/png"
          : name.endsWith(".webp") ? "image/webp"
          : name.endsWith(".gif")  ? "image/gif"
          : "image/jpeg");
      fd.append("logo", { uri, name, type: mime });
    }

    xhr.send(fd);
  });
};