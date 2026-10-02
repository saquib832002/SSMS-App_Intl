//const BASE_URL = "http://192.168.4.90/ssms5/FeeApi";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";
const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");

const buildHeaders = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});



export async function createFeeItem(user, payload) {
  const response = await safeFetch(`${BASE_URL}/FeeApi/createFeeItem`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to create fee item");
  }
  return data;
}

export async function fetchFeeItems(user, category = "") {
  const params = new URLSearchParams();
  if (category) params.append("category", category);
  const qs = params.toString();
  const url = BASE_URL + "/FeeApi/getFeeItems" + (qs ? "?" + qs : "");
  const response = await safeFetch(url, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to load fee items");
  }
  return data.data || [];
}

  

export async function saveClassFeeStructure(user, payload) {
  const response = await safeFetch(`${BASE_URL}/FeeApi/saveClassFeeStructure`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to save fee structure");
  }
  return data;
}

export async function fetchClassFeeStructure(user, { classId, sessionId, branchId, category }) {
  const params = new URLSearchParams();
  if (classId)  params.append("classId",  String(classId));
  if (sessionId) params.append("sessionId", String(sessionId));
  if (branchId) params.append("branchId",  String(branchId));
  if (category) params.append("category",  String(category));

  const response = await safeFetch(`${BASE_URL}/FeeApi/getClassFeeStructure?${params.toString()}`, {
    method: "GET",
    headers: buildHeaders(user),
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to load fee structure");
  }
  return data.data || [];
}

// Transport fee structure — same endpoints, category=Transport
export const fetchTransportFeeStructure = (user, { classId, sessionId, branchId }) =>
  fetchClassFeeStructure(user, { classId, sessionId, branchId, category: "Transport" });

export const saveTransportFeeStructure = (user, payload) =>
  saveClassFeeStructure(user, { ...payload, filters: { ...payload.filters, category: "Transport" } });

export async function updateFeeItem(user, feeItemId, payload) {
  const response = await safeFetch(`${BASE_URL}/FeeApi/updateFeeItem/${feeItemId}`, {
    method: "PUT",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to update fee item");
  }
  return data;
}

export async function deactivateFeeItem(user, feeItemId) {
  const response = await safeFetch(`${BASE_URL}/FeeApi/deactivateFeeItem/${feeItemId}`, {
    method: "PATCH",
    headers: buildHeaders(user),
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to deactivate fee item");
  }
  return data;
}

export async function deleteFeeItem(user, feeItemId) {
  const response = await safeFetch(`${BASE_URL}/FeeApi/deleteFeeItem/${feeItemId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  });

  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(data.message || "Failed to delete fee item");
  }
  return data;
}




export const fetchDueFees = async (enrollmentId, user) => {
  try {
   // console.log("Fetching due fees for enrollmentId:", enrollmentId, "with user:", user);
    const response = await safeFetch(
      `${BASE_URL}/FeeApi/getDueFees/${enrollmentId}`,
      {
        method: "GET",
         headers: buildHeaders(user),
      }
    );

    const data = await response.json();

    if (!response.ok || data.status === false) {
      throw new Error(data.message || "Failed to fetch due fees");
    }

    return data.data || [];
  } catch (error) {
   // console.log("fetchDueFees error:", error);
    throw error;
  }
};

export const collectStudentFee = async (payload, user) => {
  try {
    const response = await safeFetch(
      `${BASE_URL}/FeeApi/collectStudentFee`,
      {
        method: "POST",
        headers: buildHeaders(user),
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok || data.status === false) {
      throw new Error(data.message || "Failed to collect fee");
    }

    return data;
  } catch (error) {
    console.log("collectStudentFee error:", error);
    throw error;
  }
};




/**
 * feeServiceApi.js
 * Place at: src/services/feeServiceApi.js
 */

const hdrs = (user) => ({
  Accept:         "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? user?.username   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role       ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? user?.clientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

const handle = async (res) => {
  if (res.status === 401) {
    throw new Error('SESSION_EXPIRED');  // ← caught by screens
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
  return json;
};

/**
 * GET /api/fee-records/student/:enrollment_id
 * Returns { due: [...], paid: [...] }
 */
export const fetchStudentFeeData = async (enrollmentId, params = {}, user) => {
 // console.log("Fetching student fee data for enrollmentId:", enrollmentId, "with params:", params, "and user:", user);
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString();
  const res = await safeFetch(`${BASE_URL}/FeeApi/fetchStudentFeeDue/${enrollmentId}${qs ? `?${qs}` : ''}`, {
    method: 'GET',  headers: buildHeaders(user),
  });
  return handle(res);
};

export const fetchStudentHostelFeeData = async (enrollmentId, params = {}, user) => {
 // console.log("Fetching student fee data for enrollmentId:", enrollmentId, "with params:", params, "and user:", user);
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString();
  const res = await safeFetch(`${BASE_URL}/FeeApi/fetchStudentHostelFeeDue/${enrollmentId}${qs ? `?${qs}` : ''}`, {
    method: 'GET',  headers: buildHeaders(user),
  });
  return handle(res);
};

export const fetchStudentTransportFeeData = async (enrollmentId, params = {}, user) => {
  //console.log("Fetching student transport fee data for enrollmentId:", enrollmentId, "with params:", params, "and user:", user);
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString();
  const res = await safeFetch(`${BASE_URL}/FeeApi/fetchStudentTransportFeeDue/${enrollmentId}${qs ? `?${qs}` : ''}`, {
    method: 'GET',  headers: buildHeaders(user),
  });
  return handle(res);
};

/**
 * POST /api/fee-records/pay
 * Submits a payment against one or more selected fee items.
 */
export const submitPayment = (data, user) =>
  safeFetch(`${BASE_URL}/FeeApi/payStudentFees`, {
    method: 'POST',
    headers: buildHeaders(user),
    body: JSON.stringify(data),
  }).then(handle);

/** Standard CRUD (used by admin list screen if needed) */
export const fetchFeeRecords  = (user, p = {}) =>
  safeFetch(`${BASE_URL}/FeeApi/fee-records?${new URLSearchParams(p)}`, { method: 'GET', headers: buildHeaders(user) }).then(handle);
export const createFeeRecord  = (data, user) =>
  safeFetch(`${BASE_URL}/FeeApi/fee-records`, { method: 'POST', headers: buildHeaders(user), body: JSON.stringify(data) }).then(handle);
export const updateFeeRecord  = (id, data, user) =>
  safeFetch(`${BASE_URL}/FeeApi/fee-records/${id}`, { method: 'PUT', headers: buildHeaders(user), body: JSON.stringify(data) }).then(handle);
export const deleteFeeRecord  = (id, user) =>
  safeFetch(`${BASE_URL}/FeeApi/fee-records/${id}`, { method: 'DELETE', headers: buildHeaders(user) }).then(handle);

export const sendReceiptEmail = async (data, user) => {
  try {
    const response = await safeFetch(`${BASE_URL}/FeeApi/sendReceiptEmail`, {
      method: 'POST',
      headers: buildHeaders(user),
      body: JSON.stringify(data),
    });
//console.log("sendReceiptEmail response status:", response.status);
    const json = await response.json().catch(() => ({}));

    if (!response.ok || json.success === false) {
      throw new Error(json.message || `HTTP ${response.status}`);
    }
    return json;
  } catch (error) {
    //console.log('sendReceiptEmail error:', error);
    throw error;
  }
};

export const fetchDemandSlip = async (params, user) => {
  try {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v != null && v !== '')
      )
    ).toString();
 
    const response = await safeFetch(`${BASE_URL}/FeeApi/getDemandSlip${qs ? `?${qs}` : ''}`,
      {
        method: 'GET',
        headers: buildHeaders(user),
      }
    );
 
    const data = await response.json().catch(() => ({}));
 
    if (!response.ok || data.status === false) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
  } catch (error) {
    //console.log('fetchDemandSlip error:', error);
    throw error;
  }
};

const fetchPendingCollections = async (user, filters = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== ''))
  ).toString();
  const res  = await safeFetch(`${BASE_URL}/FeeApi/getPendingCollections${qs ? `?${qs}` : ''}`, {
    method: 'GET', headers: buildHeaders(user),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

const approveCollections = async (user, receiptNumbers) => {
  const res  = await safeFetch(`${BASE_URL}/FeeApi/approveCollections`, {
    method:  'POST',
    headers: buildHeaders(user),
    body:    JSON.stringify({ receipt_numbers: receiptNumbers }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) throw new Error(json.message ?? `HTTP ${res.status}`);
  return json;
};

// Fetch discounts for a student scoped to a specific session
export const fetchStudentDiscounts = (user, enrollmentId, sessionId) =>
  safeFetch(`${BASE_URL}/FeeApi/getStudentDiscounts?enrollmentId=${enrollmentId}&sessionId=${sessionId}`, {
    headers: buildHeaders(user),
  }).then(r => r.json()).then(d => d.data ?? []);

// Save discounts — scoped to session + class + branch
// Different discount can be set per session for same student
export const saveStudentDiscounts = (user, enrollmentId, sessionId, classId, branchId, items) =>
  safeFetch(`${BASE_URL}/FeeApi/saveStudentDiscounts`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    JSON.stringify({
      enrollment_id: enrollmentId,
      session_id:    sessionId,
      class_id:      classId,
      branch_id:     branchId,
      items,
    }),
  }).then(r => r.json());
 
// Fetch enrolled students for a class/session (for the picker)
export const fetchEnrolledForDiscount = (user, { classId, sectionId, sessionId, branchId }) => {
  const p = new URLSearchParams();
  if (classId)   p.set("classId",   classId);
  if (sectionId) p.set("sectionId", sectionId);
  if (sessionId) p.set("sessionId", sessionId);
  if (branchId)  p.set("branchId",  branchId);
  return safeFetch(`${BASE_URL}/FeeApi/getEnrolledStudents?${p}`, { headers: buildHeaders(user) })
    .then(r => r.json()).then(d => d.data ?? []);
};