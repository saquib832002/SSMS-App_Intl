// ===============================
// services/api.js
// ===============================
import { safeFetch } from './apiInterceptor';

import { BASE_URL } from "../Environment/EnvironmentConfig";

//const BASE_URL = "http://192.168.4.90/ssms5/StudentApi"; // change to PC IP on real device

const buildHeaders = (user) => ({
  Accept:            "application/json",
  "Content-Type":    "application/json",
  ssmsUserName:      user?.ssmsUserName   ?? user?.username   ?? "",
  ssmsUserRole:      user?.ssmsUserRole   ?? user?.role       ?? "",
  ssmsClientCode:    user?.ssmsClientCode ?? user?.clientCode ?? "",
  ssmsEnrollmentId:  user?.enrollmentId   ?? "",
  branchId:          user?.branchId       ?? "",
  Authorization:     user?.token ? `Bearer ${user.token}` : "",
});

const safeJsonFromText = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// ✅ fetch with timeout for GET APIs
export const fetchWithTimeout = async (url, options = {}, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await safeFetch(url, { ...options, signal: controller.signal });
    // Note: checkExpired is already called inside safeFetch — do not call again here.
    const text = await res.text();
    const json = safeJsonFromText(text);
    if (!res.ok || !json) {
      throw new Error(json?.message || `HTTP ${res.status}: ${text?.slice(0, 120)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
};

// Fetch all classes
// export const fetchClasses = async (user) => {
//   const response = await fetch(`${BASE_URL}/StudentApi/getClasses`, {
//     method: "GET",
//     headers: buildHeaders(user),
//   });
//   const json = await response.json().catch(() => null);
//   if (!response.ok || !json) throw new Error("Failed to load classes");
//   return json.data ?? [];
// };

export const fetchClasses = async (user) => {
  const params = new URLSearchParams();
  if (user?.branchId)       params.append("branchId",       String(user.branchId));
  if (user?.ssmsClientCode) params.append("ssmsClientCode", String(user.ssmsClientCode));

  const qs  = params.toString();
  const url = `${BASE_URL}/StudentApi/getClasses${qs ? `?${qs}` : ""}`;

  const response = await safeFetch(url, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw new Error(
      `fetchClasses failed — Status: ${response.status} | ` +
      (json?.message ?? "No JSON returned")
    );
  }
  return json.data ?? json.classes ?? [];
};

// Fetch all sessions
export const fetchSessions = async (user) => {
  const response = await safeFetch(`${BASE_URL}/StudentApi/getSessions`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw new Error("Failed to load sessions");
  return json.data ?? [];
};

// Fetch all branches
export const fetchBranches = async (user) => {
  const response = await safeFetch(`${BASE_URL}/StudentApi/getBranches`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw new Error("Failed to load branches");
  return json.data ?? [];
};

// Fetch all sections
export const fetchSections = async (user, classId) => {
  const response = await safeFetch(`${BASE_URL}/StudentApi/getSections?classId=${classId}`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw new Error("Failed to load sections");
  return json.data ?? [];
};



// export const registerStudent = ({ form, photoAsset, user, onProgress }) => {
//   return new Promise((resolve, reject) => {
//     if (!form) return reject(new Error("registerStudent: form is missing"));

//     const url = `${BASE_URL}/registerStudent`; // adjust route if different
//     const xhr = new XMLHttpRequest();

//     xhr.open("POST", url);
//     xhr.timeout = 20000; // 20 seconds

//     const headers = buildHeaders(user);
//     Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

//     xhr.onload = () => {
//       const text = xhr.responseText || "";
//       const json = safeJsonFromText(text);

//       if (!json) {
//         return reject(new Error(`Server did not return JSON. First 120 chars: ${text.slice(0, 120)}`));
//       }
//       if (xhr.status >= 200 && xhr.status < 300 && json.status !== false) {
//         resolve(json);
//       } else {
//         reject(new Error(json.message || `Request failed HTTP ${xhr.status}`));
//       }
//     };

//     xhr.onerror = () => reject(new Error("Network error (xhr.onerror)"));
//     xhr.ontimeout = () => reject(new Error("Request timed out"));

//     if (xhr.upload && typeof onProgress === "function") {
//       xhr.upload.onprogress = (event) => {
//         if (!event.lengthComputable) return;
//         const pct = Math.round((event.loaded / event.total) * 100);
//         onProgress(pct);
//       };
//     }

//     const fd = new FormData();

//     // ✅ Explicit append (fast + predictable)
//     fd.append("title",form.title?.trim() || "");
//     fd.append("firstName",form.firstName?.trim() || "");
//     fd.append("middleName",form.middleName?.trim() || "");
//     fd.append("lastName",form.lastName?.trim() || "");
//     fd.append("emailAddress",form.emailAddress?.trim() || "");
//     fd.append("mobileNumber",form.mobileNumber?.trim() || "");
//     fd.append("gender",form.gender?.trim() || "");
//     fd.append("classId",form.classId?.trim() || "");
//     fd.append("branchId",form.branchId?.trim() || "");
//     fd.append("sessionId",form.sessionId?.trim() || "");
//     fd.append("dob",form.dob?.trim() || "");
//     fd.append("placeOfBirth",form.placeOfBirth?.trim() || "");
//     fd.append("nationality",form.nationality?.trim() || "");
//     fd.append("courseMedium",form.courseMedium?.trim() || "");
//     fd.append("isPhysicallyChallenged",form.isPhysicallyChallenged?.trim() || "");
//     fd.append("admissionType",form.admissionType?.trim() || "");

//     fd.append("cAddressLine1",form.cAddressLine1?.trim() || "");
//     fd.append("cAddressLine2",form.cAddressLine2?.trim() || "");
//     fd.append("cAddressCity",form.cAddressCity?.trim() || "");
//     fd.append("cAddressState",form.cAddressState?.trim() || "");
//     fd.append("cAddressZipCode",form.cAddressZipCode?.trim() || "");

//     fd.append("pAddressLine1",form.pAddressLine1?.trim() || "");
//     fd.append("pAddressLine2",form.pAddressLine2?.trim() || "");
//     fd.append("pAddressCity",form.pAddressCity?.trim() || "");
//     fd.append("pAddressState",form.pAddressState?.trim() || "");
//     fd.append("pAddressZipCode",form.pAddressZipCode?.trim() || "");

//     fd.append("fatherName",form.fatherName?.trim() || "");
//     fd.append("fatherEducation",form.fatherEducation?.trim() || "");
//     fd.append("fatherAge",form.fatherAge?.trim() || "");
//     fd.append("fatherOccupation",form.fatherOccupation?.trim() || "");

//     fd.append("motherName",form.motherName?.trim() || "");
//     fd.append("motherEducation",form.motherEducation?.trim() || "");
//     fd.append("motherAge",form.motherAge?.trim() || "");
//     fd.append("motherOccupation",form.motherOccupation?.trim() || "");

//     // ✅ Photo upload (key must match CakePHP: studentPhoto)
//     if (photoAsset?.uri) {
//       const uri = photoAsset.uri;
//       const ext = (uri.split(".").pop() || "jpg").toLowerCase();
//       const mime =
//         ext === "png" ? "image/png" :
//         ext === "webp" ? "image/webp" :
//         ext === "heic" ? "image/heic" : "image/jpeg";

//       fd.append("studentPhoto", {
//         uri,
//         name: `student.${ext}`,
//         type: mime,
//       });
//     }

//     xhr.send(fd);
//   });
// };

// Fetch all sessions
// export const getAllRegisteredStudents = async (user, {
//       page = 1,
//       limit = 20,
//       search = "",
//       classId = "",
//       section = "",
//     } = {}) => {
//     const params = new URLSearchParams();

//       params.append("page", String(page));
//       params.append("limit", String(limit));
//       if (search.trim()) params.append("search", search.trim());
//       if (classId) params.append("classId", classId);
//       if (section) params.append("section", section);

//       const response = await fetch(`${BASE_URL}/getRegisteredStudens`, {
//         method: "GET",
//         headers: {
//           Accept: "application/json",
//           ssmsUserName: user?.ssmsUserName ?? "",
//           ssmsUserRole: user?.role ?? "", // ✅ FIXED
//           ssmsClientCode: user?.ssmsClientCode ?? "",
//         },
//       }); 

//       const json = await response.json().catch(() => null);
//       if (!response.ok || !json) throw new Error("Failed to load students");
//       return json.data ?? []; // ✅ expects array
// };

export const registerStudent = ({ form, photoAsset, user, onProgress }) => {
  const fd = new FormData();
 
  // Append all text fields
  const fields = [
    'title','firstName','middleName','lastName',
    'emailAddress','mobileNumber','gender','dob',
    'admissionDate',
    'placeOfBirth','nationality',
    'classId','branchId','sessionId',
    'courseMedium','isPhysicallyChallenged','admissionType',
    'fatherName','fatherEducation','fatherAge','fatherOccupation',
    'motherName','motherEducation','motherAge','motherOccupation',
    // Current address
    'cAddressLine1','cAddressLine2','cAddressCity',
    'cAddressState','cAddressZipCode','cAddressHomephone',
    // Permanent address
    'pAddressLine1','pAddressLine2','pAddressCity',
    'pAddressState','pAddressZipCode','pAddressHomephone',
    // Optional demographic
    'admissionNumber','caste','religion','bloodGroup',
  ];
 
  fields.forEach((key) => {
    if (form[key] !== undefined && form[key] !== null) {
      fd.append(key, String(form[key]));
    }
  });
 
  // Append photo file (field name must match getUploadedFile('student_photo') in PHP)
  // IMPORTANT: React Native FormData requires EXACTLY { uri, name, type }.
  // Do NOT spread the full asset object — extra keys cause {} serialization.
  // ImageManipulator returns a uri but no fileName, so derive name from the uri.
  if (photoAsset?.uri) {
    const uri       = photoAsset.uri;
 
    // Derive extension: check uri path, fallback to jpg
    const uriPath   = uri.split('?')[0];              // strip query params
    const dotIdx    = uriPath.lastIndexOf('.');
    const rawExt    = dotIdx >= 0 ? uriPath.slice(dotIdx + 1).toLowerCase() : 'jpg';
    const ext       = ['jpg','jpeg','png','webp'].includes(rawExt) ? rawExt : 'jpg';
    const mime      = ext === 'png' ? 'image/png'
                    : ext === 'webp' ? 'image/webp'
                    : 'image/jpeg';
 
    // Use originalFileName if available (from gallery picker), otherwise build one
    const name = photoAsset.fileName
               ?? photoAsset.filename          // some RN versions lowercase
               ?? `student_photo_${Date.now()}.${ext}`;
 
    // Only these three keys — nothing else
    fd.append('student_photo', { uri, name, type: mime });
  }
 
  // Use XMLHttpRequest so we can track upload progress
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
 
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }
 
    xhr.onload = () => {
      try {

        // Strip any PHP deprecation/warning HTML before the JSON object
        const raw  = xhr.responseText ?? "";
        const jStart = raw.indexOf("{");
        const jEnd   = raw.lastIndexOf("}");
        if (jStart === -1 || jEnd === -1) {
          //console.warn("registerStudent: no JSON found in response:", raw.slice(0, 200));
          reject(new Error('Invalid server response'));
          return;
        }
        const json = JSON.parse(raw.slice(jStart, jEnd + 1));
        //console.log("registerStudent API json response:", json);

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(json);
        } else {
          reject(new Error(json?.message ?? `HTTP ${xhr.status}`));
        }
      } catch (e) {
        //console.error("registerStudent parse error:", e.message);
        reject(new Error('Invalid server response'));
      }
    };
 
    xhr.onerror = () => reject(new Error('Network error. Please check your connection.'));
 
    xhr.open('POST', `${BASE_URL}/StudentApi/registerStudent`);
 
    // Set auth header (no Content-Type — XHR sets it with multipart boundary)
    if (user?.token) {
      xhr.setRequestHeader('Authorization', `Bearer ${user.token}`);
    }
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('ssmsClientCode', user?.ssmsClientCode ?? '');
    xhr.setRequestHeader('userRole', user?.role ?? ''); 
    xhr.setRequestHeader('ssmsUserName', user?.ssmsUserName ?? user?.username ?? '');

    xhr.send(fd);
  });
};

export async function getEnrolledStudents(user, {
      page = 1,
      limit = 20,
      search = "",
      classId = "",
      sectionId = "",
      branchId = "",
      sessionId = "",
    } = {}) {
      const params = new URLSearchParams();
      params.append("page",  String(page));
      params.append("limit", String(limit));
      if (search.trim()) params.append("search",    search.trim());
      if (classId)       params.append("classId",   String(classId));
      if (sectionId)     params.append("sectionId", String(sectionId));
      if (branchId)      params.append("branchId",  String(branchId));
      if (sessionId)     params.append("sessionId", String(sessionId));

      const response = await safeFetch(`${BASE_URL}/StudentApi/getEnrolledStudents?${params.toString()}`, {
        method: "GET",
        headers: buildHeaders(user),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to load students");
      }
      return {
        students:   data.data       || [],
        pagination: data.pagination || {},
      };
    }

export async function fetchStudent(regId, user) {
  const response = await safeFetch(`${BASE_URL}/StudentApi/fetchStudentByRegId/${regId}`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Failed to load student details");
  return data.student;
    }

export async function updateStudent(regId, payload, user) {
  const response = await safeFetch(`${BASE_URL}/StudentApi/updateStudent/${regId}`, {
    method: "POST",                           // POST avoids CakePHP PUT routing issues
    headers: { ...buildHeaders(user), 'X-HTTP-Method-Override': 'PUT' },
    body: JSON.stringify(payload),
  });
  const rawText = await response.text();

  // Strip PHP warnings (e.g. "Constant X already defined") prepended before JSON
  const jsonStart = rawText.indexOf('{');
  if (jsonStart === -1) {
    console.error("[updateStudent] non-JSON response:", rawText.slice(0, 300));
    throw new Error(`Server error ${response.status}: unexpected response`);
  }
  if (jsonStart > 0) {
    console.warn("[updateStudent] PHP warning stripped:", rawText.slice(0, jsonStart).trim());
  }

  let data;
  try {
    data = JSON.parse(rawText.slice(jsonStart));
  } catch (e) {
    console.error("[updateStudent] JSON parse failed:", rawText.slice(0, 300));
    throw new Error("Failed to parse server response");
  }

  console.log("[updateStudent] server response:", JSON.stringify(data));

  if (!response.ok || data.status === false) {
    throw new Error(data.message || "Failed to update student");
  }
  return data;
}

export async function getAllRegisteredStudents(user, {
      page = 1, limit = 20, search = "", classId = "", section = "",
    } = {}) {
      const params = new URLSearchParams();
      params.append("page", String(page));
      params.append("limit", String(limit));
      if (search.trim()) params.append("search", search.trim());
      if (classId) params.append("classId", classId);
      if (section) params.append("section", section);

      const response = await safeFetch(`${BASE_URL}/StudentApi/students?${params.toString()}`, {
        method: "GET",
        headers: buildHeaders(user),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load students");
      return { students: data.students || [], pagination: data.pagination || {} };
    }

export async function enrollStudent(user, payload, regId) {
  const response = await safeFetch(`${BASE_URL}/StudentApi/enrollStudent/${regId}`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.status) throw new Error(data.message || "Enrollment failed");
  return data;
}

export const fetchStudents = async (user, cls, section, date, sessionId, branchId) => {
  const params = new URLSearchParams();
  params.append('class',   cls);
  params.append('section', section);
  params.append('date',    date);
  if (sessionId) params.append('sessionId', String(sessionId));
  if (branchId)  params.append('branchId',  String(branchId));

  const res = await safeFetch(
    `${BASE_URL}/StudentApi/getStudentsAttendance/?${params.toString()}`,
    { headers: buildHeaders(user) }
  );
  const json = await res.json();
  // Return the full response so callers can access schoolName etc.
  return json;
};

export const saveAttendance = async (user, payload) => {
  const response = await safeFetch(`${BASE_URL}/StudentApi/saveAttendance/`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Save failed (HTTP ${response.status})`);
  }
  return data;
};

/**
 * Fetch recent N-day attendance for a class/section (designed for AttendanceScreen).
 * Returns { status, columns[], dayNames[], students[{ id, firstName, rollNumber, days{}, present, total, percent }] }
 */
export const fetchRecentAttendance = async (user, { classId, sectionId, branchId, sessionId, days = 10 }) => {
  const params = new URLSearchParams();
  if (classId)   params.append('classId',   String(classId));
  if (sectionId) params.append('sectionId', String(sectionId));
  params.append('branchId', branchId ? String(branchId) : '');
  if (sessionId) params.append('sessionId', String(sessionId));
  params.append('days', String(days));

  const res = await fetchWithTimeout(
    `${BASE_URL}/StudentApi/getRecentAttendance?${params.toString()}`,
    { method: 'GET', headers: buildHeaders(user) }
  );
  if (!res.status) throw new Error(res.message ?? 'Failed to load recent attendance');
  return res;
};

/**
 * Fetch monthly attendance matrix for a class/section.
 * Returns { status, meta, columns, dayNames, students }
 */
export const fetchMonthlyAttendance = async (user, { classId, sectionId, branchId, year, month }) => {
  const params = new URLSearchParams();
  if (classId)   params.append('classId',   String(classId));
  if (sectionId) params.append('sectionId', String(sectionId));
  if (branchId)  params.append('branchId',  String(branchId));
  if (year)      params.append('year',      String(year));
  if (month)     params.append('month',     String(month));

  const res = await fetchWithTimeout(
    `${BASE_URL}/StudentApi/getMonthlyAttendance?${params.toString()}`,
    { method: 'GET', headers: buildHeaders(user) }
  );
  if (!res.status) throw new Error(res.message ?? 'Failed to load attendance');
  return res;
};

/**
 * GET /StudentApi/getMyAttendance
 * Returns the logged-in student's last 30 days of attendance.
 * { status, enrollmentId, from, to, summary, days }
 */
export const fetchMyAttendance = async (user) => {
  const res = await fetchWithTimeout(
    `${BASE_URL}/StudentApi/getMyAttendance`,
    { method: 'GET', headers: buildHeaders(user) }
  );
  if (!res.status) throw new Error(res.message ?? 'Failed to load attendance');
  return res;
};

export async function fetchIdCardData(user, { classId, sessionId, branchId, sectionId }) {
  const params = new URLSearchParams();
  if (classId)   params.append("classId",   String(classId));
  if (sessionId) params.append("sessionId", String(sessionId));
  if (branchId)  params.append("branchId",  String(branchId));
  if (sectionId) params.append("sectionId", String(sectionId));
 
  const res = await safeFetch(
    `${BASE_URL}/StudentApi/getIdCardData?${params.toString()}`,
    { method: "GET", headers: buildHeaders(user) }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
}

export const uploadStudentPhoto = (user, registrationNo, photoAsset, onProgress) =>
  new Promise((resolve, reject) => {
    if (!photoAsset?.uri) return reject(new Error("No photo selected"));
    if (!registrationNo)  return reject(new Error("Registration number is required"));
 
    // Build the file extension and MIME type
    const uri  = photoAsset.uri;
    const ext  = uri.split('.').pop()?.toLowerCase().replace('jpg', 'jpeg') ?? 'jpeg';
    const mime = photoAsset.type?.startsWith('image/') ? photoAsset.type : `image/${ext}`;
    const name = photoAsset.fileName
               ?? photoAsset.filename
               ?? `student_${registrationNo}_${Date.now()}.${ext}`;
 
    const fd = new FormData();
    fd.append('student_photo',   { uri, name, type: mime });
    fd.append('registrationNo',  String(registrationNo));
    fd.append('ssmsClientCode',  user?.ssmsClientCode ?? '');
 
    const xhr = new XMLHttpRequest();
 
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
 
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && json.status !== false) {
          resolve(json);
        } else {
          reject(new Error(json?.message ?? `Server error ${xhr.status}`));
        }
      } catch {
        reject(new Error('Invalid server response'));
      }
    };
 
    xhr.onerror   = () => reject(new Error('Network error — check your connection'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.timeout   = 30000; // 30 s
 
    xhr.open('POST', `${BASE_URL}/StudentApi/uploadStudentPhoto`);
    xhr.setRequestHeader('Accept',         'application/json');
    xhr.setRequestHeader('Authorization',  user?.token ? `Bearer ${user.token}` : '');
    xhr.setRequestHeader('ssmsClientCode', user?.ssmsClientCode ?? '');
    xhr.setRequestHeader('ssmsUserName',   user?.ssmsUserName   ?? '');
    xhr.setRequestHeader('ssmsUserRole',   user?.ssmsUserRole   ?? '');
    // NOTE: Do NOT set Content-Type — XHR sets it automatically with multipart boundary
 
    xhr.send(fd);
  });

  // ─── Update Enrollment (branch / class / section) ─────────────────────────────
/**
 * PUT /StudentApi/updateEnrollment
 * Admin / owner only — enforced on both frontend and backend.
 *
 * @param {object} user         AuthContext user (must be admin or owner)
 * @param {object} payload      { enrollmentId, branchId, classId, sectionId }
 */
export const updateEnrollment = async (user, payload) => {
  const res  = await safeFetch(`${BASE_URL}/StudentApi/updateEnrollment`, {
    method:  'PUT',
    headers: buildHeaders(user),
    body:    JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

/**
 * GET /StudentApi/getLinkedStudents
 * Returns all active enrollments that share the logged-in student/parent's
 * mobile number.  Used for the multi-child parent portal.
 * Returns an array of { enrollment_id, student_name, class_name,
 * section_name, session_name, roll_number }.
 */
export const fetchLinkedStudents = async (user) => {
  const res = await fetchWithTimeout(
    `${BASE_URL}/StudentApi/getLinkedStudents`,
    { method: 'GET', headers: buildHeaders(user) }
  );
  if (!res.status) throw new Error(res.message ?? 'Failed to load linked students');
  return Array.isArray(res.data) ? res.data : [];
};

// Alias used by ProfileScreen — strips PHP warnings before parsing
export const fetchStudentById = async (studentId, user) => {
  const response = await safeFetch(`${BASE_URL}/StudentApi/fetchStudentByRegId/${encodeURIComponent(studentId)}`, {
    method:  'GET',
    headers: buildHeaders(user),
  });
  const rawText = await response.text();
  const jsonStart = rawText.indexOf('{');
  if (jsonStart === -1) throw new Error(`Server error ${response.status}: unexpected response`);
  const data = JSON.parse(rawText.slice(jsonStart));
  if (!response.ok || data.status === false) throw new Error(data.message || 'Failed to load student details');
  return data.student ?? {};
};

/**
 * POST /StudentApi/updateRollNumber
 * Update roll number for a single enrollment.
 * @param {object} user
 * @param {object} payload  { enrollment_id, roll_number }
 */
export const updateRollNumber = async (user, payload) => {
  const res  = await safeFetch(`${BASE_URL}/StudentApi/updateRollNumber`, {
    method:  'POST',
    headers: buildHeaders(user),
    body:    JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

/**
 * POST /StudentApi/updateRollNumbers
 * Bulk-update roll numbers for multiple enrollments in one request.
 * @param {object} user
 * @param {Array<{enrollment_id: string|number, roll_number: string}>} rolls
 */
export const updateRollNumbers = async (user, rolls) => {
  const res  = await safeFetch(`${BASE_URL}/StudentApi/updateRollNumbers`, {
    method:  'POST',
    headers: buildHeaders(user),
    body:    JSON.stringify({ rolls }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false)
    throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};